# Triton inference service on Cloud Run GPU

> **Status:** Staging Triton L4 and FastAPI integration are deployed and verified end-to-end (2026-10-12). Production remains disconnected.

## Goal and current status

The online viewer backend is the CPU FastAPI service. A separate authenticated Cloud Run GPU service runs Triton. FastAPI validates session ownership, selects/preprocesses DICOM series into the fixed tensor contract, then sends tensors to Triton with a Cloud Run ID token. End-to-end Analyze on the staging sample has returned all 12 scores. No T4 VM is needed for this staging path.

The adapter scaffold is under `knee-web/inference/triton/`. It uses Triton's Python backend to wrap the existing strict PyTorch model, loads checkpoint once at model initialization, and declares the current fixed one-study tensor contract. The model code does not repeat the DICOM series-selection or preprocessing pipeline.

Cloud Build pushed `asia-southeast1-docker.pkg.dev/rsna-knee-511004/knee-review/knee-triton:fold0-epoch13` (digest `sha256:b442345a6d8b1e80943f204e78ef91595bea7246b6659db39a06753ccc9989aa`). The checkpoint remains outside the image in `gs://rsna-knee-models-staging-511004/resnet34/61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c/fold_00_best.zip` (87,444,409 bytes). The private service knee-triton-staging uses one L4, 4 CPU, 16 GiB RAM, min=0, max=1, and concurrency 1. Only the staging API runtime identity has roles/run.invoker. The model service reports ready after mounting and loading the checkpoint.

The Analyze route supports Triton when TRITON_URL is configured. FastAPI resolves study DICOMs, uses the existing slot selection and preprocessing, then sends fixed tensors over Triton's binary HTTP protocol with a Cloud Run ID token. Local AI_CHECKPOINT_PATH inference remains available. The API image uses INSTALL_LOCAL_AI=1 because preprocessing uses CPU PyTorch; model forward pass runs on L4. API route and Triton client tests pass locally.

Cloud Build e7f46c18-9f11-46f8-a354-3a91ed1c119c succeeded for API image `knee-review-api:triton-wire-20261012-01`; its 1.1 MiB source archive excluded model/DICOM data. The API analyzed the shared sample study from Firestore/GCS and returned all 12 scores via Triton L4; revision `knee-review-api-staging-00012-lip` is at 100% staging traffic. Selected series/slots and checkpoint SHA match the local runner. Against local NVIDIA MX350 output, max absolute score difference was 0.000259 (mean 0.000082); all 12 fit `atol=5e-4`, `rtol=1e-4`. First cold end-to-end request took 63.5 seconds; next warm request took 1.83 seconds (one observation each, not a latency benchmark). Production remains disconnected.

## Phases

1. **Adapter checks:** complete; Python syntax/tests pass and Cloud Run reports Triton ready with checkpoint mounted.
2. **Local parity:** local-runner versus Triton parity was checked on the shared sample; repeat on representative studies before making broader numerical claims.
3. **Cloud transport:** complete for one staging sample through the real authenticated API path; the input tensor is about 9.2 MiB and masks add a few hundred bytes.
4. **Protect model artifacts:** staging uses a dedicated private model bucket, dedicated service identity, read-only bucket access, and invoker access limited to the staging API identity.
5. **Deploy staging:** Triton L4 is private, min=0/max=1, concurrency 1; FastAPI staging is connected and returned all 12 scores.
6. **Next:** run the acceptance flow and repeated cold/warm/concurrency measurements on staging. Keep production disconnected until review and explicit production rollout.

## Triton model repository contract

```text
model_repository/
  knee_resnet34/
    config.pbtxt
    1/
      model.py
```

`config.pbtxt` lists three inputs (`IMAGES`, `SLOT_MASK`, `SLICE_MASK`) and `SCORES` output, in the target order from `backend.ai.contract.TARGETS`. `model.py` implements `TritonPythonModel.initialize`, `execute`, and `finalize`; weights load once, not once per request. The current contract is fixed batch 1 and no dynamic batching.

The local comparison client is `knee-web/scripts/compare_triton.py`; install its pinned HTTP client from `knee-web/inference/triton/requirements-client.txt`. The first staging sample compared with the local MX350 output had a maximum absolute score difference of 0.000259 and mean absolute difference of 0.000082; all 12 were within `atol=5e-4`, `rtol=1e-4`. This is a one-study numerical check, not cohort validation, model performance evidence, or clinical validation. Model scores are uncalibrated and not diagnoses.

## Local build note

The Dockerfile uses NVIDIA Triton 25.10 (`py3`) and the existing PyTorch 2.5.1 / torchvision 0.20.1 model stack. The NVIDIA base image is over 2 GB. The first local pull was very slow and was stopped before the image finished downloading, so no Triton server inference test has passed yet. NGC authentication/API credentials, if requested, must stay out of Git and chat logs.

## References

- [NVIDIA Triton model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html)
- [NVIDIA Triton Python backend](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html)
- [Cloud Run GPU support and regions](https://docs.cloud.google.com/run/docs/configuring/services/gpu)
- [Cloud Run quotas and HTTP request limits](https://docs.cloud.google.com/run/quotas)
