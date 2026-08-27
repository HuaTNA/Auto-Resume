"""Public, implementation-independent contract for resume material generation."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


PipelineStatus = Literal["completed", "degraded", "failed"]


class JobSummary(TypedDict):
    title: str
    company: str
    url: str


class JobMatchResult(TypedDict):
    score: float | None
    reason: str
    source: Literal["job_finder"]


class PipelineError(TypedDict):
    stage: str
    type: str
    message: str
    round: NotRequired[int | None]


class SelectedMaterial(TypedDict):
    resume_tex: str | None
    selected_version: int | None


class OptimizationSummary(TypedDict, total=False):
    rounds: int
    max_rounds: int
    stop_reason: str


class ModelUsage(TypedDict):
    model_calls: int
    max_model_calls: int
    estimated_input_tokens: int
    max_input_tokens: int
    reserved_output_tokens: int
    max_output_tokens: int


class MaterialPipelineResult(TypedDict):
    schema_version: str
    status: PipelineStatus
    job: JobSummary
    job_match: JobMatchResult
    job_analysis: dict | None
    resume_ats: dict | None
    material: SelectedMaterial
    versions: list[dict]
    optimization: OptimizationSummary
    usage: ModelUsage
    warnings: list[str]
    errors: list[PipelineError]


MATERIAL_VERSION_COMPARISON_RULES = (
    "Reject versions with unsupported candidate facts before scoring.",
    "Compare valid versions by resume_ats.overall_score.",
    "When overall scores tie, prefer the higher keyword_match_score.",
    "When both scores tie, retain the earlier version to avoid needless churn.",
    "A regression never replaces the best previously accepted version.",
)


MATERIAL_PIPELINE_RESULT_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "MaterialPipelineResult",
    "type": "object",
    "required": [
        "schema_version", "status", "job", "job_match", "job_analysis",
        "resume_ats", "material", "versions", "optimization", "usage",
        "warnings", "errors",
    ],
    "properties": {
        "schema_version": {"const": "1.0"},
        "status": {"enum": ["completed", "degraded", "failed"]},
        "job": {
            "type": "object",
            "required": ["title", "company", "url"],
            "properties": {
                "title": {"type": "string"},
                "company": {"type": "string"},
                "url": {"type": "string"},
            },
        },
        "job_match": {
            "type": "object",
            "required": ["score", "reason", "source"],
            "properties": {
                "score": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
                "reason": {"type": "string"},
                "source": {"const": "job_finder"},
            },
        },
        "job_analysis": {"type": ["object", "null"]},
        "resume_ats": {"type": ["object", "null"]},
        "material": {
            "type": "object",
            "required": ["resume_tex", "selected_version"],
            "properties": {
                "resume_tex": {"type": ["string", "null"]},
                "selected_version": {"type": ["integer", "null"], "minimum": 1},
            },
        },
        "versions": {"type": "array", "items": {"type": "object"}},
        "optimization": {
            "type": "object",
            "required": ["rounds", "stop_reason"],
            "properties": {
                "rounds": {"type": "integer", "minimum": 0, "maximum": 2},
                "max_rounds": {"type": "integer", "minimum": 0, "maximum": 2},
                "stop_reason": {"type": "string"},
            },
        },
        "usage": {
            "type": "object",
            "required": [
                "model_calls", "max_model_calls", "estimated_input_tokens",
                "max_input_tokens", "reserved_output_tokens", "max_output_tokens",
            ],
            "properties": {
                "model_calls": {"type": "integer", "minimum": 0},
                "max_model_calls": {"type": "integer", "minimum": 1, "maximum": 11},
                "estimated_input_tokens": {"type": "integer", "minimum": 0},
                "max_input_tokens": {"type": "integer", "minimum": 1, "maximum": 120000},
                "reserved_output_tokens": {"type": "integer", "minimum": 0},
                "max_output_tokens": {"type": "integer", "minimum": 1, "maximum": 23700},
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
        "errors": {"type": "array", "items": {"type": "object"}},
    },
    "additionalProperties": False,
}
