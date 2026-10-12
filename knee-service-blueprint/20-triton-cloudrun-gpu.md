# Triton inference service on Cloud Run GPU

> **Status:** Staging Triton L4 and FastAPI integration are verified end-to-end. Production Triton L4 is provisioned and model-ready (2026-10-13); production FastAPI is not connected until GitHub `production` variables are added and a `main` deployment runs.

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
6. **Next:** finish staging acceptance and repeat cold/warm/concurrency measurements, then provision the isolated production Triton service below. Do not point production API at the staging model service.

## Production rollout (manual GPU service, automated API deploy)

Keep the same immutable Triton image and checkpoint SHA as the verified staging model, but use a separate private model bucket, a separate Triton runtime identity, and a separate private Cloud Run service. The DICOM bucket is not the model-artifact bucket. The Triton endpoint must remain IAM-authenticated; only the production FastAPI runtime service account receives `roles/run.invoker`.

The following PowerShell commands create the production model artifact bucket and identity, copy the verified checkpoint, and deploy the private GPU service. GPU resources are billable while an instance is running; `min=0` allows scale-to-zero. Review the Cloud Run cost page and project budget before creating the service.

```powershell
$project = "rsna-knee-511004"
$region = "asia-southeast1"
$modelBucket = "rsna-knee-models-production-511004"
$tritonService = "knee-triton-production"
$tritonRuntimeName = "knee-triton-runtime-prod"
$tritonRuntimeEmail = "$tritonRuntimeName@$project.iam.gserviceaccount.com"
$apiRuntimeEmail = "knee-review-api-production@rsna-knee-511004.iam.gserviceaccount.com"
$checkpointSha = "61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c"
$checkpointObject = "resnet34/$checkpointSha/fold_00_best.zip"
$image = "asia-southeast1-docker.pkg.dev/rsna-knee-511004/knee-review/knee-triton@sha256:b442345a6d8b1e80943f204e78ef91595bea7246b6659db39a06753ccc9989aa"

gcloud config set project $project
gcloud storage buckets create "gs://$modelBucket" `
  --project=$project --location=$region `
  --uniform-bucket-level-access --public-access-prevention
gcloud iam service-accounts create $tritonRuntimeName `
  --project=$project --display-name="Knee Review Production Triton Runtime"
gcloud storage buckets add-iam-policy-binding "gs://$modelBucket" `
  --member="serviceAccount:$tritonRuntimeEmail" `
  --role="roles/storage.objectViewer"
gcloud storage cp `
  "gs://rsna-knee-models-staging-511004/$checkpointObject" `
  "gs://$modelBucket/$checkpointObject"

gcloud run deploy $tritonService `
  --project=$project --region=$region --platform=managed `
  --image=$image --service-account=$tritonRuntimeEmail `
  --no-allow-unauthenticated --cpu=4 --memory=16Gi `
  --gpu=1 --gpu-type=nvidia-l4 --no-cpu-throttling `
  --min=0 --max=1 --concurrency=1 --timeout=3600s `
  --set-env-vars="KNEE_CHECKPOINT_PATH=/checkpoint/$checkpointObject" `
  --add-volume="mount-path=/checkpoint,type=cloud-storage,bucket=$modelBucket,readonly=true"

gcloud run services add-iam-policy-binding $tritonService `
  --project=$project --region=$region `
  --member="serviceAccount:$apiRuntimeEmail" `
  --role="roles/run.invoker"
```

Use the image digest above, not a mutable `latest` tag. If it is not present in Artifact Registry, rebuild/push the Triton image from the reviewed source first and use the resulting digest. The Cloud Storage mount is read-only and exposes only model artifacts to Triton. Cloud Run L4 requires at least 4 vCPU and 16 GiB memory; those values match the staging service. GPU-backed Cloud Run services can scale to zero, but GPU is billed for the instance lifetime. See [Cloud Run GPU configuration](https://docs.cloud.google.com/run/docs/configuring/services/gpu) and [Cloud Storage volume mounts](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts).

After the service becomes ready, retrieve—not guess—its URL:

```powershell
$tritonUrl = gcloud run services describe $tritonService `
  --project=$project --region=$region --format="value(status.url)"
$tritonUrl
```

Add the following non-secret variables to GitHub → Settings → Environments → `production`:

| Variable | Value |
| --- | --- |
| `TRITON_URL` | URL returned for `knee-triton-production` |
| `AI_CHECKPOINT_SHA256` | `61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c` |
| `AI_CHECKPOINT_EPOCH` | `13` |
| `AI_DEVICE_LABEL` | `NVIDIA L4` |
| `TRITON_TIMEOUT_SECONDS` | `180` |

The `main` deployment now fails closed if any of these are missing and injects them into the production FastAPI Cloud Run revision. Only after the Triton service is ready and these variables are set should the reviewed `dev → main` change be merged. GitHub's `production` Environment approval remains the human release gate. Then verify `/api/health`, run Analyze on the de-identified sample in the public production app, confirm all 12 scores, and inspect Cloud Run logs. Keep staging and production URLs, buckets, identities, and model storage separate.

### Provisioning completed (2026-10-13)

- Model bucket: `gs://rsna-knee-models-production-511004`; private, uniform bucket-level access, public access prevention.
- Checkpoint copied to `resnet34/61cdcea1ae8c0377c37495c9fc1f43bbcbff632b4168636440d41d2e4e39f47c/fold_00_best.zip` (87,444,409 bytes; MD5 matches staging).
- Triton runtime identity: `knee-triton-runtime-prod@rsna-knee-511004.iam.gserviceaccount.com`, with read-only `roles/storage.objectViewer` on the production model bucket.
- Cloud Run service: `knee-triton-production`, URL `https://knee-triton-production-jnbsqra6ma-as.a.run.app`, ready revision `knee-triton-production-00001-zwf`; L4, 4 vCPU, 16 GiB, min 0/max 1, concurrency 1, GPU zonal redundancy disabled.
- The service uses the verified image digest and read-only model-bucket mount. Triton logs show `knee_resnet34` version 1 `READY`; Cloud Run startup probe passed.
- IAM is private: `roles/run.invoker` is granted only to `knee-review-api-production@rsna-knee-511004.iam.gserviceaccount.com`.
- **Still pending:** add the five variables above to GitHub Environment `production`, then deploy the API from `main` and run one end-to-end Analyze test through the public frontend. The current production API revision has no `TRITON_URL`, so it is not yet invoking this Triton service.

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

The Dockerfile uses NVIDIA Triton 25.10 (`py3`) and the existing PyTorch 2.5.1 / torchvision 0.20.1 model stack. The NVIDIA base image is over 2 GB. A local Triton container run was not completed; the verified server inference test is the Cloud Run staging service described above. NGC authentication/API credentials, if requested, must stay out of Git and chat logs.

## References

- [NVIDIA Triton model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html)
- [NVIDIA Triton Python backend](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html)
- [Cloud Run GPU support and regions](https://docs.cloud.google.com/run/docs/configuring/services/gpu)
- [Cloud Run quotas and HTTP request limits](https://docs.cloud.google.com/run/quotas)
