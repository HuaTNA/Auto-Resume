"""Bounded resume optimization with explicit ATS-only scoring semantics.

This module deliberately knows nothing about job discovery scores.  A job match
score answers whether a role is worth pursuing; the ATS score here answers how
well one resume version is tailored to one already-selected role.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Callable

import anthropic

from src.ats_scorer import score_resume
from src.generator import refine_resume


ScoreFunction = Callable[[str, dict, anthropic.Anthropic], dict]
RefineFunction = Callable[[str, dict, dict, dict, anthropic.Anthropic], str]


@dataclass(frozen=True)
class MaterialVersion:
    """One auditable resume version and its ATS evaluation."""

    version: int
    optimization_round: int
    resume_tex: str | None
    resume_ats: dict | None
    decision: str
    improvement: float | None
    grounding_issues: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class MaterialOptimizationResult:
    """Stable result shape intended for direct consumption by another agent."""

    status: str
    selected_version: int | None
    resume_tex: str | None
    resume_ats: dict | None
    versions: list[MaterialVersion]
    optimization_rounds: int
    stop_reason: str
    warnings: list[str]
    errors: list[dict]

    def to_dict(self) -> dict:
        data = asdict(self)
        # Keep this explicit even though asdict currently expands the versions;
        # it makes the public serialization contract clear.
        data["versions"] = [version.to_dict() for version in self.versions]
        return data


def optimize_material(
    initial_resume_tex: str,
    jd_analysis: dict,
    filtered_profile: dict,
    client: anthropic.Anthropic,
    *,
    target_ats_score: float = 85,
    max_optimization_rounds: int = 2,
    min_improvement: float = 2,
    scorer: ScoreFunction = score_resume,
    refiner: RefineFunction = refine_resume,
) -> MaterialOptimizationResult:
    """Score and improve a resume, with at most two refinement attempts.

    The best-scoring grounded version is always retained.  Optimization stops
    when the target is reached, improvement is too small, a version regresses,
    output is unchanged/ungrounded, a dependency fails, or the round cap is hit.
    """
    round_limit = max(0, min(_coerce_int(max_optimization_rounds, 2), 2))
    target = _bounded_score(target_ats_score, 85)
    minimum_delta = max(0.0, _coerce_float(min_improvement, 2))
    warnings: list[str] = []
    errors: list[dict] = []
    versions: list[MaterialVersion] = []

    initial_issues = validate_material_grounding(initial_resume_tex, filtered_profile)
    if initial_issues:
        versions.append(MaterialVersion(
            version=1,
            optimization_round=0,
            resume_tex=None,
            resume_ats=None,
            decision="rejected_ungrounded",
            improvement=None,
            grounding_issues=initial_issues,
        ))
        return MaterialOptimizationResult(
            status="failed",
            selected_version=None,
            resume_tex=None,
            resume_ats=None,
            versions=versions,
            optimization_rounds=0,
            stop_reason="initial_material_ungrounded",
            warnings=warnings,
            errors=[_error("grounding", "Initial resume contains unsupported factual claims")],
        )

    try:
        raw_score = scorer(initial_resume_tex, jd_analysis, client)
        initial_ats = normalize_ats_result(raw_score)
    except Exception as exc:
        errors.append(_exception_error("score_initial", exc))
        versions.append(MaterialVersion(
            version=1,
            optimization_round=0,
            resume_tex=initial_resume_tex,
            resume_ats=None,
            decision="selected_unscored_fallback",
            improvement=None,
            grounding_issues=[],
        ))
        return MaterialOptimizationResult(
            status="degraded",
            selected_version=1,
            resume_tex=initial_resume_tex,
            resume_ats=None,
            versions=versions,
            optimization_rounds=0,
            stop_reason="initial_scoring_failed",
            warnings=["ATS scoring failed; returning the grounded initial resume."],
            errors=errors,
        )

    versions.append(MaterialVersion(
        version=1,
        optimization_round=0,
        resume_tex=initial_resume_tex,
        resume_ats=initial_ats,
        decision="selected_initial",
        improvement=None,
        grounding_issues=[],
    ))
    best_version = 1
    best_tex = initial_resume_tex
    best_ats = initial_ats
    current_tex = initial_resume_tex
    current_ats = initial_ats

    if initial_ats["overall_score"] >= target:
        return _result("completed", best_version, best_tex, best_ats, versions, 0,
                       "target_reached", warnings, errors)
    if round_limit == 0:
        return _result("completed", best_version, best_tex, best_ats, versions, 0,
                       "optimization_disabled", warnings, errors)

    completed_rounds = 0
    for round_number in range(1, round_limit + 1):
        try:
            candidate_tex = refiner(
                current_tex, current_ats["raw"], jd_analysis, filtered_profile, client
            )
        except Exception as exc:
            errors.append(_exception_error("refine", exc, round_number))
            warnings.append("Resume refinement failed; returning the best scored version.")
            return _result("degraded", best_version, best_tex, best_ats, versions,
                           completed_rounds, "refinement_failed", warnings, errors)

        completed_rounds = round_number
        if _canonical_tex(candidate_tex) == _canonical_tex(current_tex):
            warnings.append("Refinement produced no material change.")
            return _result("completed", best_version, best_tex, best_ats, versions,
                           completed_rounds, "unchanged_output", warnings, errors)

        grounding_issues = validate_material_grounding(candidate_tex, filtered_profile)
        if grounding_issues:
            versions.append(MaterialVersion(
                version=len(versions) + 1,
                optimization_round=round_number,
                resume_tex=None,
                resume_ats=None,
                decision="rejected_ungrounded",
                improvement=None,
                grounding_issues=grounding_issues,
            ))
            warnings.append("A refined version was rejected because it introduced unsupported facts.")
            return _result("degraded", best_version, best_tex, best_ats, versions,
                           completed_rounds, "ungrounded_refinement", warnings, errors)

        try:
            candidate_raw_score = scorer(candidate_tex, jd_analysis, client)
            candidate_ats = normalize_ats_result(candidate_raw_score)
        except Exception as exc:
            errors.append(_exception_error("score_refinement", exc, round_number))
            warnings.append("A refined version could not be scored; returning the best scored version.")
            return _result("degraded", best_version, best_tex, best_ats, versions,
                           completed_rounds, "refinement_scoring_failed", warnings, errors)

        delta = round(candidate_ats["overall_score"] - current_ats["overall_score"], 2)
        comparison = compare_material_versions(best_ats, candidate_ats)
        version_number = len(versions) + 1
        if comparison > 0:
            decision = "selected_better"
            best_version, best_tex, best_ats = version_number, candidate_tex, candidate_ats
        elif comparison < 0:
            decision = "rejected_regression"
        else:
            decision = "rejected_no_gain"
        versions.append(MaterialVersion(
            version=version_number,
            optimization_round=round_number,
            resume_tex=candidate_tex,
            resume_ats=candidate_ats,
            decision=decision,
            improvement=delta,
            grounding_issues=[],
        ))

        if candidate_ats["overall_score"] >= target:
            return _result("completed", best_version, best_tex, best_ats, versions,
                           completed_rounds, "target_reached", warnings, errors)
        if delta < 0:
            return _result("completed", best_version, best_tex, best_ats, versions,
                           completed_rounds, "score_regressed", warnings, errors)
        if delta < minimum_delta:
            return _result("completed", best_version, best_tex, best_ats, versions,
                           completed_rounds, "insufficient_improvement", warnings, errors)

        current_tex, current_ats = candidate_tex, candidate_ats

    warnings.append("ATS target was not reached within two optimization rounds.")
    return _result("completed", best_version, best_tex, best_ats, versions,
                   completed_rounds, "max_rounds_reached", warnings, errors)


def normalize_ats_result(result: dict) -> dict:
    """Normalize scorer output without ever treating keyword or job-fit as ATS overall."""
    if not isinstance(result, dict):
        raise ValueError("ATS scorer returned a non-object result")
    semantic = result.get("semantic")
    keyword = result.get("keyword_match")
    if not isinstance(semantic, dict) or not isinstance(keyword, dict):
        raise ValueError("ATS scorer result is missing semantic or keyword_match")
    overall = _required_score(semantic.get("overall_score"), "semantic.overall_score")
    return {
        "overall_score": overall,
        "keyword_score": _optional_score(semantic.get("keyword_score")),
        "keyword_match_score": _optional_score(keyword.get("score")),
        "relevance_score": _optional_score(semantic.get("relevance_score")),
        "impact_score": _optional_score(semantic.get("impact_score")),
        "suggestions": _string_list(semantic.get("suggestions")),
        "missing_critical": _string_list(semantic.get("missing_critical")),
        "strength": str(semantic.get("strength") or ""),
        "raw": result,
    }


def compare_material_versions(left_ats: dict, right_ats: dict) -> int:
    """Return 1 when right is better, -1 when worse, and 0 when tied."""
    left = _required_score(left_ats.get("overall_score"), "left overall_score")
    right = _required_score(right_ats.get("overall_score"), "right overall_score")
    if right > left:
        return 1
    if right < left:
        return -1
    # Overall is authoritative; keyword coverage only breaks exact overall ties.
    left_keyword = _optional_score(left_ats.get("keyword_match_score")) or 0.0
    right_keyword = _optional_score(right_ats.get("keyword_match_score")) or 0.0
    return 1 if right_keyword > left_keyword else (-1 if right_keyword < left_keyword else 0)


def validate_material_grounding(resume_tex: str, filtered_profile: dict) -> list[str]:
    """Reject new quantified claims that are absent from candidate-provided facts.

    Rewriting prose cannot be proven by string matching, so generator/refiner
    prompts remain the primary semantic guard.  This deterministic backstop
    catches the highest-risk fabrication pattern: invented dates, scale, money,
    percentages, and other metrics.
    """
    source_numbers = _visible_numbers(json.dumps(filtered_profile, ensure_ascii=False))
    resume_numbers = _visible_numbers(_document_body(resume_tex))
    unsupported = sorted(resume_numbers - source_numbers)
    return [f"Unsupported numeric claim: {value}" for value in unsupported]


def _visible_numbers(text: str) -> set[str]:
    # Remove URLs/emails and LaTeX layout measurements before inspecting claims.
    cleaned = re.sub(r"https?://\S+|mailto:\S+|\S+@\S+", " ", str(text or ""))
    cleaned = re.sub(r"[-+]?\d+(?:\.\d+)?\s*(?:pt|in|cm|mm|em|ex)\b", " ", cleaned, flags=re.I)
    return {
        _normalize_number(match.group(0))
        for match in re.finditer(r"(?<![A-Za-z\\])\d+(?:[.,]\d+)*(?:\s*%|\s+percent)?", cleaned, flags=re.I)
    }


def _document_body(tex: str) -> str:
    text = str(tex or "")
    marker = r"\begin{document}"
    body = text.split(marker, 1)[1] if marker in text else text
    # Comments are source annotations, not claims rendered on the resume.  Turn
    # escaped percent signs back into their visible form only after comments are
    # removed so a genuine ``20\%`` metric compares equal to profile text ``20%``.
    body = re.sub(r"(?m)(?<!\\)%.*$", "", body)
    return body.replace(r"\%", "%")


def _normalize_number(value: str) -> str:
    return re.sub(r"\s+", "", value).replace(",", "").lower()


def _canonical_tex(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _required_score(value, field: str) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid ATS score at {field}") from exc
    if not 0 <= score <= 100:
        raise ValueError(f"ATS score at {field} must be between 0 and 100")
    return score


def _optional_score(value) -> float | None:
    if value is None:
        return None
    return _required_score(value, "optional score")


def _bounded_score(value, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(0.0, min(parsed, 100.0))


def _coerce_float(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coerce_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _string_list(value) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _error(stage: str, message: str, round_number: int | None = None) -> dict:
    return {"stage": stage, "round": round_number, "type": "MaterialError", "message": message}


def _exception_error(stage: str, exc: Exception, round_number: int | None = None) -> dict:
    return {"stage": stage, "round": round_number, "type": type(exc).__name__, "message": str(exc)}


def _result(status, selected_version, resume_tex, resume_ats, versions,
            optimization_rounds, stop_reason, warnings, errors) -> MaterialOptimizationResult:
    return MaterialOptimizationResult(
        status=status,
        selected_version=selected_version,
        resume_tex=resume_tex,
        resume_ats=resume_ats,
        versions=versions,
        optimization_rounds=optimization_rounds,
        stop_reason=stop_reason,
        warnings=warnings,
        errors=errors,
    )
