"""DICOM metadata parsing and geometry validation helpers."""

from __future__ import annotations

import io
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np
import pydicom

GEOMETRY_TOLERANCE = 1e-3


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()


def dicom_number(value: Any, default: float = 0.0) -> float:
    """Read a numeric DICOM value, including pydicom multi-value fields."""
    candidate: Any = value
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes)):
        candidate = next(iter(value), default)
    try:
        return float(candidate)
    except (TypeError, ValueError):
        return default


def as_float_list(value: Any) -> list[float]:
    try:
        return [float(x) for x in value]
    except (TypeError, ValueError):
        return []


def cross(a: list[float], b: list[float]) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit_vector(values: list[float]) -> list[float] | None:
    if len(values) != 3:
        return None
    norm = float(np.linalg.norm(np.array(values, dtype=float)))
    if norm <= GEOMETRY_TOLERANCE:
        return None
    return [float(value / norm) for value in values]


def close_vector(left: list[float] | None, right: list[float] | None) -> bool:
    return bool(
        left and right and len(left) == len(right) and np.allclose(left, right, atol=GEOMETRY_TOLERANCE, rtol=0)
    )


def geometry_from_dataset(ds: Any) -> dict[str, Any]:
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    ipp = as_float_list(getattr(ds, "ImagePositionPatient", []))
    spacing = as_float_list(getattr(ds, "PixelSpacing", []))
    frame_uid = clean(getattr(ds, "FrameOfReferenceUID", "")) or None
    rows = int(getattr(ds, "Rows", 0) or 0)
    cols = int(getattr(ds, "Columns", 0) or 0)
    row_direction = unit_vector(iop[:3]) if len(iop) == 6 else None
    column_direction = unit_vector(iop[3:]) if len(iop) == 6 else None
    normal = unit_vector(cross(row_direction, column_direction)) if row_direction and column_direction else None
    issues: list[str] = []
    if (
        len(iop) != 6
        or not row_direction
        or not column_direction
        or abs(float(np.dot(row_direction, column_direction))) > 0.02
    ):
        issues.append("invalid_orientation")
    if len(ipp) != 3:
        issues.append("missing_image_position")
    if len(spacing) != 2 or any(value <= 0 for value in spacing):
        issues.append("missing_pixel_spacing")
    if not rows or not cols:
        issues.append("missing_dimensions")
    has_core_geometry = bool(
        normal and len(ipp) == 3 and len(spacing) == 2 and all(value > 0 for value in spacing) and rows and cols
    )
    has_any_geometry = bool(iop or ipp or spacing)
    status = "valid" if has_core_geometry else "partial" if has_any_geometry else "unknown"
    if not frame_uid:
        issues.append("missing_frame_of_reference")
    position = (
        float(np.dot(np.array(ipp, dtype=float), np.array(normal, dtype=float))) if len(ipp) == 3 and normal else None
    )
    return {
        "status": status,
        "frame_of_reference_uid": frame_uid,
        "image_orientation_patient": iop if len(iop) == 6 else None,
        "image_position_patient": ipp if len(ipp) == 3 else None,
        "row_direction": row_direction,
        "column_direction": column_direction,
        "normal": normal,
        "pixel_spacing": spacing if len(spacing) == 2 else None,
        "slice_thickness": float(getattr(ds, "SliceThickness", 0) or 0) or None,
        "spacing_between_slices": float(getattr(ds, "SpacingBetweenSlices", 0) or 0) or None,
        "position": position,
        "issues": sorted(set(issues)),
    }


def plane_for(ds: Any) -> str:
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    if len(iop) != 6:
        return "UNKNOWN"
    normal = cross(iop[:3], iop[3:])
    axis = int(np.argmax(np.abs(normal)))
    return ["SAG", "COR", "AX"][axis]


def physical_position(ds: Any) -> float | None:
    ipp = as_float_list(getattr(ds, "ImagePositionPatient", []))
    iop = as_float_list(getattr(ds, "ImageOrientationPatient", []))
    if len(ipp) != 3 or len(iop) != 6:
        return None
    normal = cross(iop[:3], iop[3:])
    return float(np.dot(np.array(ipp), np.array(normal)))


def parse_metadata(raw: bytes) -> dict[str, Any]:
    return metadata_from_dataset(pydicom.dcmread(io.BytesIO(raw), stop_before_pixels=True, force=False))


def parse_metadata_path(path: Path) -> dict[str, Any]:
    return metadata_from_dataset(pydicom.dcmread(path, stop_before_pixels=True, force=False))


def metadata_from_dataset(ds: Any) -> dict[str, Any]:
    study_uid = clean(getattr(ds, "StudyInstanceUID", ""))
    series_uid = clean(getattr(ds, "SeriesInstanceUID", ""))
    if not study_uid or not series_uid:
        raise ValueError("Missing StudyInstanceUID or SeriesInstanceUID")
    geometry = geometry_from_dataset(ds)
    return {
        "study_uid": study_uid,
        "series_uid": series_uid,
        "sop_uid": clean(getattr(ds, "SOPInstanceUID", "")),
        "description": clean(getattr(ds, "SeriesDescription", "")),
        "plane": plane_for(ds),
        "position": geometry["position"],
        "instance_number": int(getattr(ds, "InstanceNumber", 0) or 0),
        "rows": int(getattr(ds, "Rows", 0) or 0),
        "cols": int(getattr(ds, "Columns", 0) or 0),
        "spacing": geometry["pixel_spacing"] or [],
        "geometry": geometry,
        "geometry_status": geometry["status"],
    }


def validate_series_geometry(items: list[tuple[dict[str, Any], Path]]) -> dict[str, Any]:
    geometries = [metadata["geometry"] for metadata, _ in items]
    known = [geometry for geometry in geometries if geometry["status"] != "unknown"]
    if not known:
        return {"status": "unknown", "mapping_ready": False, "warnings": ["geometry_unavailable"]}

    warnings = sorted({issue for geometry in geometries for issue in geometry["issues"]})
    complete = all(geometry["status"] == "valid" for geometry in geometries)
    first = next((geometry for geometry in geometries if geometry["status"] == "valid"), known[0])
    conflicts: list[str] = []
    frame_uids = {geometry["frame_of_reference_uid"] for geometry in geometries if geometry["frame_of_reference_uid"]}
    planes = {metadata["plane"] for metadata, _ in items if metadata["plane"] != "UNKNOWN"}
    dimensions = {
        (metadata["rows"], metadata["cols"]) for metadata, _ in items if metadata["rows"] and metadata["cols"]
    }
    orientations = [
        geometry["image_orientation_patient"] for geometry in geometries if geometry["image_orientation_patient"]
    ]
    spacings = [geometry["pixel_spacing"] for geometry in geometries if geometry["pixel_spacing"]]
    if len(frame_uids) > 1:
        conflicts.append("frame_of_reference_mismatch")
    if len(planes) > 1:
        conflicts.append("plane_mismatch")
    if len(dimensions) > 1:
        conflicts.append("dimension_mismatch")
    if orientations and any(not close_vector(value, orientations[0]) for value in orientations[1:]):
        conflicts.append("orientation_mismatch")
    if spacings and any(not close_vector(value, spacings[0]) for value in spacings[1:]):
        conflicts.append("pixel_spacing_mismatch")
    positions = sorted(geometry["position"] for geometry in geometries if geometry["position"] is not None)
    if len(positions) > 1:
        differences = np.diff(np.array(positions, dtype=float))
        if any(abs(float(diff)) <= GEOMETRY_TOLERANCE for diff in differences):
            conflicts.append("duplicate_slice_position")
        positive_diffs = [abs(float(diff)) for diff in differences if abs(float(diff)) > GEOMETRY_TOLERANCE]
        slice_spacing = float(np.median(positive_diffs)) if positive_diffs else None
    else:
        slice_spacing = None
    status = "incompatible" if conflicts else "valid" if complete else "partial"
    warnings = sorted(set(warnings + conflicts))
    if status == "valid" and not frame_uids:
        warnings.append("missing_frame_of_reference")
    return {
        "status": status,
        "series_geometry_ready": status == "valid",
        "mapping_ready": False,
        "frame_of_reference_uid": next(iter(frame_uids), None),
        "image_orientation_patient": first["image_orientation_patient"],
        "normal": first["normal"],
        "position_range": [positions[0], positions[-1]] if positions else None,
        "slice_spacing": slice_spacing,
        "warnings": sorted(set(warnings)),
    }


def summarize_study_geometry(series: list[dict[str, Any]]) -> dict[str, Any]:
    geometries = [item.get("geometry", {}) for item in series]
    valid = [geometry for geometry in geometries if geometry.get("status") == "valid"]
    frame_uids = {
        geometry.get("frame_of_reference_uid") for geometry in valid if geometry.get("frame_of_reference_uid")
    }
    warnings: list[str] = []
    if not valid:
        status = "unknown"
        warnings.append("no_series_with_valid_geometry")
    elif len(valid) != len(geometries):
        status = "partial"
        warnings.append("some_series_geometry_unavailable")
    elif len(frame_uids) > 1:
        status = "incompatible"
        warnings.append("frame_of_reference_mismatch")
    else:
        status = "valid"
    mapping_ready = status == "valid" and len(valid) >= 2 and len(frame_uids) == 1
    if status == "valid" and not mapping_ready:
        warnings.append("cross_series_mapping_requires_shared_frame_of_reference")
    return {
        "status": status,
        "mapping_ready": mapping_ready,
        "valid_series_count": len(valid),
        "series_count": len(geometries),
        "frame_of_reference_uids": sorted(frame_uids),
        "warnings": sorted(set(warnings)),
    }

