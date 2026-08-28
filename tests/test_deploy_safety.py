import unittest

from deploy.redact import redact


class DeploymentSafetyTests(unittest.TestCase):
    def test_redacts_personal_and_authentication_data(self):
        raw = "email jane@example.com phone +1 (416) 555-0199 Authorization: Bearer abc.def Cookie=session-secret"
        cleaned = redact(raw)
        self.assertNotIn("jane@example.com", cleaned)
        self.assertNotIn("555-0199", cleaned)
        self.assertNotIn("abc.def", cleaned)
        self.assertNotIn("session-secret", cleaned)

    def test_keeps_public_ids_and_agent_states(self):
        raw = "application=c5a63b22-50f9-4aeb-aa62-256386ad12f1 state=awaiting_approval"
        self.assertEqual(redact(raw), raw)


if __name__ == "__main__":
    unittest.main()
