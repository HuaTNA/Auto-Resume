"""Vercel FastAPI entrypoint.

The application implementation stays in ``api.server`` so local Uvicorn and
container deployments continue to use the same app.
"""

from api.server import app

__all__ = ["app"]
