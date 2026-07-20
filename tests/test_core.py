import os
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from api.auth import create_oauth_state, decode_oauth_state, get_secret_key
from api.database import Base, CareerApplication, CareerJob, HistoryRecord, User, _build_db_url
from api.limits import enforce_external_api_limit
from api.oauth import decrypt_credentials, encrypt_credentials, provider_statuses
from api.routes.auth import _authorize_registration, _registration_mode
from api.server import _validate_latex_safety, _wrap_cover_letter_tex
from api.workflows.job_search import _job_qualifies, ensure_application_for_job
from api.workflows.scheduling import next_run_at
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.ai_config import DEFAULT_ANTHROPIC_MODEL, get_anthropic_model
from src.ai_json import AIResponseFormatError, request_json
from src.job_finder import _indeed_country, _indeed_job_key, search_jobs
from src.pdf_renderer import latex_to_blocks, render_latex_fallback


class CoreTests(unittest.TestCase):
    def test_structured_ai_response_retries_after_truncated_json(self):
        responses = [
            SimpleNamespace(content=[SimpleNamespace(text='{"job_title": "AI Eng')]),
            SimpleNamespace(content=[SimpleNamespace(text='```json\n{"job_title": "AI Engineer"}\n```')]),
        ]
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **_: responses.pop(0)))
        result = request_json(client, "Analyze", expected_type=dict, max_tokens=10, retry_tokens=20)
        self.assertEqual(result, {"job_title": "AI Engineer"})
        self.assertEqual(responses, [])

    def test_structured_ai_response_has_safe_error_after_retry(self):
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **_: SimpleNamespace(
            content=[SimpleNamespace(text='{"still": "truncated')]
        )))
        with self.assertRaisesRegex(AIResponseFormatError, "Please retry generation"):
            request_json(client, "Analyze", expected_type=dict, max_tokens=10)

    def test_indeed_normalization_and_multi_source_deduplication(self):
        self.assertEqual(_indeed_country("canada"), "Canada")
        self.assertEqual(_indeed_country("us"), "USA")
        self.assertEqual(_indeed_job_key("https://ca.indeed.com/viewjob?jk=abc123"), "abc123")
        indeed_job = {"title": "ML Engineer", "company": "Acme", "location": "Toronto", "url": "https://indeed.test/1", "source": "indeed"}
        adzuna_duplicate = {"title": "ML Engineer", "company": "Acme", "location": "Toronto", "url": "https://adzuna.test/1", "source": "adzuna"}
        with patch("src.job_finder.search_indeed", return_value=[indeed_job]), patch("src.job_finder.search_adzuna", return_value=[adzuna_duplicate]):
            jobs, warnings = search_jobs("ML Engineer", app_id="id", app_key="key")
        self.assertEqual(jobs, [indeed_job])
        self.assertEqual(warnings, [])

    def test_database_parts_encode_password_and_require_ssl(self):
        with patch.dict(os.environ, {
            "DATABASE_URL": "",
            "DB_HOST": "aws-0-us-east-1.pooler.supabase.com",
            "DB_USER": "postgres.project-ref",
            "DB_PASSWORD": "p@ss#word",
            "DB_PORT": "6543",
            "DB_NAME": "postgres",
        }):
            self.assertEqual(
                _build_db_url(),
                "postgresql://postgres.project-ref:p%40ss%23word@"
                "aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
            )

    def test_signing_secret_is_strong_and_oauth_state_is_bound(self):
        self.assertGreaterEqual(len(get_secret_key().encode()), 32)
        state = create_oauth_state(42, "notion")
        self.assertEqual(decode_oauth_state(state, "notion")["sub"], "42")
        with self.assertRaises(Exception):
            decode_oauth_state(state, "google-calendar")

    def test_encrypted_credentials_round_trip_without_plaintext(self):
        payload = {"access_token": "private-access-token", "refresh_token": "private-refresh-token"}
        ciphertext = encrypt_credentials(payload)
        self.assertNotIn("private-access-token", ciphertext)
        self.assertEqual(decrypt_credentials(ciphertext), payload)

    def test_schedule_parser(self):
        after = datetime(2026, 7, 17, 13, 30)
        self.assertEqual(next_run_at("hourly", after), datetime(2026, 7, 17, 14, 0))
        self.assertEqual(next_run_at("daily@09:00", after), datetime(2026, 7, 18, 13, 0))
        self.assertIsNone(next_run_at("manual", after))

    def test_portable_pdf_and_latex_extraction(self):
        tex = r"""\documentclass{article}
\begin{document}
\section{Experience}
\resumeItem{Built a \textbf{Python} service with 30\% lower latency.}
\end{document}"""
        blocks = latex_to_blocks(tex)
        self.assertIn(("bullet", "Built a Python service with 30% lower latency."), blocks)
        pdf = render_latex_fallback(tex)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 1000)

    def test_model_is_current_and_configurable(self):
        previous = os.environ.pop("ANTHROPIC_MODEL", None)
        try:
            self.assertEqual(get_anthropic_model(), DEFAULT_ANTHROPIC_MODEL)
            os.environ["ANTHROPIC_MODEL"] = "test-model"
            self.assertEqual(get_anthropic_model(), "test-model")
        finally:
            if previous is None: os.environ.pop("ANTHROPIC_MODEL", None)
            else: os.environ["ANTHROPIC_MODEL"] = previous

    def test_provider_status_never_exposes_secrets(self):
        serialized = repr(provider_statuses()).lower()
        self.assertNotIn("client_secret", serialized)
        self.assertNotIn("access_token", serialized)

    def test_production_registration_defaults_to_invite_and_checks_code(self):
        previous = {name: os.environ.get(name) for name in ("PRODUCTION", "REGISTRATION_MODE", "REGISTRATION_INVITE_CODE")}
        try:
            os.environ["PRODUCTION"] = "true"
            os.environ.pop("REGISTRATION_MODE", None)
            os.environ["REGISTRATION_INVITE_CODE"] = "mvp-invite"
            self.assertEqual(_registration_mode(), "invite")
            with self.assertRaises(HTTPException):
                _authorize_registration("wrong")
            _authorize_registration("mvp-invite")
        finally:
            for name, value in previous.items():
                if value is None: os.environ.pop(name, None)
                else: os.environ[name] = value

    def test_latex_safety_rejects_file_access(self):
        with self.assertRaises(HTTPException):
            _validate_latex_safety(r"\input{/etc/passwd}")
        _validate_latex_safety(r"\documentclass{article}\begin{document}Safe\end{document}")

    def test_cover_letter_escaping_does_not_reescape_inserted_commands(self):
        tex = _wrap_cover_letter_tex(r"Path C:\work & 50%")
        self.assertIn(r"\textbackslash{}", tex)
        self.assertNotIn(r"\textbackslash\{\}", tex)
        self.assertIn(r"\&", tex)

    def test_unranked_jobs_never_bypass_minimum_score(self):
        self.assertFalse(_job_qualifies(95, 60, "AI ranking unavailable"))
        self.assertFalse(_job_qualifies(59, 60, None))
        self.assertTrue(_job_qualifies(60, 60, None))

    def test_daily_external_api_quota_is_persistent(self):
        previous = os.environ.get("API_DAILY_UNITS_PER_USER")
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)()
        try:
            os.environ["API_DAILY_UNITS_PER_USER"] = "2"
            user = User(email="quota@example.com", password_hash="unused")
            session.add(user)
            session.commit()
            enforce_external_api_limit(session, user, check_burst=False)
            enforce_external_api_limit(session, user, check_burst=False)
            with self.assertRaises(HTTPException) as raised:
                enforce_external_api_limit(session, user, check_burst=False)
            self.assertEqual(raised.exception.status_code, 429)
        finally:
            session.close()
            engine.dispose()
            if previous is None: os.environ.pop("API_DAILY_UNITS_PER_USER", None)
            else: os.environ["API_DAILY_UNITS_PER_USER"] = previous

    def test_user_selected_job_creates_one_idempotent_review_record(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)()
        try:
            user = User(email="selection@example.com", password_hash="unused")
            session.add(user); session.flush()
            job = CareerJob(public_id="job-selection", user_id=user.id, title="AI Engineer", company="Acme")
            session.add(job); session.flush()
            first = ensure_application_for_job(session, user, job)
            second = ensure_application_for_job(session, user, job)
            self.assertEqual(first.id, second.id)
            self.assertEqual(session.query(CareerApplication).count(), 1)
            self.assertEqual(session.query(HistoryRecord).count(), 1)
            self.assertEqual(first.approval_status, "pending")
        finally:
            session.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
