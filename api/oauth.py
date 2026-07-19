"""OAuth provider configuration, token exchange, and encrypted storage helpers."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from cryptography.fernet import Fernet
from api.auth import get_secret_key


PROVIDERS = {
    "notion": {
        "name": "Notion",
        "client_id": "NOTION_CLIENT_ID",
        "client_secret": "NOTION_CLIENT_SECRET",
        "redirect_uri": "NOTION_REDIRECT_URI",
        "default_redirect": "http://localhost:8000/api/integrations/notion/callback",
        "scopes": ["read:selected", "write:selected"],
    },
    "google-calendar": {
        "name": "Google Calendar",
        "client_id": "GOOGLE_CLIENT_ID",
        "client_secret": "GOOGLE_CLIENT_SECRET",
        "redirect_uri": "GOOGLE_REDIRECT_URI",
        "default_redirect": "http://localhost:8000/api/integrations/google-calendar/callback",
        "scopes": ["https://www.googleapis.com/auth/calendar.readonly"],
    },
}


def provider_statuses() -> list[dict]:
    return [{"id": provider, "name": config["name"], "configured": bool(os.environ.get(config["client_id"], "").strip() and os.environ.get(config["client_secret"], "").strip()), "scopes": config["scopes"]} for provider, config in PROVIDERS.items()]


def _config(provider: str) -> dict:
    if provider not in PROVIDERS:
        raise ValueError("Unsupported OAuth provider")
    config = PROVIDERS[provider]
    client_id = os.environ.get(config["client_id"], "").strip()
    client_secret = os.environ.get(config["client_secret"], "").strip()
    if not client_id or not client_secret:
        raise RuntimeError(f"{config['name']} OAuth credentials are not configured")
    return {**config, "client_id_value": client_id, "client_secret_value": client_secret, "redirect_uri_value": os.environ.get(config["redirect_uri"], "").strip() or config["default_redirect"]}


def authorization_url(provider: str, state: str) -> str:
    config = _config(provider)
    if provider == "notion":
        query = urllib.parse.urlencode({"client_id": config["client_id_value"], "redirect_uri": config["redirect_uri_value"], "response_type": "code", "owner": "user", "state": state})
        return f"https://api.notion.com/v1/oauth/authorize?{query}"
    query = urllib.parse.urlencode({"client_id": config["client_id_value"], "redirect_uri": config["redirect_uri_value"], "response_type": "code", "scope": " ".join(config["scopes"]), "access_type": "offline", "include_granted_scopes": "true", "prompt": "consent", "state": state})
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def exchange_code(provider: str, code: str) -> tuple[dict, str | None]:
    config = _config(provider)
    if provider == "notion":
        credentials = base64.b64encode(f"{config['client_id_value']}:{config['client_secret_value']}".encode()).decode()
        request = urllib.request.Request("https://api.notion.com/v1/oauth/token", data=json.dumps({"grant_type": "authorization_code", "code": code, "redirect_uri": config["redirect_uri_value"]}).encode(), headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/json", "Accept": "application/json", "Notion-Version": "2026-03-11"}, method="POST")
    else:
        body = urllib.parse.urlencode({"client_id": config["client_id_value"], "client_secret": config["client_secret_value"], "code": code, "grant_type": "authorization_code", "redirect_uri": config["redirect_uri_value"]}).encode()
        request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"OAuth token exchange failed ({exc.code}): {detail}") from exc
    account = payload.get("workspace_name") if provider == "notion" else "Google Calendar"
    return payload, account


def encrypt_credentials(payload: dict) -> str:
    configured = os.environ.get("INTEGRATION_ENCRYPTION_KEY", "").strip()
    secret = configured if len(configured.encode()) >= 32 else get_secret_key()
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key).encrypt(json.dumps(payload).encode()).decode()


def decrypt_credentials(ciphertext: str) -> dict:
    configured = os.environ.get("INTEGRATION_ENCRYPTION_KEY", "").strip()
    secret = configured if len(configured.encode()) >= 32 else get_secret_key()
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return json.loads(Fernet(key).decrypt(ciphertext.encode()).decode())


def _provider_items_request(provider: str, credentials: dict) -> list[dict]:
    token = credentials.get("access_token")
    if not token:
        raise RuntimeError("The saved integration has no access token; reconnect it")
    if provider == "notion":
        request = urllib.request.Request("https://api.notion.com/v1/search", data=json.dumps({"page_size": 50, "filter": {"property": "object", "value": "page"}}).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Notion-Version": "2026-03-11"}, method="POST")
    elif provider == "google-calendar":
        from datetime import datetime, timezone
        query = urllib.parse.urlencode({"timeMin": datetime.now(timezone.utc).isoformat(), "maxResults": 50, "singleEvents": "true", "orderBy": "startTime"})
        request = urllib.request.Request(f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{query}", headers={"Authorization": f"Bearer {token}"})
    else:
        raise ValueError("Unsupported OAuth provider")
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode())
    return payload.get("results", []) if provider == "notion" else payload.get("items", [])


def _refresh_credentials(provider: str, credentials: dict) -> dict:
    refresh_token = credentials.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("The provider did not return a refresh token; reconnect the integration")
    config = _config(provider)
    if provider == "notion":
        basic = base64.b64encode(f"{config['client_id_value']}:{config['client_secret_value']}".encode()).decode()
        request = urllib.request.Request("https://api.notion.com/v1/oauth/token", data=json.dumps({"grant_type": "refresh_token", "refresh_token": refresh_token}).encode(), headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json", "Notion-Version": "2026-03-11"}, method="POST")
    else:
        body = urllib.parse.urlencode({"client_id": config["client_id_value"], "client_secret": config["client_secret_value"], "refresh_token": refresh_token, "grant_type": "refresh_token"}).encode()
        request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        refreshed = json.loads(response.read().decode())
    return {**credentials, **refreshed, "refresh_token": refreshed.get("refresh_token") or refresh_token}


def fetch_provider_items(provider: str, credentials: dict) -> tuple[list[dict], dict]:
    try:
        return _provider_items_request(provider, credentials), credentials
    except urllib.error.HTTPError as exc:
        if exc.code != 401:
            detail = exc.read().decode(errors="replace")[:500]
            raise RuntimeError(f"Provider sync failed ({exc.code}): {detail}") from exc
    try:
        refreshed = _refresh_credentials(provider, credentials)
        return _provider_items_request(provider, refreshed), refreshed
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"Provider token refresh failed ({exc.code}): {detail}") from exc
