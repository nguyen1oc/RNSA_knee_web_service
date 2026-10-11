"""DICOM pixel conversion for the browser preview endpoint."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pydicom
from PIL import Image

from backend.dicom_metadata import clean, dicom_number


def render_preview(path: Path) -> bytes:
    """Render one DICOM instance as an 8-bit PNG preview."""
    dataset = pydicom.dcmread(path)
    pixels = dataset.pixel_array.astype(np.float32)
    if pixels.ndim > 2:
        pixels = pixels[0]
    pixels = pixels * float(getattr(dataset, "RescaleSlope", 1) or 1) + float(
        getattr(dataset, "RescaleIntercept", 0) or 0
    )
    finite = pixels[np.isfinite(pixels)]
    center = dicom_number(getattr(dataset, "WindowCenter", None))
    width = dicom_number(getattr(dataset, "WindowWidth", None))
    if width > 0:
        low, high = center - width / 2, center + width / 2
    else:
        percentiles = np.asarray(np.percentile(finite, [1, 99]), dtype=float)
        low, high = float(percentiles[0]), float(percentiles[1])
    if high <= low:
        low, high = float(np.min(pixels)), float(np.max(pixels) or 1)
    pixels = np.clip((pixels - low) / max(high - low, 1e-6), 0, 1)
    if clean(getattr(dataset, "PhotometricInterpretation", "")) == "MONOCHROME1":
        pixels = 1 - pixels
    image = Image.fromarray((pixels * 255).astype(np.uint8), mode="L")
    from io import BytesIO

    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()

