# Knee Review

Local DICOM viewer prototype for knee MRI studies.

## Contents

- `knee-web/` — FastAPI + React service runnable with Docker.
- `knee-service-blueprint/` — product, viewer, API, QA and deployment documentation.

## Run locally

```powershell
cd knee-web
docker compose up --build -d
```

Open <http://localhost:8080>.

The local MVP accepts `.dcm` files or folders, displays study/series/slice data, validates basic DICOM geometry, and keeps Analyze/Triton integration as a future phase. Docker builds the React frontend in a multi-stage image; no local `dist/` folder is required. Runtime DICOM files and database data are intentionally ignored by Git.

The sample DICOM folder is local-only and is not committed. To seed the example study, provide the folder through the Compose `EXAMPLES_DIR` mount or import your own `.dcm` files from the UI.
