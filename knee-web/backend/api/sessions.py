"""Temporary-workspace session API routes."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    @router.post("/api/sessions")
    def start_session(response: Response, request: Request) -> dict[str, str]:
        services.cleanup_expired_sessions()
        session_data = services.create_anonymous_session()
        response.set_cookie(
            "knee_session",
            session_data.pop("session_token"),
            httponly=True,
            secure=services.cloud_mode()
            or request.url.scheme == "https"
            or os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
            samesite="none" if services.cloud_mode() else "lax",
            path="/api",
        )
        return session_data

    @router.get("/api/sessions/current")
    def current_session(session: services.AnonymousSession = Depends(services.get_current_session)) -> dict[str, str]:
        if services.cloud_mode():
            row = services.metadata_store().get_session(session.session_id)
            if not row:
                raise HTTPException(401, "Temporary session expired; start a new session")
            return {"idle_expires_at": row["idle_expires_at"], "absolute_expires_at": session.absolute_expires_at}
        with services.db() as connection:
            row = connection.execute(
                "SELECT idle_expires_at FROM anonymous_sessions WHERE id = ?",
                (session.session_id,),
            ).fetchone()
        if not row:
            raise HTTPException(401, "Temporary session expired; start a new session")
        return {"idle_expires_at": row["idle_expires_at"], "absolute_expires_at": session.absolute_expires_at}

    @router.delete("/api/sessions/current", status_code=204)
    def clear_current_session(
        request: Request, session: services.AnonymousSession = Depends(services.get_current_session)
    ) -> Response:
        if services.cloud_mode():
            store = services.metadata_store()
            try:
                for study in store.session_studies(session.session_id):
                    services.delete_cloud_study_data(study["id"])
                for upload in store.session_pending_uploads(session.session_id):
                    services.delete_cloud_pending_upload(upload)
                store.delete_session(session.session_id)
            except Exception as exc:
                raise HTTPException(503, "Could not fully clear this workspace. Retry Clear session.") from exc
            response = Response(status_code=204)
            response.delete_cookie("knee_session", path="/api", secure=True, httponly=True, samesite="none")
            return response
        with services.db() as connection:
            paths = connection.execute(
                "SELECT instances.path FROM instances JOIN series ON series.id = instances.series_id "
                "JOIN studies ON studies.id = series.study_id WHERE studies.owner_session_id = ?",
                (session.session_id,),
            ).fetchall()
            connection.execute("DELETE FROM anonymous_sessions WHERE id = ?", (session.session_id,))
        services.remove_upload_roots([row["path"] for row in paths])
        response = Response(status_code=204)
        response.delete_cookie(
            "knee_session",
            path="/api",
            secure=request.url.scheme == "https" or os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
            httponly=True,
            samesite="lax",
        )
        return response

    return router

