"""DICOM inventory, plane/fat-suppression classification, and slot selection."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pydicom

from backend.ai.contract import SLOTS

FATSAT_OPTIONS = {"FS", "FATSAT", "FAT_SAT", "FSAT"}
SEPARATOR_PATTERN = re.compile(r"[_\-.]")
FATSAT_PATTERN = re.compile(
    r"\bfs\b|fatsat|fat sat|\bstir\b|\bspair\b|\bspir\b|\bwe\b|"
    r"water excit|\btirm\b|\bsting\b|\bfatsup\b"
)
T1_PATTERN = re.compile(r"\bt1\b|\bt1w\b")
T2_PATTERN = re.compile(r"\bt2\b|\bt2w\b")
PD_PATTERN = re.compile(r"\bpd\b|\bpdw\b|proton|\bdp\b|dens")


@dataclass
class SliceHeader:
    path: Path
    image_position: tuple[float, ...] | None
    image_orientation: tuple[float, ...] | None
    instance_number: float | None


@dataclass
class SeriesRecord:
    study_uid: str
    series_uid: str
    files: list[Path]
    headers: list[SliceHeader]
    description: str
    sequence_name: str
    scan_options: tuple[str, ...]
    scanning_sequence: str
    repetition_time: float | None
    echo_time: float | None
    laterality: str | None
    pixel_spacing: tuple[float, float] | None
    rows: int | None
    columns: int | None
    plane: str
    fat_suppression: bool
    fluid_sensitive: bool
    selection_score: tuple[float, ...] = field(default_factory=tuple)


def _float_tuple(value: Any) -> tuple[float, ...] | None:
    try:
        numbers = tuple(float(item) for item in value)
    except (TypeError, ValueError):
        return None
    return numbers if numbers and np.isfinite(numbers).all() else None


def _optional_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if np.isfinite(result) else None


def _optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def plane_from_orientation(orientation: tuple[float, ...] | None) -> str:
    """Classify the acquisition plane by the dominant axis of its DICOM normal."""
    if orientation is None or len(orientation) < 6:
        return "Unknown"
    normal = np.cross(orientation[:3], orientation[3:6])
    norm = float(np.linalg.norm(normal))
    if norm <= 1e-8:
        return "Unknown"
    axis = int(np.argmax(np.abs(normal / norm)))
    return {0: "Sagittal", 1: "Coronal", 2: "Axial"}[axis]


def _is_fat_suppressed(description: str, sequence_name: str, options: tuple[str, ...]) -> bool:
    text = SEPARATOR_PATTERN.sub(" ", f"{description} {sequence_name}".lower())
    option_match = any(item.strip().upper() in FATSAT_OPTIONS for item in options)
    return bool(FATSAT_PATTERN.search(text) or option_match)


def _is_fluid_sensitive(
    description: str,
    sequence_name: str,
    scanning_sequence: str,
    repetition_time: float | None,
    echo_time: float | None,
) -> bool:
    text = SEPARATOR_PATTERN.sub(" ", f"{description} {sequence_name}".lower())
    gre = "GR" in scanning_sequence.upper()
    t1 = bool(T1_PATTERN.search(text))
    t2 = bool(T2_PATTERN.search(text))
    pd = bool(PD_PATTERN.search(text))
    if t1 and not t2 and not pd:
        weight = "T1"
    elif t2 and not pd:
        weight = "T2"
    elif pd:
        weight = "PD"
    elif gre:
        weight = "GRE"
    elif repetition_time is not None and repetition_time < 800:
        weight = "T1"
    elif echo_time is not None and echo_time > 60:
        weight = "T2"
    elif repetition_time is not None and repetition_time >= 800:
        weight = "PD"
    else:
        weight = "UNK"
    return weight in {"PD", "T2"}


def _read_header(path: Path) -> tuple[Any, SliceHeader]:
    try:
        dataset = pydicom.dcmread(path, stop_before_pixels=True, force=True)
    except Exception as exc:
        raise ValueError(f"Cannot read DICOM header: {path}") from exc
    return dataset, SliceHeader(
        path=path,
        image_position=_float_tuple(getattr(dataset, "ImagePositionPatient", None)),
        image_orientation=_float_tuple(getattr(dataset, "ImageOrientationPatient", None)),
        instance_number=_optional_float(getattr(dataset, "InstanceNumber", None)),
    )


def build_series_records(
    paths: list[Path], metadata_by_series: dict[str, dict[str, str]] | None = None
) -> list[SeriesRecord]:
    grouped: dict[tuple[str, str], list[tuple[Path, Any, SliceHeader]]] = {}
    for path in sorted(paths, key=lambda item: str(item).casefold()):
        dataset, slice_header = _read_header(path)
        study_uid = str(getattr(dataset, "StudyInstanceUID", "")).strip()
        series_uid = str(getattr(dataset, "SeriesInstanceUID", "")).strip()
        if not study_uid or not series_uid:
            raise ValueError(f"DICOM is missing StudyInstanceUID or SeriesInstanceUID: {path}")
        grouped.setdefault((study_uid, series_uid), []).append((path, dataset, slice_header))

    records: list[SeriesRecord] = []
    metadata_by_series = metadata_by_series or {}
    for (study_uid, series_uid), entries in sorted(grouped.items()):
        _, representative, _ = entries[len(entries) // 2]
        description = str(getattr(representative, "SeriesDescription", "") or "")
        sequence_name = str(getattr(representative, "SequenceName", "") or "")
        options_value = getattr(representative, "ScanOptions", ()) or ()
        if isinstance(options_value, str):
            options = tuple(item for item in options_value.split("\\") if item)
        else:
            options = tuple(str(item) for item in options_value)
        scanning_sequence = str(getattr(representative, "ScanningSequence", "") or "")
        repetition_time = _optional_float(getattr(representative, "RepetitionTime", None))
        echo_time = _optional_float(getattr(representative, "EchoTime", None))
        laterality = str(
            getattr(representative, "Laterality", None)
            or getattr(representative, "ImageLaterality", None)
            or ""
        ).strip().upper()[:1] or None
        spacing = _float_tuple(getattr(representative, "PixelSpacing", None))
        pixel_spacing = (spacing[0], spacing[1]) if spacing and len(spacing) >= 2 else None

        if metadata_by_series and series_uid not in metadata_by_series:
            raise ValueError(f"Series metadata CSV has no row for SeriesInstanceUID {series_uid}")
        supplied = metadata_by_series.get(series_uid, {})
        orientation = entries[0][2].image_orientation
        plane = supplied.get("Anatomical_Plane") or plane_from_orientation(orientation)
        if plane not in {"Axial", "Coronal", "Sagittal"}:
            raise ValueError(f"Cannot determine anatomical plane for series {series_uid}")
        if "Fat_Suppression" in supplied:
            fat_suppression = supplied["Fat_Suppression"].strip().lower() in {"1", "true", "yes"}
        else:
            fat_suppression = _is_fat_suppressed(description, sequence_name, options)
        if "Fluid_Sensitive" in supplied:
            fluid_sensitive = supplied["Fluid_Sensitive"].strip().lower() in {"1", "true", "yes"}
        else:
            fluid_sensitive = _is_fluid_sensitive(
                description, sequence_name, scanning_sequence, repetition_time, echo_time
            )

        records.append(
            SeriesRecord(
                study_uid=study_uid,
                series_uid=series_uid,
                files=[entry[0] for entry in entries],
                headers=[entry[2] for entry in entries],
                description=description,
                sequence_name=sequence_name,
                scan_options=options,
                scanning_sequence=scanning_sequence,
                repetition_time=repetition_time,
                echo_time=echo_time,
                laterality=laterality,
                pixel_spacing=pixel_spacing,
                rows=_optional_int(getattr(representative, "Rows", None)),
                columns=_optional_int(getattr(representative, "Columns", None)),
                plane=plane,
                fat_suppression=fat_suppression,
                fluid_sensitive=fluid_sensitive,
            )
        )
    return records


def geometry_score(record: SeriesRecord) -> tuple[float, ...]:
    """Mirror the inference notebook's lexicographic, all-slice geometry score."""
    normal: np.ndarray | None = None
    positions: list[np.ndarray] = []
    valid = 0
    for header in record.headers:
        orientation = header.image_orientation
        if normal is None and orientation and len(orientation) >= 6:
            candidate = np.cross(orientation[:3], orientation[3:6])
            norm = float(np.linalg.norm(candidate))
            if norm > 0:
                normal = candidate / norm
        if header.image_position and len(header.image_position) >= 3:
            positions.append(np.asarray(header.image_position[:3], dtype=float))
            valid += 1

    stable_fraction = 0.0
    large_gap_fraction = 1.0
    gap_cv = 1.0
    if normal is not None and valid >= 2:
        projections = np.sort(np.asarray([float(np.dot(pos, normal)) for pos in positions]))
        gaps = np.diff(projections)
        gaps = gaps[gaps > 1e-4]
        if len(gaps):
            median_gap = float(np.median(gaps))
            gap_cv = float(np.std(gaps) / (median_gap + 1e-6))
            large_gap_fraction = float(np.mean(gaps > 10.0))
            stable_fraction = valid / max(len(record.files), 1)

    spacing_ok = float(
        record.pixel_spacing is not None
        and all(np.isfinite(record.pixel_spacing))
        and all(value > 0 for value in record.pixel_spacing)
    )
    matrix_area = float((record.rows or 0) * (record.columns or 0))
    return (
        spacing_ok,
        stable_fraction,
        -large_gap_fraction,
        -gap_cv,
        float(valid),
        float(len(record.files)),
        matrix_area,
    )


def select_slots(records: list[SeriesRecord]) -> dict[str, SeriesRecord]:
    """Select one deterministic best candidate for each of the four named slots."""
    by_study: dict[str, list[SeriesRecord]] = {}
    for record in records:
        by_study.setdefault(record.study_uid, []).append(record)
    if len(by_study) != 1:
        raise ValueError("Select exactly one StudyInstanceUID before running inference")

    study_records = next(iter(by_study.values()))
    selected: dict[str, SeriesRecord] = {}
    for slot in SLOTS:
        candidates = [
            record
            for record in study_records
            if record.plane == slot.plane and record.fat_suppression == slot.fat_suppression
        ]
        if candidates:
            selected[slot.name] = max(
                sorted(candidates, key=lambda item: item.series_uid), key=geometry_score
            )
            selected[slot.name].selection_score = geometry_score(selected[slot.name])
    return selected


def study_laterality(records: list[SeriesRecord]) -> str | None:
    """Use laterality tags first, then the notebook's optional patient-X fallback."""
    tagged = next((record.laterality for record in records if record.laterality in {"L", "R"}), None)
    if tagged:
        return tagged
    xs = [
        header.image_position[0]
        for record in records
        for header in record.headers
        if header.image_position and len(header.image_position) >= 3
    ]
    if not xs:
        return None
    median_x = float(np.median(xs))
    if abs(median_x) < 5.0:
        return None
    return "R" if median_x < 0 else "L"
