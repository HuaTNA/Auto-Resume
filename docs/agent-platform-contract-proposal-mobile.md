# Mobile integration contract proposal (not approved)

Status: proposal only. This file does not modify or extend Application Agent Contract v1 until backend, material pipeline, OpenClaw, Discord, and mobile owners approve it.

## Why this is needed

The mobile confirmation action must show company/role, selected resume version, resume ATS score, all submitted answers, and final application domain. The current v1 Agent response includes company/role, ATS score, answers, and job `source_url`, but does not expose the selected material version or the public MaterialPipeline result summary. Production mobile therefore disables approval when the selected resume version is absent. Mock data contains the proposed fields only for staging UI development.

## Proposed additive Agent response fields

Add the following optional object to canonical `agent` responses:

```json
{
  "material_pipeline": {
    "schema_version": "1.0",
    "status": "completed",
    "selected_resume_version": 2,
    "optimization": {
      "rounds": 1,
      "max_rounds": 2,
      "stop_reason": "target_reached"
    },
    "usage": {
      "model_calls": 6,
      "max_model_calls": 11,
      "estimated_input_tokens": 24000,
      "max_input_tokens": 120000,
      "reserved_output_tokens": 13100,
      "max_output_tokens": 23700
    },
    "warnings": [],
    "errors": []
  },
  "submission_preview": {
    "company": "Example Robotics",
    "job_title": "Python Engineer",
    "resume_version": 2,
    "resume_ats_score": 88,
    "answers": [],
    "final_domain": "jobs.example.test",
    "content_digest": "sha256:..."
  }
}
```

Rules:

- Populate the pipeline object only from `src.material_pipeline.run_material_pipeline(...) -> MaterialPipelineResult`; clients must not depend on optimizer internals.
- Keep job match and resume ATS scores distinct.
- Compute `final_domain` server-side from the validated destination URL, not from arbitrary client text.
- Bind `submission_preview` to the same canonical content digest used by approval. An edit creates a new preview/digest.
- Return answers in their exact submitted order while continuing to treat their text as untrusted display data.
- Do not include resume/JD bodies, tokens, cookies, DOM, or adapter credentials.

## Device and account settings

Contract v1 has no Agent settings resource. The current mobile implementation stores clearly labeled, non-authoritative device preferences in browser storage. If cross-device settings are required, propose a separate versioned authenticated resource later; do not overload application state or OpenClaw configuration.

## Acceptance before adoption

- Backend schema/route owners approve naming and ownership.
- MaterialPipeline owner confirms lossless public-result mapping.
- OpenClaw and Discord owners confirm the preview matches dispatch fields.
- Contract tests prove digest/domain/version consistency and PII-safe responses.
- Mobile tests prove confirmation remains disabled for an incomplete or stale preview.
