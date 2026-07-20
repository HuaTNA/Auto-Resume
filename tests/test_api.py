import os
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.database import Base, HistoryRecord, get_db
from api.server import app


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.previous_env = {name: os.environ.get(name) for name in ("REGISTRATION_MODE", "JWT_SECRET", "PRODUCTION")}
        os.environ["REGISTRATION_MODE"] = "open"
        os.environ["JWT_SECRET"] = "a" * 64
        os.environ["PRODUCTION"] = "false"
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        def override_db():
            session = self.Session()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_db
        self.client_a = TestClient(app)
        self.client_b = TestClient(app)
        self._register(self.client_a, "a@example.com")
        self._register(self.client_b, "b@example.com")

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client_a.close()
        self.client_b.close()
        self.engine.dispose()
        for name, value in self.previous_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def _register(self, client: TestClient, email: str):
        response = client.post("/api/auth/register", json={"email": email, "password": "strong-password"})
        self.assertEqual(response.status_code, 200, response.text)

    def _user_id(self, email: str) -> int:
        session = self.Session()
        try:
            from api.database import User
            return session.query(User).filter(User.email == email).one().id
        finally:
            session.close()

    def test_workspace_data_is_isolated_between_users(self):
        created = self.client_a.post("/api/workspace/projects", json={"title": "Private project"})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(len(self.client_a.get("/api/workspace").json()["projects"]), 1)
        self.assertEqual(self.client_b.get("/api/workspace").json()["projects"], [])

    def test_profile_completeness_blocks_empty_profile(self):
        empty = self.client_a.get("/api/profile/completeness")
        self.assertEqual(empty.status_code, 200)
        self.assertFalse(empty.json()["ready"])
        profile = {
            "personal": {"name": "A", "email": "a@example.com"},
            "experiences": [{"id": "exp-1", "bullets": [{"id": "b-1", "text": "Built a service"}]}],
        }
        self.assertEqual(self.client_a.put("/api/profile", json=profile).status_code, 200)
        self.assertTrue(self.client_a.get("/api/profile/completeness").json()["ready"])

    def test_generation_submission_is_idempotent(self):
        profile = {"experiences": [{"id": "exp-1", "bullets": [{"id": "b-1", "text": "Built a service"}]}]}
        self.client_a.put("/api/profile", json=profile)
        payload = {"jd_text": "A" * 80, "template": "classic", "top_k": 12, "generate_cover_letter": False}
        with patch("api.server._execute_generation_job", return_value=None):
            first = self.client_a.post("/api/generation-jobs", json=payload, headers={"Idempotency-Key": "same-request"})
            second = self.client_a.post("/api/generation-jobs", json=payload, headers={"Idempotency-Key": "same-request"})
            changed = self.client_a.post("/api/generation-jobs", json={**payload, "template": "modern"}, headers={"Idempotency-Key": "same-request"})
        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(second.status_code, 202, second.text)
        self.assertEqual(first.json()["job"]["id"], second.json()["job"]["id"])
        self.assertEqual(changed.status_code, 409)

    def test_pdf_endpoint_cannot_read_another_users_record(self):
        session = self.Session()
        try:
            record = HistoryRecord(
                user_id=self._user_id("b@example.com"), timestamp=datetime.utcnow().isoformat(),
                job_title="Role", company="Company", required_skills="[]", ats_scores="{}",
                output_files="[]", resume_tex=r"\documentclass{article}\begin{document}Private\end{document}",
            )
            session.add(record)
            session.commit()
            record_id = record.id
        finally:
            session.close()
        response = self.client_a.post("/api/compile-pdf", json={"record_id": record_id})
        self.assertEqual(response.status_code, 404)

    def test_career_document_version_updates_download_source(self):
        session = self.Session()
        try:
            record = HistoryRecord(
                user_id=self._user_id("a@example.com"), timestamp=datetime.utcnow().isoformat(),
                job_title="Role", company="Company", required_skills="[]", ats_scores="{}",
                output_files="[]", resume_tex="version one",
            )
            session.add(record)
            session.commit()
            record_id = record.id
        finally:
            session.close()
        documents = self.client_a.get("/api/documents").json()["documents"]
        resume = next(item for item in documents if item["source_record_id"] == record_id and item["kind"] == "resume")
        response = self.client_a.post(f"/api/documents/{resume['id']}/versions", json={"content": "version two"})
        self.assertEqual(response.status_code, 201, response.text)
        session = self.Session()
        try:
            self.assertEqual(session.query(HistoryRecord).filter(HistoryRecord.id == record_id).one().resume_tex, "version two")
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
