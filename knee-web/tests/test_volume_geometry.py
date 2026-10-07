from copy import deepcopy

import numpy as np
import pytest
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from backend.volume_geometry import volume_eligibility


@pytest.fixture()
def headers() -> list[Dataset]:
    frame, series = generate_uid(), generate_uid()
    result = []
    for index in range(5):
        ds = Dataset()
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [0, 0, index * 3]
        ds.PixelSpacing = [0.5, 0.5]
        ds.FrameOfReferenceUID = frame
        ds.SeriesInstanceUID = series
        ds.Rows = 64
        ds.Columns = 64
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.PixelRepresentation = 0
        result.append(ds)
    return result


def test_regular_stack_accepts_reversed_file_order(headers: list[Dataset]) -> None:
    result = volume_eligibility(headers[::-1])
    assert result["eligible"]
    assert result["slice_spacing_mm"] == 3
    assert result["anisotropic"]


def test_oblique_regular_stack(headers: list[Dataset]) -> None:
    root = float(np.sqrt(0.5))
    for index, ds in enumerate(headers):
        ds.ImageOrientationPatient = [root, root, 0, 0, 0, 1]
        ds.ImagePositionPatient = [index * 3 * root, -index * 3 * root, 0]
    assert volume_eligibility(headers)["eligible"]


@pytest.mark.parametrize("fault", ["missing", "duplicate", "gap", "orientation", "frame", "spacing", "dimensions", "multiframe", "offset", "nan", "nonunit", "series", "pixel_format"])
def test_rejects_unsafe_volume(headers: list[Dataset], fault: str) -> None:
    changed = deepcopy(headers)
    ds = changed[2]
    if fault == "missing":
        del ds.ImagePositionPatient
    elif fault == "duplicate":
        ds.ImagePositionPatient = changed[1].ImagePositionPatient
    elif fault == "gap":
        changed.pop(2)
    elif fault == "orientation":
        ds.ImageOrientationPatient = [0, 1, 0, 1, 0, 0]
    elif fault == "frame":
        ds.FrameOfReferenceUID = generate_uid()
    elif fault == "spacing":
        ds.PixelSpacing = [0, 0]
    elif fault == "dimensions":
        ds.Rows = 32
    elif fault == "multiframe":
        ds.NumberOfFrames = 2
    elif fault == "offset":
        ds.ImagePositionPatient = [2, 0, 6]
    elif fault == "nan":
        ds.ImagePositionPatient = [0, 0, float("nan")]
    elif fault == "nonunit":
        for item in changed:
            item.ImageOrientationPatient = [2, 0, 0, 0, 0.5, 0]
    elif fault == "series":
        ds.SeriesInstanceUID = generate_uid()
    elif fault == "pixel_format":
        ds.PixelRepresentation = 1
    result = volume_eligibility(changed)
    assert not result["eligible"]
    assert result["reasons"]


def test_rejects_small_stack(headers: list[Dataset]) -> None:
    assert not volume_eligibility(headers[:2])["eligible"]
