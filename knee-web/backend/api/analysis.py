"""Study-level AI inference endpoint for the local checkpoint runner."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.ai.contract import SLOTS, TARGETS

logger = logging.getLogger("knee_review.analysis")

TARGET_IDS = (
    "acl",
    "mcl",
    "medial-meniscus",
    "lateral-meniscus",
    "medial-oa",
    "lateral-oa",
    "pf-oa",
    "effusion",
    "synovitis",
    "bakers-cyst",
    "contusion",
    "fracture",
)


def _study_instance_paths(services: Any, study_id: str) -> list[Path]:
    if services.cloud_mode():
        store = services.metadata_store()
        series_rows = store.list_series(study_id)
        instances = [
            instance
            for series in series_rows
            for instance in store.list_instances(series["id"])
        ]
        return [services.local_dicom_path(instance["path"]) for instance in instances]

    with services.db() as connection:
        rows = connection.execute(
            "SELECT instances.path FROM instances "
            "JOIN series ON series.id = instances.series_id "
            "WHERE series.study_id = ? ORDER BY series.rowid, instances.rowid",
            (study_id,),
        ).fetchall()
    return [Path(row["path"]) for row in rows]


def build_router(services: Any) -> APIRouter:
    router = APIRouter()

    @router.post("/api/studies/{study_id}/analyze")
    def analyze_study(
        study_id: str,
        session: services.AnonymousSession = Depends(services.get_current_session),
    ) -> dict[str, Any]:
        study = services.require_study_access(study_id, session)
        paths = _study_instance_paths(services, study_id)
        if not paths or any(not path.is_file() for path in paths):
            raise HTTPException(503, "One or more DICOM files for this study are unavailable")

        triton_url = os.getenv("TRITON_URL", "").strip()
        if triton_url:
            try:
                from backend.ai.runner import prepare_model_input
                from backend.ai.series import build_series_records, select_slots, study_laterality
                from backend.ai.triton_client import TritonInferenceError, infer

                records = build_series_records(paths)
                study_uids = {record.study_uid for record in records}
                if study_uids != {study["study_uid"]}:
                    raise HTTPException(409, "DICOM Study UID does not match the selected study")
                selected = select_slots(records)
                laterality = study_laterality(records)
                images, slot_mask, slice_mask, slot_details = prepare_model_input(selected, laterality)
                if not slot_mask.any():
                    raise ValueError("No model slot matched this study; cannot run inference")
                score_values = infer(
                    triton_url,
                    images,
                    slot_mask,
                    slice_mask,
                    timeout_seconds=float(os.getenv("TRITON_TIMEOUT_SECONDS", "180")),
                )[0]
            except ImportError as exc:
                raise HTTPException(503, "AI preprocessing dependencies are not installed on this backend") from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            except TritonInferenceError as exc:
                logger.warning("Triton inference failed for study %s: %s", study_id, exc)
                raise HTTPException(502, str(exc)) from exc
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("AI preprocessing failed for study %s", study_id)
                raise HTTPException(500, "AI analysis failed; check backend logs") from exc

            if len(score_values) != len(TARGETS):
                raise HTTPException(502, "AI model returned an unexpected number of scores")
            scores = {
                target_id: float(value)
                for target_id, value in zip(TARGET_IDS, score_values)
            }
            raw = {
                "study_uid": study["study_uid"],
                "checkpoint_sha256": os.getenv("AI_CHECKPOINT_SHA256", ""),
                "checkpoint_epoch": int(os.getenv("AI_CHECKPOINT_EPOCH", "13")),
                "device": os.getenv("AI_DEVICE_LABEL", "NVIDIA L4"),
                "architecture": "ImageNet ResNet-34",
                "pooling": "gated_attention",
                "input_shape": list(images.shape),
                "laterality": laterality,
                "slot_order": [slot.name for slot in SLOTS],
                "slots": slot_details,
                "score_semantics": "sigmoid model score; not calibrated probability",
                "warnings": [
                    "Local DICOM-header heuristics were used for plane/Fat Suppression; pass official series metadata for exact labels."
                ],
            }
        else:
            checkpoint_value = os.getenv("AI_CHECKPOINT_PATH", "").strip()
            if not checkpoint_value:
                raise HTTPException(503, "AI inference is not configured on this backend")
            checkpoint_path = Path(checkpoint_value)
            if not checkpoint_path.is_file():
                raise HTTPException(503, "The configured AI checkpoint is unavailable")
            try:
                from backend.ai.runner import run_inference_paths

                raw = run_inference_paths(
                    paths,
                    checkpoint_path,
                    device_name=os.getenv("AI_DEVICE", "auto"),
                )
            except ImportError as exc:
                raise HTTPException(503, "AI inference dependencies are not installed on this backend") from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            except Exception as exc:
                logger.exception("AI inference failed for study %s", study_id)
                raise HTTPException(500, "AI inference failed; check backend logs") from exc

            if raw["study_uid"] != study["study_uid"]:
                raise HTTPException(409, "DICOM Study UID does not match the selected study")
            if len(raw["scores"]) != len(TARGETS):
                raise HTTPException(500, "AI model returned an unexpected number of target scores")
            scores = {
                target_id: float(item["score"])
                for target_id, item in zip(TARGET_IDS, raw["scores"])
            }

        return {
            "status": "complete",
            "study_id": study_id,
            "study_uid": raw["study_uid"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model": {
                "architecture": raw["architecture"],
                "pooling": raw["pooling"],
                "checkpoint_sha256": raw["checkpoint_sha256"],
                "checkpoint_epoch": raw["checkpoint_epoch"],
                "device": raw["device"],
            },
            "input": {
                "shape": raw["input_shape"],
                "laterality": raw["laterality"],
                "slot_order": raw["slot_order"],
                "slots": raw["slots"],
            },
            "score_semantics": raw["score_semantics"],
            "scores": scores,
            "warnings": raw["warnings"],
        }

    return router
