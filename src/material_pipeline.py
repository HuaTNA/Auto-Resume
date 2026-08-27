"""Independent job-to-resume material pipeline for agent callers.

No database, API route, Discord, or frontend dependency is allowed here.  The
return value is JSON-serializable and keeps job matching and resume ATS scores
in separate namespaces.
"""

from __future__ import annotations

import json
from typing import Callable

import anthropic

from src.generator import generate_resume
from src.jd_parser import clean_jd, parse_jd
from src.material_optimizer import optimize_material, validate_material_grounding
from src.material_pipeline_contract import MaterialPipelineResult
from src.retriever import retrieve_relevant_content


MAX_MODEL_CALLS = 11
MAX_INPUT_TOKENS = 120_000
MAX_OUTPUT_TOKENS = 23_700


def run_material_pipeline(
    profile: dict,
    job: dict,
    client: anthropic.Anthropic,
    *,
    job_match_score: float | None,
    job_match_reason: str = "",
    template_name: str | None = None,
    target_ats_score: float = 85,
    max_optimization_rounds: int = 2,
    min_improvement: float = 2,
    top_k: int = 12,
    max_model_calls: int = MAX_MODEL_CALLS,
    max_input_tokens: int = MAX_INPUT_TOKENS,
    max_output_tokens: int = MAX_OUTPUT_TOKENS,
) -> MaterialPipelineResult:
    """Public Agent 1 interface; implementation details are intentionally hidden."""
    budgeted_client = _BudgetedClient(
        client,
        max_calls=_bounded_int(max_model_calls, MAX_MODEL_CALLS, 1, MAX_MODEL_CALLS),
        max_input_tokens=_bounded_int(max_input_tokens, MAX_INPUT_TOKENS, 1, MAX_INPUT_TOKENS),
        max_output_tokens=_bounded_int(max_output_tokens, MAX_OUTPUT_TOKENS, 1, MAX_OUTPUT_TOKENS),
    )
    result = _run_material_pipeline(
        profile, job, budgeted_client,
        job_match_score=job_match_score,
        job_match_reason=job_match_reason,
        template_name=template_name,
        target_ats_score=target_ats_score,
        max_optimization_rounds=max_optimization_rounds,
        min_improvement=min_improvement,
        top_k=top_k,
    )
    result["usage"] = budgeted_client.usage()
    return result


def _run_material_pipeline(
    profile: dict,
    job: dict,
    client: anthropic.Anthropic,
    *,
    job_match_score: float | None,
    job_match_reason: str = "",
    template_name: str | None = None,
    target_ats_score: float = 85,
    max_optimization_rounds: int = 2,
    min_improvement: float = 2,
    top_k: int = 12,
    jd_analyzer: Callable = parse_jd,
    retriever: Callable = retrieve_relevant_content,
    generator: Callable = generate_resume,
    optimizer: Callable = optimize_material,
) -> MaterialPipelineResult:
    """Generate and optimize grounded resume material for one ranked job.

    ``job_match_score`` must come from job selection/ranking (normally
    ``job_finder.rank_jobs``).  It is copied for traceability and is never used
    as, blended with, or overwritten by a resume ATS score.
    """
    warnings: list[str] = []
    errors: list[dict] = []
    safe_job = job if isinstance(job, dict) else {}
    match = {
        "score": None,
        "reason": str(job_match_reason or safe_job.get("match_reason") or ""),
        "source": "job_finder",
    }
    base = {
        "schema_version": "1.0",
        "job": {
            "title": str(safe_job.get("title") or ""),
            "company": str(safe_job.get("company") or ""),
            "url": str(safe_job.get("url") or ""),
        },
        "job_match": match,
        "job_analysis": None,
        "resume_ats": None,
        "material": {"resume_tex": None, "selected_version": None},
        "versions": [],
        "optimization": {"rounds": 0, "stop_reason": "not_started"},
        "usage": _empty_usage(),
        "warnings": warnings,
        "errors": errors,
    }

    try:
        match["score"] = _normalize_job_match_score(job_match_score)
    except Exception as exc:
        return _failed(base, "validate_job_match", exc)

    if not isinstance(job, dict):
        return _failed(base, "validate_job", ValueError("Job must be an object"))
    if not isinstance(profile, dict) or not profile:
        return _failed(base, "validate_profile", ValueError("Candidate profile is empty"))
    jd_text = str(safe_job.get("description") or safe_job.get("jd_text") or "").strip()
    if not jd_text:
        return _failed(base, "validate_job", ValueError("Job description is empty"))

    supplied_analysis = safe_job.get("jd_analysis")
    if isinstance(supplied_analysis, dict) and supplied_analysis:
        jd_analysis = supplied_analysis
    else:
        try:
            jd_analysis = jd_analyzer(clean_jd(jd_text), client)
        except Exception as exc:
            return _failed(base, "analyze_jd", exc)
    if not isinstance(jd_analysis, dict) or not jd_analysis:
        return _failed(base, "analyze_jd", ValueError("JD analysis is empty"))
    base["job_analysis"] = jd_analysis

    try:
        filtered_profile = retriever(profile, jd_analysis, client, top_k=max(1, int(top_k)))
        if not isinstance(filtered_profile, dict) or not filtered_profile:
            raise ValueError("Retriever returned an empty profile")
    except Exception as exc:
        # Full source profile is a safe grounding fallback.  It may be less
        # concise, but it cannot introduce candidate facts that were not given.
        filtered_profile = profile
        warnings.append("Relevant-content retrieval failed; using the full candidate profile.")
        errors.append(_exception_error("retrieve_profile", exc))

    try:
        initial_resume = generator(
            filtered_profile, jd_analysis, client, template_name=template_name
        )
        if not str(initial_resume or "").strip():
            raise ValueError("Generator returned an empty resume")
    except Exception as exc:
        return _failed(base, "generate_resume", exc, warnings=warnings, errors=errors)

    try:
        optimized = optimizer(
            initial_resume,
            jd_analysis,
            filtered_profile,
            client,
            target_ats_score=target_ats_score,
            max_optimization_rounds=max_optimization_rounds,
            min_improvement=min_improvement,
        )
        optimization = optimized.to_dict() if hasattr(optimized, "to_dict") else dict(optimized)
    except Exception as exc:
        # Optimizer failures must not lose a successfully generated resume.  It
        # remains explicitly unscored, so callers cannot mistake it for a pass.
        # Run the deterministic grounding guard here as well because a failed
        # optimizer may not have reached its own validation step.
        grounding_issues = validate_material_grounding(initial_resume, filtered_profile)
        if grounding_issues:
            errors.append(_exception_error("optimize_material", exc))
            errors.append({
                "stage": "grounding",
                "type": "MaterialError",
                "message": "Generated resume contains unsupported factual claims",
            })
            base.update({
                "status": "failed",
                "versions": [{
                    "version": 1, "optimization_round": 0, "resume_tex": None,
                    "resume_ats": None, "decision": "rejected_ungrounded",
                    "improvement": None, "grounding_issues": grounding_issues,
                }],
                "optimization": {"rounds": 0, "stop_reason": "initial_material_ungrounded"},
            })
            return base
        warnings.append("Material optimization failed; returning the unscored initial resume.")
        errors.append(_exception_error("optimize_material", exc))
        base.update({
            "status": "degraded",
            "material": {"resume_tex": initial_resume, "selected_version": 1},
            "versions": [{
                "version": 1, "optimization_round": 0, "resume_tex": initial_resume,
                "resume_ats": None, "decision": "selected_unscored_fallback",
                "improvement": None, "grounding_issues": [],
            }],
            "optimization": {"rounds": 0, "stop_reason": "optimizer_failed"},
        })
        return base

    warnings.extend(optimization.get("warnings", []))
    errors.extend(optimization.get("errors", []))
    base.update({
        "status": optimization.get("status", "failed"),
        "resume_ats": optimization.get("resume_ats"),
        "material": {
            "resume_tex": optimization.get("resume_tex"),
            "selected_version": optimization.get("selected_version"),
        },
        "versions": optimization.get("versions", []),
        "optimization": {
            "rounds": optimization.get("optimization_rounds", 0),
            "stop_reason": optimization.get("stop_reason", "unknown"),
            "max_rounds": min(max(0, _safe_int(max_optimization_rounds, 2)), 2),
        },
    })
    return base


def _normalize_job_match_score(value) -> float | None:
    if value is None:
        return None
    try:
        score = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("job_match_score must be numeric") from exc
    if not 0 <= score <= 100:
        raise ValueError("job_match_score must be between 0 and 100")
    return score


def _failed(base: dict, stage: str, exc: Exception, *, warnings=None, errors=None) -> dict:
    if warnings is not None:
        base["warnings"] = warnings
    if errors is not None:
        base["errors"] = errors
    base["errors"].append(_exception_error(stage, exc))
    base["status"] = "failed"
    base["optimization"] = {"rounds": 0, "stop_reason": f"{stage}_failed"}
    return base


def _exception_error(stage: str, exc: Exception) -> dict:
    return {"stage": stage, "type": type(exc).__name__, "message": str(exc)}


def _safe_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _bounded_int(value, fallback: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(_safe_int(value, fallback), maximum))


def _empty_usage() -> dict:
    # Replaced by the public wrapper.  Keeping the field present guarantees the
    # same schema even for early validation failures and internal unit tests.
    return {
        "model_calls": 0,
        "max_model_calls": MAX_MODEL_CALLS,
        "estimated_input_tokens": 0,
        "max_input_tokens": MAX_INPUT_TOKENS,
        "reserved_output_tokens": 0,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
    }


class _BudgetedMessages:
    def __init__(self, client, owner):
        self._client = client
        self._owner = owner

    def create(self, **kwargs):
        requested_output = max(0, _safe_int(kwargs.get("max_tokens"), 0))
        estimated_input = _estimate_input_tokens(kwargs)
        owner = self._owner
        if owner.model_calls + 1 > owner.max_calls:
            raise RuntimeError("Material pipeline model-call budget exceeded")
        if owner.estimated_input_tokens + estimated_input > owner.max_input_tokens:
            raise RuntimeError("Material pipeline input-token budget exceeded")
        if owner.reserved_output_tokens + requested_output > owner.max_output_tokens:
            raise RuntimeError("Material pipeline output-token budget exceeded")
        owner.model_calls += 1
        owner.estimated_input_tokens += estimated_input
        owner.reserved_output_tokens += requested_output
        return self._client.messages.create(**kwargs)


class _BudgetedClient:
    def __init__(self, client, *, max_calls: int, max_input_tokens: int, max_output_tokens: int):
        self.max_calls = max_calls
        self.max_input_tokens = max_input_tokens
        self.max_output_tokens = max_output_tokens
        self.model_calls = 0
        self.estimated_input_tokens = 0
        self.reserved_output_tokens = 0
        self.messages = _BudgetedMessages(client, self)

    def usage(self) -> dict:
        return {
            "model_calls": self.model_calls,
            "max_model_calls": self.max_calls,
            "estimated_input_tokens": self.estimated_input_tokens,
            "max_input_tokens": self.max_input_tokens,
            "reserved_output_tokens": self.reserved_output_tokens,
            "max_output_tokens": self.max_output_tokens,
        }


def _estimate_input_tokens(kwargs: dict) -> int:
    payload = {"system": kwargs.get("system", ""), "messages": kwargs.get("messages", [])}
    character_count = len(json.dumps(payload, ensure_ascii=False, default=str))
    return (character_count + 3) // 4
