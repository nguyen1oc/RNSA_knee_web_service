from __future__ import annotations

import json

import numpy as np
import pytest
import requests

from backend.ai.triton_client import TritonInferenceError, infer


def test_infer_encodes_fixed_inputs_and_decodes_binary_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, object] = {}
    scores = np.linspace(0, 1, 12, dtype=np.float32).reshape(1, 12)
    result_header = json.dumps(
        {
            "outputs": [
                {
                    "name": "SCORES",
                    "datatype": "FP32",
                    "shape": [1, 12],
                    "parameters": {"binary_data_size": scores.nbytes},
                }
            ]
        },
        separators=(",", ":"),
    ).encode()

    class Response:
        ok = True
        status_code = 200
        headers = {"Inference-Header-Content-Length": str(len(result_header))}
        content = result_header + scores.tobytes()

    def fake_post(url: str, *, data: bytes, headers: dict[str, str], timeout: float) -> Response:
        observed.update(url=url, data=data, headers=headers, timeout=timeout)
        return Response()

    monkeypatch.setattr("backend.ai.triton_client.requests.post", fake_post)
    images = np.zeros((1, 4, 16, 3, 224, 224), dtype=np.uint8)
    slot_mask = np.array([[1, 1, 0, 0]], dtype=np.float32)
    slice_mask = np.zeros((1, 4, 16), dtype=np.float32)

    actual = infer("http://127.0.0.1:8000", images, slot_mask, slice_mask)

    request_header_length = int(observed["headers"]["Inference-Header-Content-Length"])  # type: ignore[index]
    request_header = json.loads(observed["data"][:request_header_length])  # type: ignore[index]
    assert observed["url"] == "http://127.0.0.1:8000/v2/models/knee_resnet34/infer"
    assert [item["name"] for item in request_header["inputs"]] == [
        "IMAGES",
        "SLOT_MASK",
        "SLICE_MASK",
    ]
    assert request_header["inputs"][0]["shape"] == [1, 4, 16, 3, 224, 224]
    assert len(observed["data"]) == request_header_length + images.nbytes + slot_mask.nbytes + slice_mask.nbytes  # type: ignore[arg-type]
    np.testing.assert_array_equal(actual, scores)


def test_infer_rejects_invalid_binary_output(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        ok = True
        status_code = 200
        headers = {"Inference-Header-Content-Length": "2"}
        content = b"{}bad"

    monkeypatch.setattr("backend.ai.triton_client.requests.post", lambda *args, **kwargs: Response())
    with pytest.raises(TritonInferenceError, match="invalid inference response"):
        infer(
            "http://127.0.0.1:8000",
            np.zeros((1, 4, 16, 3, 224, 224), dtype=np.uint8),
            np.zeros((1, 4), dtype=np.float32),
            np.zeros((1, 4, 16), dtype=np.float32),
        )


def test_infer_maps_timeout_to_safe_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args: object, **kwargs: object) -> None:
        raise requests.Timeout("internal timeout details")

    monkeypatch.setattr("backend.ai.triton_client.requests.post", fail)
    with pytest.raises(TritonInferenceError, match="timed out"):
        infer(
            "http://127.0.0.1:8000",
            np.zeros((1, 4, 16, 3, 224, 224), dtype=np.uint8),
            np.zeros((1, 4), dtype=np.float32),
            np.zeros((1, 4, 16), dtype=np.float32),
        )
