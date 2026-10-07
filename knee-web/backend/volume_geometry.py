"""Conservative eligibility gate for a single, regularly sampled MR volume."""
from typing import Any

import numpy as np


def volume_eligibility(headers: list[Any]) -> dict[str, Any]:
    reasons: list[str] = []
    if len(headers) < 3:
        return {"eligible": False, "reasons": ["At least three slices are required."]}
    try:
        orientations = np.asarray([ds.ImageOrientationPatient for ds in headers], dtype=float)
        positions = np.asarray([ds.ImagePositionPatient for ds in headers], dtype=float)
        spacing = np.asarray([ds.PixelSpacing for ds in headers], dtype=float)
        if orientations.shape != (len(headers), 6) or positions.shape != (len(headers), 3) or spacing.shape != (len(headers), 2):
            raise ValueError("Invalid geometry dimensions")
        if not all(np.isfinite(a).all() for a in (orientations, positions, spacing)):
            raise ValueError("Non-finite geometry")
        first = orientations[0]
        normal = np.cross(first[:3], first[3:])
        if (not np.isclose(np.linalg.norm(first[:3]), 1, atol=0.001)
                or not np.isclose(np.linalg.norm(first[3:]), 1, atol=0.001)
                or not np.isclose(np.dot(first[:3], first[3:]), 0, atol=0.001)):
            reasons.append("Invalid direction cosines.")
        if not np.allclose(orientations, first, atol=0.001, rtol=0):
            reasons.append("Slice orientations differ.")
        if not (spacing > 0).all() or not np.allclose(spacing, spacing[0], atol=0.001, rtol=0):
            reasons.append("Pixel spacing is missing or inconsistent.")
        order = np.argsort(positions @ normal)
        ordered = positions[order]
        gaps = np.diff(ordered @ normal)
        step = float(np.median(gaps))
        if step <= 0.001 or not np.allclose(gaps, step, atol=max(0.01, step * 0.01), rtol=0):
            reasons.append("Duplicate positions, missing slices or irregular slice spacing.")
        if not np.allclose(np.diff(ordered, axis=0), gaps[:, None] * normal, atol=0.05, rtol=0):
            reasons.append("In-plane slice displacement requires resampling.")
        frames = {str(getattr(ds, "FrameOfReferenceUID", "")) for ds in headers}
        if len(frames) != 1 or "" in frames:
            reasons.append("Slices must share a Frame of Reference.")
        dimensions = {(int(ds.Rows), int(ds.Columns)) for ds in headers}
        if len(dimensions) != 1 or min(next(iter(dimensions))) <= 0:
            reasons.append("Image dimensions differ.")
        if any(int(getattr(ds, "NumberOfFrames", 1)) != 1 or int(getattr(ds, "SamplesPerPixel", 1)) != 1 for ds in headers):
            reasons.append("Only single-frame grayscale stacks are supported for MPR.")
        if any(str(getattr(ds, "PhotometricInterpretation", "")) not in {"MONOCHROME1", "MONOCHROME2"} for ds in headers):
            reasons.append("Unsupported photometric interpretation.")
        if len({str(ds.SeriesInstanceUID) for ds in headers}) != 1:
            reasons.append("MPR must use a single acquisition.")
        if len({(str(ds.PhotometricInterpretation), int(ds.BitsAllocated), int(ds.PixelRepresentation)) for ds in headers}) != 1:
            reasons.append("Pixel formats differ across slices.")
        estimated_bytes = len(headers) * int(headers[0].Rows) * int(headers[0].Columns) * 4
        if estimated_bytes > 384 * 1024 * 1024:
            reasons.append("Volume exceeds the local viewer memory budget; use original stack views.")
        return {"eligible": not reasons, "reasons": reasons, "slice_spacing_mm": step,
                "pixel_spacing_mm": spacing[0].tolist(), "slice_count": len(headers),
                "anisotropic": bool(step > 2 * min(spacing[0]))}
    except (AttributeError, ValueError, TypeError, IndexError):
        return {"eligible": False, "reasons": ["Required DICOM geometry is missing or invalid."]}
