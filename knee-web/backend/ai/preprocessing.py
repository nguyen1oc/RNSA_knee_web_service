"""DICOM stack ordering and pixel preprocessing matching the A2 inference notebook."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pydicom
import torch
import torch.nn.functional as functional

from backend.ai.contract import CROP_MM, IMAGE_SIZE, SLICES_PER_SLOT, STACK_END, STACK_START
from backend.ai.series import SeriesRecord


def ordered_slice_files(record: SeriesRecord) -> list[Path]:
    """Sort slices by position projected onto the DICOM plane normal."""
    if len(record.files) <= 1:
        return list(record.files)
    normal: np.ndarray | None = None
    projections: list[float] = []
    instance_numbers: list[float] = []
    for header in record.headers:
        if normal is None and header.image_orientation and len(header.image_orientation) >= 6:
            orientation = header.image_orientation
            candidate = np.cross(orientation[:3], orientation[3:6])
            norm = float(np.linalg.norm(candidate))
            if norm > 0:
                normal = candidate / norm
        if header.image_position and len(header.image_position) >= 3 and normal is not None:
            projections.append(float(np.dot(header.image_position[:3], normal)))
        else:
            projections.append(float("nan"))
        instance_numbers.append(
            header.instance_number if header.instance_number is not None else float("nan")
        )
    if normal is not None and np.isfinite(projections).all():
        return [path for _, path in sorted(zip(projections, record.files), key=lambda item: item[0])]
    if np.isfinite(instance_numbers).all():
        return [path for _, path in sorted(zip(instance_numbers, record.files), key=lambda item: item[0])]
    return list(record.files)


def stack_indices(slice_count: int, max_slices: int = SLICES_PER_SLOT) -> np.ndarray:
    """Choose unique rounded index-uniform anchors spanning the 10–90% stack region."""
    if slice_count <= 0:
        return np.empty(0, dtype=np.int64)
    keep = min(slice_count, max_slices)
    return np.unique(
        np.rint(np.linspace(STACK_START * (slice_count - 1), STACK_END * (slice_count - 1), keep))
        .astype(np.int64)
    )


def normalize_laterality(image: torch.Tensor, plane: str, laterality: str | None) -> torch.Tensor:
    """Mirror right knees into the trained left-knee convention."""
    if laterality != "R":
        return image
    if plane in {"Coronal", "Axial"}:
        return torch.flip(image, dims=[-1])
    return torch.flip(image, dims=[0])


def preprocess_series(
    record: SeriesRecord,
    *,
    image_size: int = IMAGE_SIZE,
    crop_mm: float = CROP_MM,
    max_slices: int = SLICES_PER_SLOT,
) -> tuple[torch.Tensor, list[int]]:
    """Return uint8 [K,H,W] stack and source indices in anatomical order."""
    files = ordered_slice_files(record)
    indices = stack_indices(len(files), max_slices)
    if not len(indices):
        raise ValueError(f"Series {record.series_uid} contains no DICOM slices")

    planes: list[np.ndarray] = []
    for index in indices:
        path = files[int(index)]
        try:
            dataset = pydicom.dcmread(path, force=True)
            pixels = dataset.pixel_array.astype(np.float32)
            pixels = pixels * float(getattr(dataset, "RescaleSlope", 1) or 1)
            pixels = pixels + float(getattr(dataset, "RescaleIntercept", 0) or 0)
        except Exception as exc:
            raise RuntimeError(f"Cannot decode DICOM pixels: {path}") from exc
        if pixels.ndim != 2:
            raise ValueError(f"Expected 2D single-frame DICOM pixels in {path}; got shape {pixels.shape}")
        planes.append(pixels)

    shape = planes[0].shape
    if any(plane.shape != shape for plane in planes):
        raise ValueError(f"Series {record.series_uid} has mixed pixel dimensions")
    if record.pixel_spacing is None or any(value <= 0 for value in record.pixel_spacing):
        raise ValueError(f"Series {record.series_uid} has invalid PixelSpacing")

    volume = np.stack(planes)
    spacing_row, spacing_column = record.pixel_spacing
    desired_height = int(round(crop_mm / spacing_row))
    desired_width = int(round(crop_mm / spacing_column))
    if min(desired_height, desired_width) < 16:
        raise ValueError(f"Implausible physical crop dimensions {desired_height}x{desired_width}")
    height, width = volume.shape[1:]
    crop_height, crop_width = min(height, desired_height), min(width, desired_width)
    top, left = (height - crop_height) // 2, (width - crop_width) // 2
    volume = volume[:, top : top + crop_height, left : left + crop_width]

    low = float(np.percentile(volume, 1))
    high = float(np.percentile(volume, 99))
    volume = np.clip((volume - low) / max(high - low, 1e-6), 0, 1)
    pad_height, pad_width = desired_height - crop_height, desired_width - crop_width
    volume = np.pad(
        volume,
        ((0, 0), (pad_height // 2, pad_height - pad_height // 2),
         (pad_width // 2, pad_width - pad_width // 2)),
        constant_values=0,
    )
    tensor = torch.from_numpy(np.ascontiguousarray(volume)).unsqueeze(0)
    tensor = functional.interpolate(
        tensor, size=(image_size, image_size), mode="bilinear", align_corners=False
    )
    result = (tensor.squeeze(0) * 255).round().clamp(0, 255).to(torch.uint8)
    return result, [int(index) for index in indices]
