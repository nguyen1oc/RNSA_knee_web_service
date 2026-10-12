# Knee Review Triton adapter

This is the first Triton packaging slice for the selected fold-0 checkpoint. It
wraps the existing `backend.ai.model` implementation; it does not duplicate
DICOM series selection or pixel preprocessing.

## Contract

The client sends the exact preprocessed arrays produced by
`backend.ai.runner.prepare_model_input`:

| Input | Triton type | Shape |
| --- | --- | --- |
| `IMAGES` | `UINT8` | `[1, 4, 16, 3, 224, 224]` |
| `SLOT_MASK` | `FP32` | `[1, 4]` |
| `SLICE_MASK` | `FP32` | `[1, 4, 16]` |

The output `SCORES` is `FP32 [1, 12]`, in the frozen order in
`backend.ai.contract.TARGETS`. Scores are sigmoid model scores, not calibrated
probabilities. Missing slots remain masked by the checkpoint's gated attention.

## Files

- `Dockerfile` pins NVIDIA Triton 25.10 and the PyTorch 2.5.1 / torchvision
  0.20.1 family used by the offline runner.
- `model_repository/knee_resnet34/config.pbtxt` declares the tensor contract
  and one GPU model instance.
- `model_repository/knee_resnet34/1/model.py` loads the checkpoint once during
  model initialization and runs inference per request.

The checkpoint is intentionally not copied into the image or committed. Mount
it at `/checkpoint/fold_00_best.zip`, or set `KNEE_CHECKPOINT_PATH` to another
private mounted path. Do not mount the DICOM upload bucket into this service.

## Local container test

Build from the `knee-web` directory. NGC may require a Docker login/API key for
`nvcr.io`; do not put that credential in the repository.

```powershell
docker build -f inference/triton/Dockerfile -t knee-review-triton:local .
docker run --rm --gpus all --shm-size=1g `
  -p 8000:8080 `
  -v "${PWD}/fold_00_best.zip:/checkpoint/fold_00_best.zip:ro" `
  knee-review-triton:local
```

Triton HTTP is exposed locally on `http://127.0.0.1:8000`; model health is
`/v2/models/knee_resnet34/ready`. Test using the comparison client after
installing `tritonclient[http]` in the local Python environment.

## Build in Google Cloud

From this `knee-web` directory, submit the image build to Cloud Build. The
custom ignore file is a whitelist: it uploads only `backend/ai` and the Triton
Docker/model files, not `.venv`, DICOM studies, or the checkpoint ZIP.

```powershell
$project = "rsna-knee-511004"
$region = "asia-southeast1"
$image = "$region-docker.pkg.dev/$project/knee-review/knee-triton:fold0-epoch13"

gcloud config set project $project
gcloud builds submit . `
  --project=$project `
  --region=$region `
  --config=inference/triton/cloudbuild.yaml `
  --ignore-file=inference/triton/cloudbuild.gcloudignore `
  --substitutions="_IMAGE_URI=$image" `
  --timeout=3600s
```

This only builds and pushes an image; it does not deploy a Cloud Run service.
The checkpoint must be provided separately from private model storage before
Triton can become ready.

## Cloud Run status

The staging Triton service is deployed privately as `knee-triton-staging` in
`asia-southeast1`, using one L4, 4 vCPU, 16 GiB RAM, `min=0`, `max=1`, and
concurrency 1. The checkpoint is mounted read-only from the separate private
model bucket at
`/checkpoint/resnet34/61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c/fold_00_best.zip`.
Only the staging API runtime identity has `roles/run.invoker`; the model bucket
is not mounted into the DICOM/API service.

The Analyze API preserves local checkpoint inference when `AI_CHECKPOINT_PATH`
is configured. When `TRITON_URL` is set, it preprocesses the study with the
same series/slot logic and forwards tensors to the private Triton HTTP v2 binary
endpoint using a Cloud Run ID token. The image tensor is about 9.2 MiB; masks
add a few hundred bytes. The API returns the same 12 scores and model metadata
shape as the local runner.

The model service, checkpoint mount, and one real end-to-end Analyze request
through the staging API are verified. All 12 scores matched the local runner
within `atol=5e-4`, `rtol=1e-4`; maximum absolute difference was 0.000259 for
the one shared sample study. First cold end-to-end call took 63.5 s and the
next warm call 1.83 s (one observation each, not a benchmark). Repeat on
representative studies and collect more latency samples before making broader
claims. Do not treat model scores as calibrated probabilities or diagnoses.

For GitHub Environment `staging`, configure these non-secret variables so
future `dev` deploys keep the connection:

| Variable | Value |
| --- | --- |
| `TRITON_URL` | `https://knee-triton-staging-jnbsqra6ma-as.a.run.app` (confirm with `gcloud run services describe knee-triton-staging --format="value(status.url)"`) |
| `AI_CHECKPOINT_SHA256` | `61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c` |
| `AI_CHECKPOINT_EPOCH` | `13` |
| `AI_DEVICE_LABEL` | `NVIDIA L4` |
| `TRITON_TIMEOUT_SECONDS` | `180` |

The API container build must use `INSTALL_LOCAL_AI=1` because the existing
preprocessing pipeline uses CPU PyTorch for DICOM resize/normalization. Inference
itself runs on the private Triton L4 service.
