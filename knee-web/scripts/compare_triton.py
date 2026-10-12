"""Compare Triton scores with the existing local runner for one DICOM study."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import tritonclient.http as httpclient

from backend.ai.runner import discover_dicom_files, prepare_model_input, run_inference
from backend.ai.series import build_series_records, select_slots, study_laterality


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--url", default="127.0.0.1:8000")
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument("--atol", type=float, default=5e-4)
    parser.add_argument("--rtol", type=float, default=1e-4)
    args = parser.parse_args()

    with discover_dicom_files(args.input) as paths:
        records = build_series_records(paths)
        selected = select_slots(records)
        images, slot_mask, slice_mask, _ = prepare_model_input(
            selected, study_laterality(records)
        )

    local = run_inference(args.input, args.checkpoint, device_name=args.device)
    client = httpclient.InferenceServerClient(url=args.url)
    if not client.is_server_live() or not client.is_server_ready():
        raise RuntimeError(f"Triton server is not live and ready at {args.url}")
    if not client.is_model_ready("knee_resnet34"):
        raise RuntimeError("Triton model knee_resnet34 is not ready")

    inputs = []
    for name, array, datatype in (
        ("IMAGES", images, "UINT8"),
        ("SLOT_MASK", slot_mask, "FP32"),
        ("SLICE_MASK", slice_mask, "FP32"),
    ):
        item = httpclient.InferInput(name, list(array.shape), datatype)
        item.set_data_from_numpy(array)
        inputs.append(item)
    result = client.infer("knee_resnet34", inputs, outputs=[httpclient.InferRequestedOutput("SCORES")])
    triton_scores = result.as_numpy("SCORES")[0]
    local_scores = np.asarray([row["score"] for row in local["scores"]], dtype=np.float32)
    difference = np.abs(local_scores - triton_scores)

    print(f"Local device: {args.device}")
    print(f"Triton output shape: {result.as_numpy('SCORES').shape}")
    print(f"Max absolute score difference: {difference.max():.8g}")
    print(f"All scores within tolerance: {np.allclose(local_scores, triton_scores, atol=args.atol, rtol=args.rtol)}")
    if not np.allclose(local_scores, triton_scores, atol=args.atol, rtol=args.rtol):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
