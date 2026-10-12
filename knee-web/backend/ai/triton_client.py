"""Small authenticated Triton v2 HTTP client for study inference tensors."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

import numpy as np
import requests

MODEL_NAME = "knee_resnet34"
EXPECTED_SCORES = (1, 12)


class TritonInferenceError(RuntimeError):
    """The remote inference endpoint failed or returned an invalid response."""


def _headers(url: str, header_length: int) -> dict[str, str]:
    headers = {
        "Content-Type": "application/octet-stream",
        "Inference-Header-Content-Length": str(header_length),
    }
    hostname = urlparse(url).hostname or ""
    if hostname not in {"localhost", "127.0.0.1", "::1"}:
        # Cloud Run's private service expects an ID token whose audience is its
        # canonical service URL. The Cloud Run runtime identity supplies ADC.
        from google.auth.transport.requests import Request as GoogleAuthRequest
        from google.oauth2.id_token import fetch_id_token

        headers["Authorization"] = f"Bearer {fetch_id_token(GoogleAuthRequest(), url)}"
    return headers


def infer(
    url: str,
    images: np.ndarray,
    slot_mask: np.ndarray,
    slice_mask: np.ndarray,
    *,
    timeout_seconds: float = 180,
) -> np.ndarray:
    """Send the frozen tensors with Triton's binary extension and return scores."""
    base_url = url.rstrip("/")
    tensors = (
        ("IMAGES", "UINT8", np.asarray(images, dtype=np.uint8)),
        ("SLOT_MASK", "FP32", np.asarray(slot_mask, dtype=np.float32)),
        ("SLICE_MASK", "FP32", np.asarray(slice_mask, dtype=np.float32)),
    )
    inputs: list[dict[str, Any]] = []
    buffers: list[bytes] = []
    for name, datatype, tensor in tensors:
        value = np.ascontiguousarray(tensor)
        raw = value.tobytes(order="C")
        inputs.append(
            {
                "name": name,
                "shape": list(value.shape),
                "datatype": datatype,
                "parameters": {"binary_data_size": len(raw)},
            }
        )
        buffers.append(raw)

    request_header = {
        "inputs": inputs,
        "outputs": [{"name": "SCORES", "parameters": {"binary_data": True}}],
    }
    header = json.dumps(request_header, separators=(",", ":")).encode("utf-8")
    try:
        response = requests.post(
            f"{base_url}/v2/models/{MODEL_NAME}/infer",
            data=header + b"".join(buffers),
            headers=_headers(base_url, len(header)),
            timeout=timeout_seconds,
        )
    except requests.Timeout as exc:
        raise TritonInferenceError("Triton inference timed out") from exc
    except requests.RequestException as exc:
        raise TritonInferenceError("Could not reach the Triton inference service") from exc

    if not response.ok:
        # Avoid returning an upstream body that might contain implementation details.
        raise TritonInferenceError(f"Triton returned HTTP {response.status_code}")
    try:
        response_header_length = int(
            response.headers.get("Inference-Header-Content-Length", "0")
        )
        if response_header_length <= 0 or response_header_length > len(response.content):
            raise ValueError("missing or invalid inference header length")
        result = json.loads(response.content[:response_header_length])
        output = next(item for item in result["outputs"] if item["name"] == "SCORES")
        if output["datatype"] != "FP32" or tuple(output["shape"]) != EXPECTED_SCORES:
            raise ValueError("unexpected scores type or shape")
        output_size = int(output["parameters"]["binary_data_size"])
        binary = response.content[response_header_length :]
        if output_size != int(np.prod(EXPECTED_SCORES)) * np.dtype(np.float32).itemsize:
            raise ValueError("unexpected scores byte length")
        if len(binary) != output_size:
            raise ValueError("response scores payload is truncated")
        scores = np.frombuffer(binary, dtype=np.float32).reshape(EXPECTED_SCORES).copy()
    except (KeyError, TypeError, ValueError, StopIteration, json.JSONDecodeError) as exc:
        raise TritonInferenceError("Triton returned an invalid inference response") from exc
    if not np.isfinite(scores).all():
        raise TritonInferenceError("Triton returned non-finite scores")
    return scores
