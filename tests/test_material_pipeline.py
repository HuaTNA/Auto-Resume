import unittest
import json
from pathlib import Path
from types import SimpleNamespace

from src.material_optimizer import (
    compare_material_versions,
    optimize_material,
    validate_material_grounding,
)
from src.material_pipeline import _run_material_pipeline, run_material_pipeline
from src.material_pipeline_contract import (
    MATERIAL_PIPELINE_RESULT_SCHEMA,
    MATERIAL_VERSION_COMPARISON_RULES,
)


PROFILE = {
    "personal": {"name": "Ada Example"},
    "education": [],
    "skills": {"languages": ["Python"]},
    "experiences": [{
        "role": "Engineer", "company": "Acme", "bullets": [
            {"id": "b1", "text": "Improved pipeline throughput by 20%."}
        ],
    }],
    "projects": [],
}
JD = {"job_title": "Python Engineer", "required_skills": ["Python"], "ats_keywords": ["Python"]}


def ats(overall, keyword=50):
    return {
        "keyword_match": {"score": keyword, "matched": 1, "total_keywords": 1},
        "semantic": {
            "overall_score": overall,
            "keyword_score": keyword,
            "relevance_score": overall,
            "impact_score": overall,
            "suggestions": ["Use relevant wording"],
            "missing_critical": [],
            "strength": "Grounded experience",
        },
    }


class MaterialOptimizerTests(unittest.TestCase):
    def test_caps_optimization_at_two_rounds_and_keeps_scores_separate(self):
        scores = iter([ats(60), ats(70), ats(80)])
        refinements = []

        def scorer(*_):
            return next(scores)

        def refiner(current, *_):
            refinements.append(current)
            suffix = "one" if len(refinements) == 1 else "two"
            return current + f"\n% rewrite {suffix}\nstronger wording {suffix}"

        result = optimize_material(
            r"Grounded Python resume with 20\% impact", JD, PROFILE, object(),
            target_ats_score=95, max_optimization_rounds=99,
            scorer=scorer, refiner=refiner,
        ).to_dict()

        self.assertEqual(result["optimization_rounds"], 2)
        self.assertEqual(result["stop_reason"], "max_rounds_reached")
        self.assertEqual(len(result["versions"]), 3)
        self.assertEqual(result["resume_ats"]["overall_score"], 80)
        self.assertNotIn("match_score", result["resume_ats"])

    def test_stops_at_target_without_refining(self):
        result = optimize_material(
            r"Python resume with 20\% impact", JD, PROFILE, object(),
            target_ats_score=85,
            scorer=lambda *_: ats(90),
            refiner=lambda *_: self.fail("refiner should not run"),
        )
        self.assertEqual(result.stop_reason, "target_reached")
        self.assertEqual(result.optimization_rounds, 0)

    def test_stops_on_small_gain_and_selects_better_version(self):
        scores = iter([ats(70), ats(71)])
        result = optimize_material(
            r"Python resume with 20\% impact", JD, PROFILE, object(),
            min_improvement=2,
            scorer=lambda *_: next(scores),
            refiner=lambda current, *_: current + " stronger wording",
        )
        self.assertEqual(result.stop_reason, "insufficient_improvement")
        self.assertEqual(result.selected_version, 2)

    def test_regression_returns_best_previous_version(self):
        scores = iter([ats(78), ats(70)])
        result = optimize_material(
            r"Python resume with 20\% impact", JD, PROFILE, object(),
            scorer=lambda *_: next(scores),
            refiner=lambda current, *_: current + " rewrite",
        )
        self.assertEqual(result.stop_reason, "score_regressed")
        self.assertEqual(result.selected_version, 1)
        self.assertEqual(result.resume_ats["overall_score"], 78)

    def test_scoring_failure_returns_grounded_unscored_fallback(self):
        result = optimize_material(
            r"Python resume with 20\% impact", JD, PROFILE, object(),
            scorer=lambda *_: (_ for _ in ()).throw(RuntimeError("ATS offline")),
        )
        self.assertEqual(result.status, "degraded")
        self.assertEqual(result.selected_version, 1)
        self.assertIsNone(result.resume_ats)
        self.assertEqual(result.errors[0]["stage"], "score_initial")

    def test_rejects_unsupported_numeric_claims(self):
        issues = validate_material_grounding(
            r"Built a system used by 500 customers and improved it by 20\%.", PROFILE
        )
        self.assertIn("Unsupported numeric claim: 500", issues)
        self.assertFalse(any("20%" in issue for issue in issues))

    def test_compare_versions_uses_overall_then_keyword_tiebreaker(self):
        left = {"overall_score": 80, "keyword_match_score": 60}
        self.assertEqual(compare_material_versions(left, {"overall_score": 81, "keyword_match_score": 40}), 1)
        self.assertEqual(compare_material_versions(left, {"overall_score": 80, "keyword_match_score": 70}), 1)


class MaterialPipelineTests(unittest.TestCase):
    def test_returns_agent_ready_shape_without_blending_job_and_ats_scores(self):
        class Result:
            def to_dict(self):
                return {
                    "status": "completed", "selected_version": 1,
                    "resume_tex": "resume", "resume_ats": {"overall_score": 76},
                    "versions": [], "optimization_rounds": 0,
                    "stop_reason": "target_reached", "warnings": [], "errors": [],
                }

        result = _run_material_pipeline(
            PROFILE,
            {"title": "Engineer", "company": "Beta", "description": "Build Python", "match_reason": "Good role fit"},
            object(),
            job_match_score=91,
            jd_analyzer=lambda *_: JD,
            retriever=lambda profile, *_args, **_kwargs: profile,
            generator=lambda *_args, **_kwargs: "resume",
            optimizer=lambda *_args, **_kwargs: Result(),
        )

        self.assertEqual(result["job_match"]["score"], 91)
        self.assertEqual(result["resume_ats"]["overall_score"], 76)
        self.assertEqual(result["job_match"]["source"], "job_finder")
        self.assertNotIn("job_match", result["resume_ats"])

    def test_retrieval_failure_falls_back_to_full_profile(self):
        seen = {}

        def generator(profile, *_args, **_kwargs):
            seen["profile"] = profile
            return "resume"

        class Result:
            def to_dict(self):
                return {
                    "status": "degraded", "selected_version": 1,
                    "resume_tex": "resume", "resume_ats": None,
                    "versions": [], "optimization_rounds": 0,
                    "stop_reason": "initial_scoring_failed", "warnings": [], "errors": [],
                }

        result = _run_material_pipeline(
            PROFILE, {"description": "Build Python"}, object(), job_match_score=80,
            jd_analyzer=lambda *_: JD,
            retriever=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("retrieval offline")),
            generator=generator,
            optimizer=lambda *_args, **_kwargs: Result(),
        )
        self.assertIs(seen["profile"], PROFILE)
        self.assertEqual(result["errors"][0]["stage"], "retrieve_profile")
        self.assertTrue(result["warnings"])

    def test_generation_failure_is_structured(self):
        result = _run_material_pipeline(
            PROFILE, {"description": "Build Python"}, object(), job_match_score=80,
            jd_analyzer=lambda *_: JD,
            retriever=lambda profile, *_args, **_kwargs: profile,
            generator=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("generation offline")),
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["optimization"]["stop_reason"], "generate_resume_failed")
        self.assertEqual(result["errors"][-1]["stage"], "generate_resume")

    def test_invalid_job_match_score_is_structured_and_never_becomes_ats(self):
        result = _run_material_pipeline(
            PROFILE, {"description": "Build Python"}, object(), job_match_score=120,
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["errors"][0]["stage"], "validate_job_match")
        self.assertIsNone(result["resume_ats"])

    def test_optimizer_failure_does_not_leak_ungrounded_generated_resume(self):
        result = _run_material_pipeline(
            PROFILE, {"description": "Build Python"}, object(), job_match_score=80,
            jd_analyzer=lambda *_: JD,
            retriever=lambda profile, *_args, **_kwargs: profile,
            generator=lambda *_args, **_kwargs: "Served 999 customers",
            optimizer=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("optimizer offline")),
        )
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["material"]["resume_tex"])
        self.assertEqual(result["versions"][0]["decision"], "rejected_ungrounded")

    def test_public_interface_enforces_model_budget_and_reports_usage(self):
        calls = []

        def create(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(content=[SimpleNamespace(text='{"job_title":"Engineer"}')])

        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        result = run_material_pipeline(
            PROFILE, {"description": "Build Python"}, client,
            job_match_score=80, max_model_calls=1,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["usage"]["model_calls"], 1)
        self.assertEqual(result["usage"]["max_model_calls"], 1)
        self.assertEqual(result["status"], "failed")

    def test_contract_fixtures_have_stable_top_level_schema(self):
        fixture_dir = Path(__file__).parent / "fixtures" / "material_pipeline"
        required = set(MATERIAL_PIPELINE_RESULT_SCHEMA["required"])
        for name in ("success.json", "ats_not_met.json", "ai_failure.json"):
            payload = json.loads((fixture_dir / name).read_text(encoding="utf-8"))
            self.assertEqual(set(payload), required)
            self.assertEqual(payload["schema_version"], "1.0")
            self.assertNotEqual(payload["job"]["url"].split("/")[2] if payload["job"]["url"] else "", "")

    def test_version_comparison_rules_are_public_and_explicit(self):
        rules = " ".join(MATERIAL_VERSION_COMPARISON_RULES)
        self.assertIn("overall_score", rules)
        self.assertIn("keyword_match_score", rules)
        self.assertIn("earlier version", rules)


if __name__ == "__main__":
    unittest.main()
