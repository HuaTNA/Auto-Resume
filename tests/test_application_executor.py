import os
import unittest
from unittest.mock import patch

from integrations.openclaw.application_executor import (
    ApplicationData,
    ApplicationExecutor,
    AutoResumeCallbackClient,
    BlockerKind,
    ExecutionRequest,
    ExecutionStatus,
    FieldValue,
    GreenhouseAdapter,
    OpenClawApplicationSettings,
    SubmissionAuthorization,
)
from integrations.openclaw.application_executor.artifacts import (
    assert_screenshot_safe_for_upload,
    sanitize_page_text_for_upload,
)
from integrations.openclaw.application_executor.browser import Control


class FixturePage:
    """Local mock ATS. It never performs network I/O."""

    def __init__(self, controls, text="Application form", confirmation=None):
        self._url = "about:blank"
        self._controls = tuple(controls)
        self._text = text
        self.confirmation = confirmation
        self.values = {}
        self.clicks = []

    @property
    def url(self):
        return self._url

    def goto(self, url):
        self._url = url

    def content_text(self):
        return self._text

    def controls(self):
        return self._controls

    def fill(self, locator, value):
        self.values[locator] = value

    def check(self, locator, checked):
        self.values[locator] = checked

    def select(self, locator, value):
        self.values[locator] = value

    def upload(self, locator, path):
        self.values[locator] = path

    def click(self, locator):
        self.clicks.append(locator)
        if self.confirmation is not None:
            self._url = "https://confirmation.mock-ats.test/application/confirmation"
            self._text = self.confirmation
            self._controls = ()

    def wait_for_settled(self):
        pass


class ScopedAuthorizations:
    def __init__(self):
        self.valid = set()

    def approve(self, authorization, fingerprint):
        self.valid.add((authorization.receipt_id, fingerprint))

    def validate(self, authorization, fingerprint):
        return (authorization.receipt_id, fingerprint) in self.valid


class RecordingCallbackTransport:
    def __init__(self):
        self.calls = []

    def post(self, url, *, headers, json):
        self.calls.append({"url": url, "headers": dict(headers), "json": dict(json)})
        return {"receipt": {"id": json["receipt_id"], "status": json["status"]}}


def standard_controls(submit_label="Submit Application"):
    return (
        Control("#first", "text", name="first_name", label="First Name", required=True),
        Control("#email", "email", name="email", label="Email", required=True),
        Control("#resume", "file", name="resume", label="Resume/CV", required=True),
        Control("#submit", "submit", label=submit_label),
    )


CONTENT_DIGEST = "a" * 64


def queued_authorization(content_digest=CONTENT_DIGEST):
    return SubmissionAuthorization(
        receipt_id="83487533-8e64-4a22-bdec-af7c1aa1c673",
        approval_id="8d3d2525-0ca8-4998-863f-af6d76a51585",
        content_digest=content_digest,
    )


def standard_request(url="https://greenhouse.mock-ats.test/acme/jobs/123", submission=None):
    return ExecutionRequest(
        job_url=url,
        application=ApplicationData(
            fields={"first_name": "Ada", "email": "ada@example.test"},
            resume_path="/fixtures/ada-resume.pdf",
        ),
        content_digest=CONTENT_DIGEST,
        submission=submission,
    )


class ApplicationExecutorTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "APPLICATION_ALLOWED_DOMAINS": (
                "greenhouse.mock-ats.test,lever.mock-ats.test,generic.mock-ats.test,"
                "nonats.local.fixture.test"
            ),
            "APPLICATION_DRY_RUN": "true",
        })
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    def test_greenhouse_fills_to_submit_boundary_by_default(self):
        page = FixturePage(standard_controls())
        request = standard_request()

        result = ApplicationExecutor(page).execute(request)

        self.assertEqual(result.status, ExecutionStatus.READY_FOR_APPROVAL)
        self.assertEqual(result.adapter, "greenhouse")
        self.assertEqual(page.values["#first"], "Ada")
        self.assertEqual(page.values["#resume"], "/fixtures/ada-resume.pdf")
        self.assertEqual(page.clicks, [])
        self.assertTrue(result.fingerprint)

    def test_valid_scoped_approval_submits_and_verifies_confirmation_number(self):
        page = FixturePage(
            standard_controls(),
            confirmation="Application submitted. Confirmation number: GH-48291",
        )
        approvals = ScopedAuthorizations()
        preview = standard_request()
        authorization = queued_authorization()
        approvals.approve(authorization, preview.fingerprint())
        request = standard_request(submission=authorization)

        result = ApplicationExecutor(page, approvals).execute(request)

        self.assertEqual(result.status, ExecutionStatus.SUBMITTED)
        self.assertEqual(page.clicks, ["#submit"])
        self.assertEqual(result.receipt.confirmation_number, "GH-48291")
        self.assertIn("confirmation", result.receipt.confirmation_url)
        self.assertEqual(result.submission_receipt_id, authorization.receipt_id)
        self.assertEqual(result.callback.status, "succeeded")
        self.assertEqual(result.callback.receipt_id, authorization.receipt_id)
        self.assertEqual(result.callback.external_application_id, "GH-48291")
        self.assertNotIn("confirmation_text", result.callback.metadata)

    def test_approval_for_different_payload_is_rejected_and_calls_blocker(self):
        page = FixturePage(standard_controls())
        approvals = ScopedAuthorizations()
        authorization = queued_authorization()
        approvals.approve(authorization, standard_request().fingerprint())
        changed = ExecutionRequest(
            job_url="https://greenhouse.mock-ats.test/acme/jobs/123",
            application=ApplicationData(
                fields={"first_name": "Grace", "email": "grace@example.test"},
                resume_path="/fixtures/grace.pdf",
            ),
            content_digest=CONTENT_DIGEST,
            submission=authorization,
        )
        blockers = []

        result = ApplicationExecutor(page, approvals, blockers.append).execute(changed)

        self.assertEqual(result.status, ExecutionStatus.BLOCKED)
        self.assertEqual(result.blocker.kind, BlockerKind.APPROVAL_REQUIRED)
        self.assertEqual(blockers, [result.blocker])
        self.assertEqual(page.clicks, [])

    def test_lever_and_generic_forms_use_their_own_adapters(self):
        cases = (
            ("https://lever.mock-ats.test/acme/abc", "lever"),
            ("https://generic.mock-ats.test/jobs/abc", "generic"),
        )
        for url, expected in cases:
            with self.subTest(url=url):
                page = FixturePage(standard_controls())
                result = ApplicationExecutor(page).execute(standard_request(url=url))
                self.assertEqual(result.status, ExecutionStatus.READY_FOR_APPROVAL)
                self.assertEqual(result.adapter, expected)
                self.assertEqual(page.clicks, [])

    def test_captcha_two_factor_and_expired_auth_stop_with_blocker_callback(self):
        cases = (
            ("Please complete the reCAPTCHA", BlockerKind.CAPTCHA),
            ("Enter your two-factor verification code", BlockerKind.TWO_FACTOR),
            ("Your session expired. Sign in to continue", BlockerKind.AUTH_EXPIRED),
        )
        for text, expected in cases:
            with self.subTest(text=text):
                page = FixturePage(standard_controls(), text=text)
                blockers = []
                result = ApplicationExecutor(page, on_blocker=blockers.append).execute(standard_request())
                self.assertEqual(result.status, ExecutionStatus.BLOCKED)
                self.assertEqual(result.blocker.kind, expected)
                self.assertEqual(blockers, [result.blocker])
                self.assertEqual(page.clicks, [])

    def test_unknown_sensitive_question_stops_unless_explicitly_marked_sensitive(self):
        controls = standard_controls()[:-1] + (
            Control("#ssn", "text", name="ssn", label="Social Security Number", required=True),
            standard_controls()[-1],
        )
        page = FixturePage(controls)
        blockers = []

        result = ApplicationExecutor(page, on_blocker=blockers.append).execute(standard_request())

        self.assertEqual(result.blocker.kind, BlockerKind.SENSITIVE_QUESTION)
        self.assertEqual(blockers[0].details["field"], "Social Security Number")
        self.assertEqual(page.clicks, [])

        explicit = ExecutionRequest(
            job_url=standard_request().job_url,
            application=ApplicationData(
                fields={
                    "first_name": "Ada",
                    "email": "ada@example.test",
                    "social_security_number": FieldValue("TEST-ONLY", sensitive=True),
                },
                resume_path="/fixtures/ada-resume.pdf",
            ),
        )
        allowed = ApplicationExecutor(FixturePage(controls)).execute(explicit)
        self.assertEqual(allowed.status, ExecutionStatus.READY_FOR_APPROVAL)

    def test_missing_required_field_and_unverified_submit_are_blockers(self):
        missing = ExecutionRequest(
            job_url=standard_request().job_url,
            application=ApplicationData(fields={"first_name": "Ada"}),
        )
        missing_result = ApplicationExecutor(FixturePage(standard_controls())).execute(missing)
        self.assertEqual(missing_result.blocker.kind, BlockerKind.BLOCKED_QUESTION)

        page = FixturePage(standard_controls(), confirmation="Something ambiguous happened")
        approvals = ScopedAuthorizations()
        authorization = queued_authorization()
        request = standard_request(submission=authorization)
        approvals.approve(authorization, request.fingerprint())
        result = ApplicationExecutor(page, approvals).execute(request)
        self.assertEqual(result.blocker.kind, BlockerKind.SUBMISSION_UNVERIFIED)
        self.assertEqual(page.clicks, ["#submit"])
        self.assertEqual(result.callback.status, "failed")
        self.assertEqual(result.callback.receipt_id, authorization.receipt_id)
        self.assertEqual(result.callback.error_code, "submission_unverified")

    def test_adapter_submit_hard_rejects_missing_approval_id(self):
        page = FixturePage(standard_controls())
        page.goto("https://greenhouse.mock-ats.test/acme/jobs/123")
        with self.assertRaisesRegex(RuntimeError, "approval ID"):
            GreenhouseAdapter().submit(page, approval_id=None)
        self.assertEqual(page.clicks, [])

    def test_unknown_optional_question_is_blocked_instead_of_guessed(self):
        controls = standard_controls()[:-1] + (
            Control("#mystery", "text", name="x7", label="Tell us something", required=False),
            standard_controls()[-1],
        )
        result = ApplicationExecutor(FixturePage(controls)).execute(standard_request())
        self.assertEqual(result.status, ExecutionStatus.BLOCKED)
        self.assertEqual(result.blocker.kind, BlockerKind.BLOCKED_QUESTION)
        self.assertIn("Tell us something", result.blocker.details["fields"])

    def test_dry_run_blocks_non_mock_submission_even_when_domain_is_allowed(self):
        authorization = queued_authorization()
        request = standard_request(
            url="https://nonats.local.fixture.test/jobs/123",
            submission=authorization,
        )
        approvals = ScopedAuthorizations()
        approvals.approve(authorization, request.fingerprint())
        page = FixturePage(standard_controls())
        result = ApplicationExecutor(page, approvals).execute(request)
        self.assertEqual(result.blocker.kind, BlockerKind.DRY_RUN)
        self.assertEqual(page.clicks, [])

    def test_non_allowlisted_domain_is_blocked_before_navigation(self):
        page = FixturePage(standard_controls())
        request = standard_request(url="https://unknown.local.fixture.test/jobs/123")
        result = ApplicationExecutor(page).execute(request)
        self.assertEqual(result.blocker.kind, BlockerKind.DOMAIN_NOT_ALLOWED)
        self.assertEqual(page.url, "about:blank")
        self.assertEqual(page.clicks, [])

    def test_text_and_screenshot_upload_guards_redact_or_block_sensitive_data(self):
        raw = (
            "Email ada@example.test Phone +1 (416) 555-0199 "
            "Authorization=Bearer-secret Cookie=session-secret password=hunter2 "
            "eyJheader.payload.signature"
        )
        sanitized = sanitize_page_text_for_upload(raw)
        for secret in ("ada@example.test", "416", "Bearer-secret", "session-secret", "hunter2", "eyJheader"):
            self.assertNotIn(secret, sanitized)

        password_page = FixturePage((Control("#password", "password", label="Password"),))
        with self.assertRaisesRegex(ValueError, "sensitive controls"):
            assert_screenshot_safe_for_upload(password_page, b"fake-image", inspector=None)

        clean_page = FixturePage(standard_controls())
        with self.assertRaisesRegex(ValueError, "no screenshot inspector"):
            assert_screenshot_safe_for_upload(clean_page, b"fake-image", inspector=None)

    def test_runtime_settings_keep_tokens_out_of_repr(self):
        with patch.dict(os.environ, {
            "AUTO_RESUME_API_URL": "https://api.fixture.test",
            "AUTO_RESUME_SERVICE_TOKEN": "service-token-fixture",
            "AUTO_RESUME_WEBHOOK_SECRET": "webhook-secret-fixture",
            "OPENCLAW_GATEWAY_URL": "https://gateway.fixture.test",
            "OPENCLAW_GATEWAY_TOKEN": "gateway-token-fixture",
        }):
            settings = OpenClawApplicationSettings.from_env()
        rendered = repr(settings)
        self.assertEqual(settings.auto_resume_api_url, "https://api.fixture.test")
        self.assertEqual(settings.openclaw_gateway_url, "https://gateway.fixture.test")
        for secret in ("service-token-fixture", "webhook-secret-fixture", "gateway-token-fixture"):
            self.assertNotIn(secret, rendered)

    def test_agent1_callback_contract_uses_mock_transport_and_no_secret_payload(self):
        authorization = queued_authorization()
        request = standard_request(submission=authorization)
        approvals = ScopedAuthorizations()
        approvals.approve(authorization, request.fingerprint())
        result = ApplicationExecutor(
            FixturePage(standard_controls(), confirmation="Application submitted. Reference: MOCK-1234"),
            approvals,
        ).execute(request)
        settings = OpenClawApplicationSettings(
            auto_resume_api_url="https://api.fixture.test",
            auto_resume_service_token="service-token-fixture",
            auto_resume_webhook_secret="webhook-secret-fixture",
            openclaw_gateway_url="",
            openclaw_gateway_token="",
            policy=OpenClawApplicationSettings.from_env().policy,
        )
        transport = RecordingCallbackTransport()

        response = AutoResumeCallbackClient(settings, transport).publish(result.callback)

        self.assertEqual(response["receipt"]["status"], "succeeded")
        call = transport.calls[0]
        self.assertEqual(call["url"], "https://api.fixture.test/api/internal/agent/submission-callbacks")
        self.assertEqual(call["headers"]["X-Internal-Callback-Secret"], "webhook-secret-fixture")
        self.assertEqual(call["json"]["event_id"], result.callback.event_id)
        self.assertEqual(call["json"]["receipt_id"], authorization.receipt_id)
        serialized_payload = str(call["json"])
        self.assertNotIn("service-token-fixture", serialized_payload)
        self.assertNotIn("webhook-secret-fixture", serialized_payload)

    def test_non_queued_or_digest_mismatched_receipt_never_submits(self):
        cases = (
            SubmissionAuthorization("receipt-1", "approval-1", CONTENT_DIGEST, status="accepted"),
            queued_authorization(content_digest="b" * 64),
        )
        for authorization in cases:
            with self.subTest(status=authorization.status, digest=authorization.content_digest):
                page = FixturePage(standard_controls())
                approvals = ScopedAuthorizations()
                request = standard_request(submission=authorization)
                approvals.approve(authorization, request.fingerprint())
                result = ApplicationExecutor(page, approvals).execute(request)
                self.assertEqual(result.status, ExecutionStatus.BLOCKED)
                self.assertEqual(result.blocker.kind, BlockerKind.APPROVAL_REQUIRED)
                self.assertEqual(page.clicks, [])
                self.assertIsNone(result.callback)

    def test_valid_queued_receipt_gets_failed_callback_when_captcha_blocks(self):
        authorization = queued_authorization()
        request = standard_request(submission=authorization)
        approvals = ScopedAuthorizations()
        approvals.approve(authorization, request.fingerprint())
        page = FixturePage(standard_controls(), text="Please complete the reCAPTCHA")

        result = ApplicationExecutor(page, approvals).execute(request)

        self.assertEqual(result.blocker.kind, BlockerKind.CAPTCHA)
        self.assertEqual(result.callback.status, "failed")
        self.assertEqual(result.callback.receipt_id, authorization.receipt_id)
        self.assertEqual(result.callback.metadata["blocker_kind"], "captcha")
        self.assertNotIn("reCAPTCHA", str(result.callback.metadata))
        self.assertEqual(page.clicks, [])

    def test_required_resume_is_not_silently_skipped(self):
        request = ExecutionRequest(
            job_url=standard_request().job_url,
            application=ApplicationData(fields={"first_name": "Ada", "email": "ada@example.test"}),
        )
        result = ApplicationExecutor(FixturePage(standard_controls())).execute(request)
        self.assertEqual(result.status, ExecutionStatus.BLOCKED)
        self.assertEqual(result.blocker.kind, BlockerKind.PAGE_STRUCTURE)
        self.assertIn("Resume/CV", result.blocker.details["fields"])


if __name__ == "__main__":
    unittest.main()
