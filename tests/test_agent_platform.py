import os
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.database import (
    ApplicationAgent,
    Base,
    CareerApplication,
    CareerJob,
    HistoryRecord,
    SubmissionCallbackEvent,
    SubmissionReceipt,
    User,
    get_db,
)
from api.server import app
from api.schemas.agent import AgentAction, AgentState
from api.workflows.application_agent import TRANSITIONS, digest


class AgentPlatformUnitTests(unittest.TestCase):
    def test_state_machine_contract_has_no_approval_or_submission_shortcut(self):
        self.assertEqual(
            TRANSITIONS[AgentAction.START][AgentState.DISCOVERED], AgentState.PREPARING,
        )
        self.assertNotIn(AgentState.DISCOVERED, TRANSITIONS[AgentAction.REQUEST_APPROVAL])
        self.assertTrue(all(next_state != AgentState.SUBMITTING
                            for transitions in TRANSITIONS.values()
                            for next_state in transitions.values()))

    def test_canonical_digest_is_order_independent_and_content_sensitive(self):
        self.assertEqual(digest({"b": 2, "a": 1}), digest({"a": 1, "b": 2}))
        self.assertNotEqual(digest({"answer": "yes"}), digest({"answer": "no"}))


class AgentPlatformApiTests(unittest.TestCase):
    def setUp(self):
        names = (
            "REGISTRATION_MODE", "JWT_SECRET", "PRODUCTION",
            "AGENT_CALLBACK_SECRET", "AUTO_RESUME_SERVICE_TOKEN",
        )
        self.previous_env = {name: os.environ.get(name) for name in names}
        os.environ.update({
            "REGISTRATION_MODE": "open",
            "JWT_SECRET": "b" * 64,
            "PRODUCTION": "false",
            "AGENT_CALLBACK_SECRET": "agent-callback-secret-for-tests",
            "AUTO_RESUME_SERVICE_TOKEN": "agent-service-token-for-tests-1234567890",
        })
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
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
        self.client = TestClient(app)
        response = self.client.post("/api/auth/register", json={
            "email": "agent@example.com", "password": "strong-password",
        })
        self.assertEqual(response.status_code, 200, response.text)
        with self.Session() as session:
            self.user_id = session.query(User).filter(User.email == "agent@example.com").one().id

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()
        self.engine.dispose()
        for name, value in self.previous_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def _seed_job(self, public_id: str = "job-agent") -> None:
        with self.Session() as session:
            session.add(CareerJob(
                public_id=public_id, user_id=self.user_id, title="Platform Engineer",
                company="Acme", source="indeed", location="Toronto",
            ))
            session.commit()

    def _create_batch(self, key: str = "batch-key") -> dict:
        response = self.client.post(
            "/api/agent/recommendation-batches",
            json={"job_ids": ["job-agent"], "label": "Top roles"},
            headers={"Idempotency-Key": key},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _prepare_approval(self) -> tuple[str, str]:
        batch = self._create_batch()
        agent_id = batch["items"][0]["agent_id"]
        application_id = batch["items"][0]["application_id"]
        with self.Session() as session:
            application = session.query(CareerApplication).filter_by(public_id=application_id).one()
            history = session.query(HistoryRecord).filter_by(id=application.history_record_id).one()
            history.resume_tex = "approved resume"
            history.cover_letter = "approved cover letter"
            session.commit()
        started = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "start", "expected_version": 1},
        )
        self.assertEqual(started.status_code, 200, started.text)
        awaiting = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "request_approval", "expected_version": 2},
        )
        self.assertEqual(awaiting.status_code, 200, awaiting.text)
        approval = self.client.post(
            f"/api/agent/applications/{agent_id}/approvals", json={"note": "Reviewed"},
        )
        self.assertEqual(approval.status_code, 201, approval.text)
        approval_id = approval.json()["approval"]["id"]
        decided = self.client.post(
            f"/api/agent/approvals/{approval_id}/decision",
            json={"decision": "approved", "expected_version": 3},
        )
        self.assertEqual(decided.status_code, 200, decided.text)
        return agent_id, application_id

    def test_recommendation_batch_is_idempotent_and_user_scoped(self):
        self._seed_job()
        first = self._create_batch()
        second = self._create_batch()
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["items"][0]["agent_state"], "discovered")
        conflict = self.client.post(
            "/api/agent/recommendation-batches",
            json={"job_ids": ["job-agent"], "label": "Changed"},
            headers={"Idempotency-Key": "batch-key"},
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "agent.idempotency_conflict")

    def test_discord_bridge_service_auth_requires_bound_identity(self):
        self._seed_job()
        batch = self._create_batch()
        discord_user_id = "123456789012345678"
        connected = self.client.put("/api/integrations/discord", json={
            "state": "connected", "external_account": discord_user_id,
            "scopes": ["agent:read", "agent:write"], "config": {},
        })
        self.assertEqual(connected.status_code, 200, connected.text)
        headers = {
            "Authorization": "Bearer agent-service-token-for-tests-1234567890",
            "X-Discord-User-Id": discord_user_id,
            "X-Discord-Channel-Id": "223456789012345678",
            "X-Discord-Message-Id": "323456789012345678",
            "Idempotency-Key": "discord-service-read",
        }
        bridge = TestClient(app)
        try:
            response = bridge.get(
                f"/api/agent/recommendation-batches/{batch['id']}", headers=headers,
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["id"], batch["id"])
            unknown = bridge.get(
                f"/api/agent/recommendation-batches/{batch['id']}",
                headers={**headers, "X-Discord-User-Id": "999999999999999999"},
            )
            self.assertEqual(unknown.status_code, 401)
            disconnected = self.client.delete("/api/integrations/discord")
            self.assertEqual(disconnected.status_code, 200)
            revoked = bridge.get(
                f"/api/agent/recommendation-batches/{batch['id']}", headers=headers,
            )
            self.assertEqual(revoked.status_code, 401)
        finally:
            bridge.close()

    def test_discord_binding_validates_id_and_rejects_duplicate_account(self):
        for invalid in ("tanner2147", "1234", "1" * 23, "１２３４５６７８９０１２３４５", ""):
            response = self.client.put("/api/integrations/discord", json={"external_account": invalid})
            self.assertEqual(response.status_code, 400, response.text)
        discord_id = "123456789012345678"
        connected = self.client.put("/api/integrations/discord", json={"external_account": f" {discord_id} "})
        self.assertEqual(connected.status_code, 200, connected.text)
        self.assertEqual(connected.json()["integration"]["external_account"], discord_id)
        rows = self.client.get("/api/integrations").json()["integrations"]
        self.assertEqual(next(row for row in rows if row["provider"] == "discord")["external_account"], discord_id)
        with TestClient(app) as other:
            anonymous = other.put("/api/integrations/discord", json={"external_account": discord_id})
            self.assertEqual(anonymous.status_code, 401)
            registered = other.post("/api/auth/register", json={"email": "other@example.com", "password": "strong-password"})
            self.assertEqual(registered.status_code, 200, registered.text)
            duplicate = other.put("/api/integrations/discord", json={"external_account": discord_id})
            self.assertEqual(duplicate.status_code, 409)
            self.assertEqual(other.delete("/api/integrations/discord").status_code, 404)
        self.assertEqual(self.client.get("/api/integrations").json()["integrations"][0]["external_account"], discord_id)

    def test_discord_search_persists_website_results_and_replays_without_new_search(self):
        job = {"title": "Junior Engineer", "company": "Test Company", "location": "Toronto",
               "source": "indeed", "url": "https://jobs.example.test/junior", "description": "Python SQL",
               "created": datetime.utcnow().isoformat(), "match_score": 88, "match_reason": "Test fixture"}
        with patch("api.workflows.job_search.execute_search_plan", return_value=([job], [])) as search, \
                patch("api.workflows.job_search.rank_jobs", return_value=[job]):
            response = self.client.post("/api/agent/searches", json={"query": "Junior Engineer", "location": "Toronto"}, headers={"Idempotency-Key": "discord-search-1"})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["status"], "completed", result)
            self.assertEqual(result["batch"]["items"][0]["job"]["title"], "Junior Engineer")
            self.assertEqual(result["batch"]["items"][0]["agent_state"], "discovered")
            replay = self.client.post("/api/agent/searches", json={"query": "Junior Engineer", "location": "Toronto"}, headers={"Idempotency-Key": "discord-search-1"})
            self.assertEqual(replay.json()["operation_id"], result["operation_id"])
            self.assertEqual(search.call_count, 1)
            conflict = self.client.post("/api/agent/searches", json={"query": "Different"}, headers={"Idempotency-Key": "discord-search-1"})
            self.assertEqual(conflict.status_code, 409)
        status = self.client.get(f"/api/agent/searches/{result['operation_id']}")
        self.assertEqual(status.json()["status"], "completed")
        workspace = self.client.get("/api/agent/workspace").json()
        self.assertEqual(workspace["saved_job_count"], 1)
        self.assertEqual(workspace["latest_batch"]["id"], result["batch"]["id"])
        self.assertEqual(workspace["searches"], [])  # One-off searches must not schedule themselves.
        with TestClient(app) as other:
            self.assertEqual(other.get("/api/agent/workspace").status_code, 401)
            other.post("/api/auth/register", json={"email": "search-other@example.com", "password": "strong-password"})
            self.assertEqual(other.get(f"/api/agent/searches/{result['operation_id']}").status_code, 404)
            self.assertEqual(other.get("/api/agent/workspace").json()["saved_job_count"], 0)

    def test_discord_search_failure_remains_visible_and_is_not_reexecuted(self):
        with patch("api.workflows.job_search.execute_search_plan", side_effect=RuntimeError("Search provider offline")) as search:
            args = {"json": {"query": "Engineer"}, "headers": {"Idempotency-Key": "failed-search"}}
            response = self.client.post("/api/agent/searches", **args)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "failed")
            self.assertIsNone(response.json()["batch"])
            self.client.post("/api/agent/searches", **args)
            self.assertEqual(search.call_count, 1)

    def test_state_machine_rejects_stale_version_and_missing_materials(self):
        self._seed_job()
        agent_id = self._create_batch()["items"][0]["agent_id"]
        started = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "start", "expected_version": 1},
        )
        self.assertEqual(started.status_code, 200)
        stale = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "request_answers", "expected_version": 1},
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "agent.invalid_state_transition")
        no_materials = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "request_approval", "expected_version": 2},
        )
        self.assertEqual(no_materials.status_code, 409)
        self.assertEqual(no_materials.json()["detail"]["code"], "agent.materials_required")

    def test_selected_agent_prepares_materials_idempotently(self):
        self._seed_job()
        agent_id = self._create_batch()["items"][0]["agent_id"]
        started = self.client.post(
            f"/api/agent/applications/{agent_id}/transitions",
            json={"action": "start", "expected_version": 1},
        )
        self.assertEqual(started.status_code, 200, started.text)

        def fake_generate(db, _user, application, **kwargs):
            history = db.query(HistoryRecord).filter_by(id=application.history_record_id).one()
            history.resume_tex = "generated resume"
            history.cover_letter = "generated cover letter"
            history.ats_scores = '{"overall": 86, "keyword_pct": 82}'
            application.status = "generated"
            db.commit()
            self.assertEqual(kwargs["max_optimization_rounds"], 2)
            return history

        with patch("api.routes.agent.generate_application_materials", side_effect=fake_generate) as generate:
            prepared = self.client.post(
                f"/api/agent/applications/{agent_id}/materials",
                json={"target_ats_score": 85, "max_optimization_rounds": 2,
                      "template": "classic", "generate_cover_letter": True},
                headers={"Idempotency-Key": "prepare-materials"},
            )
            replay = self.client.post(
                f"/api/agent/applications/{agent_id}/materials",
                json={"target_ats_score": 85, "max_optimization_rounds": 2,
                      "template": "classic", "generate_cover_letter": True},
                headers={"Idempotency-Key": "prepare-materials"},
            )
            conflict = self.client.post(
                f"/api/agent/applications/{agent_id}/materials",
                json={"target_ats_score": 90, "max_optimization_rounds": 1,
                      "template": "classic", "generate_cover_letter": True},
                headers={"Idempotency-Key": "prepare-materials"},
            )
        self.assertEqual(prepared.status_code, 200, prepared.text)
        self.assertEqual(prepared.json()["agent"]["ats_score"], 86)
        self.assertTrue(any(event["kind"] == "material"
                            for event in prepared.json()["agent"]["timeline"]))
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()["detail"]["code"], "agent.idempotency_conflict")
        generate.assert_called_once()

    def test_answer_library_and_application_answers_are_isolated_resources(self):
        created = self.client.post("/api/agent/answers", json={
            "question_key": "work.authorization", "question": "Authorized to work?",
            "answer": "Yes", "category": "eligibility", "reusable": True,
        })
        self.assertEqual(created.status_code, 201, created.text)
        answer_id = created.json()["answer"]["id"]
        updated = self.client.patch(f"/api/agent/answers/{answer_id}", json={"answer": "Yes, in Canada"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["answer"]["version"], 2)
        self.assertEqual(len(self.client.get("/api/agent/answers").json()["answers"]), 1)

    def test_submission_requires_current_approval_and_is_idempotent(self):
        self._seed_job()
        agent_id, application_id = self._prepare_approval()
        missing_key = self.client.post(
            f"/api/agent/applications/{agent_id}/submissions", json={"provider": "browser"},
        )
        self.assertEqual(missing_key.status_code, 400)
        self.assertEqual(missing_key.json()["detail"]["code"], "agent.idempotency_required")

        with self.Session() as session:
            application = session.query(CareerApplication).filter_by(public_id=application_id).one()
            history = session.query(HistoryRecord).filter_by(id=application.history_record_id).one()
            history.resume_tex = "changed after approval"
            session.commit()
        stale = self.client.post(
            f"/api/agent/applications/{agent_id}/submissions", json={"provider": "browser"},
            headers={"Idempotency-Key": "submission-stale"},
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "agent.approval_stale")

    def test_submission_callback_records_receipt_and_replay(self):
        self._seed_job()
        agent_id, _ = self._prepare_approval()
        submitted = self.client.post(
            f"/api/agent/applications/{agent_id}/submissions", json={"provider": "browser"},
            headers={"Idempotency-Key": "submission-key"},
        )
        self.assertEqual(submitted.status_code, 202, submitted.text)
        repeated = self.client.post(
            f"/api/agent/applications/{agent_id}/submissions", json={"provider": "browser"},
            headers={"Idempotency-Key": "submission-key"},
        )
        self.assertEqual(repeated.json()["receipt"]["id"], submitted.json()["receipt"]["id"])
        receipt_id = submitted.json()["receipt"]["id"]
        payload = {
            "event_id": "callback-1", "receipt_id": receipt_id, "status": "succeeded",
            "external_application_id": "external-42", "metadata": {"confirmation": "ok"},
        }
        callback = self.client.post(
            "/api/internal/agent/submission-callbacks", json=payload,
            headers={"X-Internal-Callback-Secret": "agent-callback-secret-for-tests"},
        )
        self.assertEqual(callback.status_code, 200, callback.text)
        self.assertEqual(callback.json()["receipt"]["status"], "succeeded")
        replay = self.client.post(
            "/api/internal/agent/submission-callbacks", json=payload,
            headers={"X-Internal-Callback-Secret": "agent-callback-secret-for-tests"},
        )
        self.assertTrue(replay.json()["replayed"])
        conflict = self.client.post(
            "/api/internal/agent/submission-callbacks", json={**payload, "status": "failed"},
            headers={"X-Internal-Callback-Secret": "agent-callback-secret-for-tests"},
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "agent.callback_conflict")
        agent = self.client.get(f"/api/agent/applications/{agent_id}").json()["agent"]
        self.assertEqual(agent["state"], "submitted")
        self.assertTrue(any(event["title"] == "External submission verified"
                            for event in agent["timeline"]))
        with self.Session() as session:
            self.assertEqual(session.query(SubmissionReceipt).count(), 1)
            self.assertEqual(session.query(SubmissionCallbackEvent).count(), 1)

    def test_submission_quota_failure_does_not_create_receipt(self):
        self._seed_job()
        agent_id, _ = self._prepare_approval()
        with patch("api.routes.agent.enforce_external_api_limit",
                   side_effect=HTTPException(status_code=429, detail="limit")):
            response = self.client.post(
                f"/api/agent/applications/{agent_id}/submissions",
                json={"provider": "browser"},
                headers={"Idempotency-Key": "limited-submission"},
            )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"]["code"], "agent.submission_limit_reached")
        self.assertEqual(self.client.get(f"/api/agent/applications/{agent_id}").json()["state"], "approved")
        with self.Session() as session:
            self.assertEqual(session.query(SubmissionReceipt).count(), 0)

    def test_callback_rejects_bad_secret_before_reading_receipt(self):
        response = self.client.post(
            "/api/internal/agent/submission-callbacks",
            json={"event_id": "unauthorized", "receipt_id": "missing", "status": "failed"},
            headers={"X-Internal-Callback-Secret": "wrong"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "agent.callback_unauthorized")


if __name__ == "__main__":
    unittest.main()
