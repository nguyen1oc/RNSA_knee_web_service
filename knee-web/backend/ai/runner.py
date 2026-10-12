"""Local one-study inference runner for DICOM folders and ZIP archives."""

from __future__ import annotations

import csv
import json
import shutil
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import numpy as np

from backend.ai.contract import IMAGE_SIZE, SCORE_SEMANTICS, SLICES_PER_SLOT, SLOTS, TARGETS
from backend.ai.series import SeriesRecord, build_series_records, select_slots, study_laterality

MAX_DICOM_FILES = 500
MAX_EXPANDED_BYTES = 800 * 1024 * 1024


@contextmanager
def discover_dicom_files(input_path: Path) -> Iterator[list[Path]]:
    """Find DICOMs in a folder or ZIP; ZIP extraction is bounded and path-safe."""
    if input_path.is_dir():
        directory_paths = sorted(
            (path for path in input_path.rglob("*") if path.is_file() and path.suffix.lower() == ".dcm"),
            key=lambda item: str(item).casefold(),
        )
        if len(directory_paths) > MAX_DICOM_FILES:
            raise ValueError(f"Found {len(directory_paths)} DICOM files; limit is {MAX_DICOM_FILES}")
        total_bytes = sum(path.stat().st_size for path in directory_paths)
        if total_bytes > MAX_EXPANDED_BYTES:
            raise ValueError("Expanded DICOM folder exceeds the 800 MiB local-runner limit")
        yield directory_paths
        return

    if input_path.suffix.lower() != ".zip":
        if input_path.is_file() and input_path.suffix.lower() == ".dcm":
            yield [input_path]
            return
        raise ValueError("Input must be a DICOM folder, a .dcm file, or a .zip archive")

    with zipfile.ZipFile(input_path) as archive, tempfile.TemporaryDirectory(prefix="knee-ai-dicom-") as temp_dir:
        entries = [
            info for info in archive.infolist()
            if not info.is_dir() and Path(info.filename).suffix.lower() == ".dcm"
        ]
        if not entries:
            raise ValueError("ZIP archive contains no .dcm files")
        if len(entries) > MAX_DICOM_FILES:
            raise ValueError(f"ZIP contains {len(entries)} DICOM files; limit is {MAX_DICOM_FILES}")
        expanded_bytes = sum(info.file_size for info in entries)
        if expanded_bytes > MAX_EXPANDED_BYTES:
            raise ValueError("Expanded ZIP exceeds the 800 MiB local-runner limit")
        archive_paths: list[Path] = []
        temp_root = Path(temp_dir)
        for index, info in enumerate(entries):
            # Use only the member basename; never trust archive paths for extraction.
            destination = temp_root / f"{index:06d}_{Path(info.filename).name}"
            with archive.open(info) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
            archive_paths.append(destination)
        yield archive_paths


def read_series_metadata(path: Path | None) -> dict[str, dict[str, str]]:
    """Read optional official test_series.csv fields keyed by SeriesInstanceUID."""
    if path is None:
        return {}
    with path.open("r", newline="", encoding="utf-8-sig") as metadata_file:
        reader = csv.DictReader(metadata_file)
        required = {"SeriesInstanceUID", "Anatomical_Plane", "Fat_Suppression", "Fluid_Sensitive"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Series metadata CSV is missing columns: {sorted(missing)}")
        return {
            row["SeriesInstanceUID"]: row
            for row in reader
            if row.get("SeriesInstanceUID")
        }


def _choose_device(device_name: str):
    import torch

    if device_name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    device = torch.device(device_name)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable in this Python environment")
    return device


def prepare_model_input(
    selected: dict[str, SeriesRecord], laterality: str | None
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, dict[str, object]]]:
    """Build uint8 [1,4,16,3,224,224] images plus slot/slice masks."""
    from backend.ai.preprocessing import normalize_laterality, preprocess_series

    images = np.zeros((1, len(SLOTS), SLICES_PER_SLOT, 3, IMAGE_SIZE, IMAGE_SIZE), dtype=np.uint8)
    slot_mask: np.ndarray = np.zeros((1, len(SLOTS)), dtype=np.float32)
    slice_mask: np.ndarray = np.zeros((1, len(SLOTS), SLICES_PER_SLOT), dtype=np.float32)
    details: dict[str, dict[str, object]] = {}
    for slot_index, slot in enumerate(SLOTS):
        record = selected.get(slot.name)
        if record is None:
            details[slot.name] = {"present": False}
            continue
        stack, raw_indices = preprocess_series(record)
        stack = normalize_laterality(stack, slot.plane, laterality)
        # This checkpoint is a 2D baseline: repeat each center slice into RGB.
        rgb = stack.unsqueeze(1).expand(-1, 3, -1, -1).numpy()
        count = len(raw_indices)
        images[0, slot_index, :count] = rgb
        slot_mask[0, slot_index] = 1
        slice_mask[0, slot_index, :count] = 1
        details[slot.name] = {
            "present": True,
            "series_uid": record.series_uid,
            "description": record.description,
            "plane": record.plane,
            "fat_suppression": record.fat_suppression,
            "source_slice_count": len(record.files),
            "used_slice_count": count,
            "raw_anchor_indices": raw_indices,
            "geometry_score": list(record.selection_score),
        }
    if not slot_mask.any():
        raise ValueError("No model slot matched this study; cannot run inference")
    return images, slot_mask, slice_mask, details


def run_inference(
    input_path: Path,
    checkpoint_path: Path,
    *,
    metadata_path: Path | None = None,
    device_name: str = "auto",
) -> dict[str, object]:
    with discover_dicom_files(input_path) as dicom_paths:
        return run_inference_paths(
            dicom_paths,
            checkpoint_path,
            metadata_path=metadata_path,
            device_name=device_name,
        )


def run_inference_paths(
    dicom_paths: list[Path],
    checkpoint_path: Path,
    *,
    metadata_path: Path | None = None,
    device_name: str = "auto",
) -> dict[str, object]:
    """Run one study already resolved from the viewer's stored DICOM instances."""
    import torch

    from backend.ai.model import load_checkpoint

    device = _choose_device(device_name)
    metadata_by_series = read_series_metadata(metadata_path)
    if not dicom_paths:
        raise ValueError("No DICOM instances found for this study")
    records = build_series_records(dicom_paths, metadata_by_series)
    study_uids = sorted({record.study_uid for record in records})
    if len(study_uids) != 1:
        raise ValueError(
            "Input must contain exactly one study; found "
            f"{len(study_uids)} StudyInstanceUID values. Split studies before inference."
        )
    selected = select_slots(records)
    laterality = study_laterality(records)
    images, slot_mask, slice_mask, slot_details = prepare_model_input(selected, laterality)
    model, checkpoint, digest = load_checkpoint(checkpoint_path, device)
    image_tensor = torch.from_numpy(images).to(device)
    slot_tensor = torch.from_numpy(slot_mask).to(device)
    slice_tensor = torch.from_numpy(slice_mask).to(device)
    with torch.inference_mode():
        with torch.autocast("cuda", enabled=device.type == "cuda"):
            logits = model(image_tensor, slot_tensor, slice_tensor).float()
        scores = torch.sigmoid(logits).cpu().numpy()[0]
    if scores.shape != (len(TARGETS),) or not np.isfinite(scores).all():
        raise ValueError(f"Invalid model output shape/value: {scores.shape}")
    warnings = []
    if metadata_path is None:
        warnings.append(
            "Local DICOM-header heuristics were used for plane/Fat Suppression; "
            "pass the official series metadata CSV for exact labels."
        )
    return {
        "study_uid": study_uids[0],
        "checkpoint_sha256": digest,
        "checkpoint_epoch": checkpoint.get("epoch"),
        "device": str(device),
        "architecture": "ImageNet ResNet-34",
        "pooling": "gated_attention",
        "input_shape": list(images.shape),
        "laterality": laterality,
        "slot_order": [slot.name for slot in SLOTS],
        "slots": slot_details,
        "score_semantics": SCORE_SEMANTICS,
        "scores": [
            {"target": target, "score": float(score), "score_percent": round(float(score) * 100, 2)}
            for target, score in zip(TARGETS, scores)
        ],
        "warnings": warnings,
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run one local RSNA Knee DICOM study through fold-0 ResNet34.")
    parser.add_argument("--input", required=True, type=Path, help="One study folder, .dcm file, or .zip archive")
    parser.add_argument("--checkpoint", required=True, type=Path, help="Path to fold_00_best.zip/.pth")
    parser.add_argument("--series-metadata", type=Path, help="Optional official test_series.csv")
    parser.add_argument("--device", default="auto", help="auto, cpu, or cuda")
    parser.add_argument("--output", type=Path, help="Optional JSON output path")
    args = parser.parse_args()
    result = run_inference(
        args.input,
        args.checkpoint,
        metadata_path=args.series_metadata,
        device_name=args.device,
    )
    output = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"Wrote {args.output}")
    print(output)


if __name__ == "__main__":
    main()
