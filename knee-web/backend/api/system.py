"""Health and scheduled-maintenance API routes."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "knee-review"}

    @router.post("/internal/cleanup")
    def scheduled_cleanup(request: Request) -> dict[str, int]:
        if not services.cloud_mode():
            raise HTTPException(404, "Scheduled cleanup is available only in Cloud Run mode")
        expected_audience = os.getenv("CLEANUP_OIDC_AUDIENCE", "").strip()
        expected_email = os.getenv("CLEANUP_SCHEDULER_EMAIL", "").strip().lower()
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        token = token.strip()
        if not expected_audience or not expected_email or scheme.lower() != "bearer" or not token:
            raise HTTPException(401, "Cleanup service authentication is not configured")
        try:
            from google.auth.transport.requests import Request as GoogleAuthRequest
            from google.oauth2 import id_token

            claims = id_token.verify_oauth2_token(token, GoogleAuthRequest(), audience=expected_audience)
        except Exception as exc:
            raise HTTPException(401, "Invalid cleanup service identity token") from exc
        token_email = claims.get("email")
        if (
            not isinstance(token_email, str)
            or token_email.lower() != expected_email
            or claims.get("email_verified") is not True
        ):
            raise HTTPException(403, "Cleanup service identity is not authorized")

        result = services.cleanup_expired_sessions(force=True, limit=20)
        if result["failures"]:
            raise HTTPException(503, {"message": "Some expired sessions need cleanup retry", **result})
        return result

    return router

