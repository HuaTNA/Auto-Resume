"""Local, single-claim application worker. Default mode never clicks real submit.

Run with --check to verify credentials/queue without touching recruiting sites.
Use --once/--loop only after reviewing the allowed domains; --live is explicit.
Browser dependencies are imported only when an approved receipt is claimed.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from uuid import uuid4
from urllib.parse import urlsplit

import httpx

from .executor import ApplicationExecutor
from .models import ApplicationData, ExecutionRequest, FieldValue, SubmissionAuthorization, SubmissionCallback
from .playwright_page import PlaywrightPage
from .policy import ExecutionPolicy, MOCK_ATS_SUFFIX


class WorkerApi:
    def __init__(self, base_url, service_token, callback_secret, discord_user_id, client=None):
        if not all((base_url, service_token, callback_secret, discord_user_id)):
            raise ValueError("API URL, service/callback secrets and Discord user ID are required")
        if not base_url.startswith("https://") and not base_url.startswith("http://127.0.0.1:"):
            raise ValueError("Executor API must use HTTPS")
        self.client = client or httpx.Client(timeout=30, follow_redirects=False)
        self.base = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {service_token}",
                        "X-Internal-Callback-Secret": callback_secret,
                        "X-Discord-User-Id": discord_user_id}

    def request(self, method, path, payload=None):
        response = self.client.request(method, self.base + path, headers=self.headers, json=payload)
        if not 200 <= response.status_code < 300:
            # Never include request headers, credentials or response bodies in logs.
            raise RuntimeError(f"Executor API returned HTTP {response.status_code}")
        return response.json()

    def queue(self):
        return self.request("GET", "/api/internal/executor/queue")["receipts"]

    def heartbeat(self, worker_id, dry_run):
        return self.request("POST", "/api/internal/executor/heartbeat", {"worker_id": worker_id, "dry_run": dry_run})

    def notifications(self, cursor):
        suffix = f"?after={int(cursor)}" if cursor is not None else ""
        return self.request("GET", f"/api/internal/executor/notifications{suffix}")

    def claim(self, receipt_id, worker_id):
        return self.request("POST", f"/api/internal/executor/receipts/{receipt_id}/claim", {"worker_id": worker_id})

    def validate(self, receipt_id, payload):
        return self.request("POST", f"/api/internal/executor/receipts/{receipt_id}/validate", payload).get("valid") is True

    def callback(self, payload):
        return self.request("POST", "/api/internal/agent/submission-callbacks", payload)


class RemoteApprovalValidator:
    def __init__(self, api, worker_id, dispatch):
        self.api, self.worker_id, self.dispatch = api, worker_id, dispatch

    def validate(self, authorization, fingerprint):
        if (authorization.receipt_id != self.dispatch["receipt_id"]
                or authorization.approval_id != self.dispatch["approval_id"]):
            return False
        return self.api.validate(authorization.receipt_id, {
            "worker_id": self.worker_id, "fingerprint": fingerprint,
            "content_digest": authorization.content_digest,
            "job_url": self.dispatch["job_url"],
        })


def write_materials(snapshot, folder):
    from src.pdf_renderer import render_latex_fallback, render_pdf
    resume = Path(folder) / "resume.pdf"
    resume.write_bytes(render_latex_fallback(snapshot["resume_tex"]))
    cover = None
    if snapshot.get("cover_letter"):
        cover = Path(folder) / "cover-letter.pdf"
        cover.write_bytes(render_pdf([("paragraph", snapshot["cover_letter"])], "Cover letter"))
    return str(resume), str(cover) if cover else None


class ApplicationWorker:
    def __init__(self, api, page_factory, state_dir, policy, material_writer=write_materials, notify=None, web_url="https://auto-resume-two.vercel.app"):
        self.api, self.page_factory = api, page_factory
        self.state_dir, self.policy = Path(state_dir), policy
        self.material_writer = material_writer
        self.notify, self.web_url = notify, web_url.rstrip("/")
        self.worker_id = str(uuid4())
        self.outbox = self.state_dir / "outbox"
        self.outbox.mkdir(parents=True, exist_ok=True, mode=0o700)

    @staticmethod
    def store(path, value):
        # Atomic outbox/checkpoint writes survive an interrupted process.
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
            os.chmod(output.name, 0o600)
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
            temporary = output.name
        os.replace(temporary, path)

    def flush_outbox(self):
        for path in sorted(self.outbox.glob("*.json")):
            envelope = json.loads(path.read_text())
            payload = envelope["callback"]
            self.api.callback(payload)
            if self.notify:
                label = "已验证投递成功" if payload["status"] == "succeeded" else "需要你处理，未确认投递成功"
                self.notify(f"Auto-Resume：{label}。\n回执：{payload['receipt_id']}\n原因：{payload.get('error_code') or '无'}\n{self.web_url}/career/applications?agent={envelope['agent_id']}")
            # Remove only our own acknowledged callback file. Never rerun the browser.
            path.unlink()

    def publish(self, callback, agent_id):
        payload = asdict(callback)
        path = self.outbox / f"{callback.receipt_id}.json"
        self.store(path, {"callback": payload, "agent_id": agent_id})
        self.flush_outbox()

    def publish_notifications(self):
        if not self.notify:
            return
        checkpoint = self.state_dir / "notification-cursor.json"
        cursor = json.loads(checkpoint.read_text()).get("cursor") if checkpoint.exists() else None
        result = self.api.notifications(cursor)
        labels = {"automation_completed": "网站搜岗/自动化已完成", "automation_failed": "网站自动化失败，请查看原因", "materials_ready": "简历与求职信已生成，请查看 ATS 和材料"}
        for item in result["notifications"]:
            path = item.get("href") or "/automations"
            if not path.startswith("/") or path.startswith("//"):
                path = "/automations"
            self.notify(f"Auto-Resume：{labels.get(item['kind'], '网站状态更新')}\n{self.web_url}{path}")
        self.store(checkpoint, {"cursor": result["cursor"]})

    def run_once(self):
        self.api.heartbeat(self.worker_id, self.policy.dry_run)
        self.flush_outbox()
        self.publish_notifications()
        queue = self.api.queue()
        if not queue:
            return {"status": "idle"}
        if self.policy.dry_run and not (self.policy.allowed_domains and all(
                domain.endswith(MOCK_ATS_SUFFIX) for domain in self.policy.allowed_domains)):
            # Production commissioning is read-only toward employers and leaves
            # approved work queued until the operator explicitly enables live.
            return {"status": "dry_run_pending", "queued_receipts": len(queue)}
        # A failed claim is never recovered by guessing ownership or using another ID.
        dispatch = self.api.claim(queue[0]["id"], self.worker_id)
        receipt_id = dispatch["receipt_id"]
        callback = None
        try:
            if not self.policy.domain_allowed(dispatch["job_url"]):
                raise ValueError("Destination is outside the approved executor domain allowlist")
            snapshot = dispatch["snapshot"]
            fields = {}
            for answer in snapshot.get("answers", []):
                # These exact answers were supplied by the user and included in
                # the approved digest. No profile-based or model inference.
                value = FieldValue(answer["answer"], sensitive=True)
                fields[answer["key"]] = value
                fields[answer["question"]] = value
            with tempfile.TemporaryDirectory(prefix="auto-resume-materials-") as folder:
                resume, cover = self.material_writer(snapshot, folder)
                authorization = SubmissionAuthorization(receipt_id, dispatch["approval_id"], dispatch["content_digest"])
                request = ExecutionRequest(dispatch["job_url"], ApplicationData(fields, resume, cover), dispatch["content_digest"], authorization)
                with self.page_factory() as page:
                    result = ApplicationExecutor(page,
                        authorization_validator=RemoteApprovalValidator(self.api, self.worker_id, dispatch),
                        policy=self.policy).execute(request)
                callback = result.callback
                if callback is None:
                    callback = SubmissionCallback(f"worker-blocked:{receipt_id}", receipt_id, "failed",
                        error_code=result.blocker.kind.value if result.blocker else "submission_unverified",
                        error_message=result.blocker.message if result.blocker else "No verified execution outcome")
        except Exception as exc:
            # A network/browser exception can happen after a click. Stop, never retry submission.
            callback = SubmissionCallback(f"worker-interrupted:{receipt_id}", receipt_id, "failed",
                error_code="submission_unverified",
                error_message=f"Worker interrupted ({type(exc).__name__}); inspect the employer page before retrying.")
        self.publish(callback, dispatch["agent_id"])
        return {"receipt_id": receipt_id, "status": callback.status, "error_code": callback.error_code}


@contextmanager
def managed_page(state_dir, policy):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as runtime:
        context = runtime.chromium.launch_persistent_context(str(Path(state_dir) / "browser"), headless=False)
        try:
            def restrict_write(route):
                request = route.request
                host = urlsplit(request.url).hostname or ""
                allowed = policy.domain_allowed(request.url) or any(host == suffix or host.endswith("." + suffix) for suffix in ("greenhouse.io", "lever.co"))
                if request.method not in {"GET", "HEAD", "OPTIONS"} and not allowed:
                    route.abort()
                else:
                    route.continue_()
            context.route("**/*", restrict_write)
            page = context.new_page()
            yield PlaywrightPage(page, policy=policy)
        finally:
            context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--live", action="store_true", help="Allow submit only for exact approved queued receipts")
    parser.add_argument("--env-file", default=str(Path.home() / ".openclaw" / ".env"))
    parser.add_argument("--discord-user-id", required=True)
    parser.add_argument("--allowed-domains", default="boards.greenhouse.io,job-boards.greenhouse.io,jobs.lever.co")
    parser.add_argument("--state-dir", default=str(Path.home() / ".openclaw" / "auto-resume-executor"))
    parser.add_argument("--discord-channel-id")
    parser.add_argument("--web-url", default="https://auto-resume-two.vercel.app")
    args = parser.parse_args()
    if sum((args.check, args.once, args.loop)) != 1:
        parser.error("Select exactly one of --check, --once or --loop")
    from dotenv import load_dotenv
    load_dotenv(args.env_file)
    os.umask(0o077)
    api = WorkerApi(os.environ.get("AUTO_RESUME_API_URL", ""), os.environ.get("AUTO_RESUME_SERVICE_TOKEN", ""),
                    os.environ.get("AUTO_RESUME_WEBHOOK_SECRET", ""), args.discord_user_id)
    if args.check:
        print(json.dumps({"authenticated": True, "queued_receipts": len(api.queue()), "live": args.live}))
        return
    policy = ExecutionPolicy(frozenset(part.strip() for part in args.allowed_domains.split(",") if part.strip()), dry_run=not args.live)
    def notify(message):
        safe = re.sub(r"@everyone|@here|<@[^>]+>", "[mention removed]", message)
        result = subprocess.run(["openclaw", "message", "send", "--channel", "discord", "--target", f"channel:{args.discord_channel_id}", "--message", safe, "--json"], capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError("Discord status delivery failed")
    worker = ApplicationWorker(api, lambda: managed_page(args.state_dir, policy), args.state_dir, policy,
                               notify=notify if args.discord_channel_id else None, web_url=args.web_url)
    # A local service restart must not overlap callback delivery with the old process.
    import fcntl
    lock = (Path(args.state_dir) / "worker.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    while True:
        try:
            print(json.dumps(worker.run_once()), flush=True)
        except Exception as exc:
            print(json.dumps({"status": "worker_error", "type": type(exc).__name__}), flush=True)
            if args.once:
                raise SystemExit(1) from None
        if args.once:
            break
        time.sleep(20)


if __name__ == "__main__":
    main()
