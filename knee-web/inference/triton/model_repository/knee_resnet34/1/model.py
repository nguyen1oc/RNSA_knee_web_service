"""Triton Python backend adapter for the frozen fold-0 Knee Study model."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import triton_python_backend_utils as pb_utils


EXPECTED_IMAGES = (1, 4, 16, 3, 224, 224)
EXPECTED_SLOT_MASK = (1, 4)
EXPECTED_SLICE_MASK = (1, 4, 16)
EXPECTED_SCORES = (1, 12)


def _read_input(request: Any, name: str, shape: tuple[int, ...]) -> np.ndarray:
    tensor = pb_utils.get_input_tensor_by_name(request, name)
    if tensor is None:
        raise ValueError(f"Missing required Triton input: {name}")
    value = tensor.as_numpy()
    if value.shape != shape:
        raise ValueError(f"{name} has shape {value.shape}; expected {shape}")
    if value.dtype not in (np.uint8, np.float32):
        raise ValueError(f"{name} has unsupported dtype {value.dtype}")
    if value.dtype == np.float32 and not np.isfinite(value).all():
        raise ValueError(f"{name} contains NaN or infinity")
    return np.ascontiguousarray(value)


class TritonPythonModel:
    """Loads the checkpoint once, then returns sigmoid scores for each request."""

    def initialize(self, args: dict[str, str]) -> None:
        ai_code_root = Path(os.environ.get("KNEE_AI_CODE_ROOT", "/opt/knee-ai"))
        sys.path.insert(0, str(ai_code_root))

        checkpoint_path = Path(
            os.environ.get("KNEE_CHECKPOINT_PATH", "/checkpoint/fold_00_best.zip")
        )
        if not checkpoint_path.is_file():
            raise FileNotFoundError(
                "Checkpoint not found. Mount the private model file and set "
                f"KNEE_CHECKPOINT_PATH; checked {checkpoint_path}."
            )

        if not torch.cuda.is_available():
            raise RuntimeError("Triton model instance is GPU-backed, but CUDA is unavailable")
        device_id = int(args.get("model_instance_device_id", "0"))
        self.device = torch.device(f"cuda:{device_id}")

        from backend.ai.model import load_checkpoint

        self.model, checkpoint, self.checkpoint_sha256 = load_checkpoint(
            checkpoint_path, self.device
        )
        self.checkpoint_epoch = checkpoint.get("epoch")
        self.model.eval()

    def execute(self, requests: list[Any]) -> list[Any]:
        responses = []
        for request in requests:
            try:
                images = _read_input(request, "IMAGES", EXPECTED_IMAGES)
                slot_mask = _read_input(request, "SLOT_MASK", EXPECTED_SLOT_MASK)
                slice_mask = _read_input(request, "SLICE_MASK", EXPECTED_SLICE_MASK)

                image_tensor = torch.from_numpy(images).to(self.device)
                slot_tensor = torch.from_numpy(slot_mask).to(self.device)
                slice_tensor = torch.from_numpy(slice_mask).to(self.device)
                with torch.inference_mode(), torch.autocast("cuda"):
                    logits = self.model(image_tensor, slot_tensor, slice_tensor).float()
                    scores = torch.sigmoid(logits).cpu().numpy().astype(np.float32)

                if scores.shape != EXPECTED_SCORES or not np.isfinite(scores).all():
                    raise ValueError(f"Model returned invalid scores: shape={scores.shape}")

                output = pb_utils.Tensor("SCORES", scores)
                responses.append(pb_utils.InferenceResponse(output_tensors=[output]))
            except Exception as exc:
                responses.append(
                    pb_utils.InferenceResponse(
                        error=pb_utils.TritonError(str(exc))
                    )
                )
        return responses

    def finalize(self) -> None:
        if hasattr(self, "model"):
            del self.model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
