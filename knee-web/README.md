# Knee Review — local DICOM workspace

> **Cập nhật gần nhất:** 2026-10-09
> **Thay đổi gần nhất:** Backend có adapter Cloud Run + Firestore/GCS resumable upload; triển khai GCP và hardening public vẫn là các bước riêng.
> **Lịch sử:** [../knee-service-blueprint/CHANGELOG.md](../knee-service-blueprint/CHANGELOG.md)

This is the first local vertical slice for the knee diagnostic web service. Upload accepts individual `.dcm` files, folders, and unencrypted `.zip` archives containing DICOM files.
The UI is in English and currently supports:

- one seeded, read-only example study; it can be sourced from `series_1`/`series_2` folders or `results.zip` in the mounted examples directory;
- importing individual `.dcm` files or a folder of `.dcm` files;
- byte-based upload progress and a separate indexing state while a study is validated;
- grouping by `StudyInstanceUID` and `SeriesInstanceUID`;
- browsing series and slices with sagittal/coronal/axial labels when DICOM geometry is available;
- native DICOM rendering with Cornerstone3D, real Window/Level, slice navigation, center zoom/pan and Reset; PNG remains only for inventory thumbnails;
- zoom starts at the initial fit size (100%); Zoom out cannot go below fit, while Zoom in has no artificial maximum;
- each image card shows its current slice position; clicking an Overview image selects that series without changing tabs, and only the selected card receives Slice/zoom/pan/reset controls; Open moves to the direction-focused tab;
- newly opened focused series start on slice 1 instead of an arbitrary middle slice; the user can browse the full stack with the vertical rail or wheel;
- a collapsible Study → Series → slice-file tree in the workspace;
- tabs for Overview, Sagittal, Coronal, Axial, and Images / Series, plus a Study information panel; Overview is the MPR workspace with MRI Volume + three linked planes from one selected source series; direction tabs remain original acquisition stacks;
- focused direction tabs use one Layout dropdown with presets `1x1` and `2x2`, plus a hover-to-preview custom grid up to `4x4`; each viewport has its own vertical slice rail, zoom/reset controls, can be selected, panned, with independent slice positions;
- focused direction wheel navigation changes slices (scroll down = next, scroll up = previous); zoom remains explicit through the zoom controls;
- focused direction tools are grouped into one selector: Pointer (default), Length, Rectangle, Ellipse, Freehand, and Arrow + note; native geometry-based measurements use spacing metadata where available (calibration must be independently verified);
- Arrow + note opens an inline editor after drawing; `Eraser` removes one mark and `Clear slice marks` removes all marks on the current slice. Capture previews the final square export and downloads PNG/JPEG at 64×64, 128×128 or 512×512, with optional annotations and slice/orientation metadata;
- Overview supports `3D four-up`, `3D primary`, and `3D main` arrangements; MRI Volume is rendered from patient DICOM voxels (not a generic anatomy model), with colored plane overlays and a three-ring orientation gizmo;
- Overview MPR source defaults to an eligible geometry series, can be changed explicitly, and supplies the MRI volume plus linked axial/coronal/sagittal planes; ineligible series show the geometry reason and are not silently combined;
- an explicit local ingest pipeline: DICOM validation, metadata extraction, UID grouping, geometry-aware sorting, and on-demand preview rendering;
- real Window / Level drag tool, W/L values, Invert and Reset per native viewport;
- an Analyze button that clearly reports that the future AI/Triton pipeline is not connected yet;
- deleting imported studies; the example study is read-only;
- temporary anonymous session; no usernames, passwords, email or account required;
- the server scopes each upload to an HttpOnly session cookie; Clear session removes uploaded files, and idle sessions expire after 60 minutes (4-hour absolute maximum);
- upload defaults: 600 MiB request, 800 MiB expanded/session, 200 MiB per DICOM, 500 DICOM files; tune in `.env` only after testing memory/disk;
- Analyze remains a placeholder; AI, Triton and GPU are not connected.

## Run with Docker

From this directory:

```powershell
docker compose up --build
```

The Dockerfile builds the React frontend in a multi-stage image, so `frontend/dist` does not need to exist in a fresh clone.

## Temporary sessions and deployment status

See [anonymous session and upload-limit plan](../knee-service-blueprint/18-anonymous-session-and-upload-limits.md). There is no login/signup. The backend issues an HttpOnly cookie, scopes every study/data route to that temporary session, and deletes the session's uploads on reset/expiry. `SESSION_COOKIE_SECURE=true` is required behind HTTPS; local HTTP defaults to false.

Local Docker continues to use SQLite/filesystem. The Cloud Run backend path uses Firestore metadata and a private GCS bucket with browser-to-GCS resumable upload; configure `METADATA_BACKEND=firestore` only in Cloud Run. Cloud adapters are unit-tested with fakes, but not yet integration-tested against a GCP project. Before making the URL broadly public, add distributed rate limits and scheduled TTL cleanup, create GCP resources, deploy, and run two-session isolation/upload/delete smoke tests. See [deployment guide](../knee-service-blueprint/19-public-preview-deployment.md). Pipeline stages remain feature PR → `dev` staging test → reviewed `dev` to `main` → production; GitHub currently runs CI only.

## CI baseline

GitHub Actions runs on pushes to `dev`/`main` and on pull requests. The current gate is intentionally small:

- backend: Ruff lint, Mypy type-check, Python compilation, and pytest API contract tests;
- frontend: clean `npm ci` followed by `npm run build`;
- Docker: build the production image from a clean checkout.

The backend suite covers ZIP upload, invalid archives, idempotent example seeding, read-only example protection, cleanup, anonymous session isolation/expiry, upload caps and fake Firestore/GCS adapter behavior. Run it locally with `python -m pytest -q` from `knee-web`.

Open <http://localhost:8080>.

The SQLite database and uploaded files are stored in the `knee_data` named volume. This is local/staging storage, not public Cloud Run persistence.
To stop the app while preserving data:

```powershell
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to remove local uploads and the database.

## Frontend source layout

`frontend/src/main.jsx` is intentionally kept as the page orchestrator: it owns study/session state, API calls and viewer interaction state. The visual surface is split into small components so direction cards and controls can be changed independently:

- `components/StudySidebar.jsx` — Study → Series → slice tree and import/delete actions;
- `components/OverviewGrid.jsx` and `components/NativeViewport.jsx` — four-slot Overview and reusable image viewport;
- `components/LocatorCard.jsx` — non-diagnostic 3D orientation locator placeholder;
- `components/ViewerTabs.jsx`, `ViewerToolbar.jsx`, `NativeToolPicker.jsx` — navigation and display controls;
- `components/SeriesBrowser.jsx` — Images / Series acquisition browser;
- `components/StudyInfoPanel.jsx`, `EmptyWorkspace.jsx`, `SessionControls.jsx` — supporting panels, empty state and temporary-session actions;
- `session.js` — start/validate/reset browser session; `backend/session_token.py` and `backend/ingest.py` keep server session and bounded streaming ingest out of page code.

Keep new UI behavior in the smallest relevant component. Add shared state or API behavior to `main.jsx` only when it affects more than one surface.

## Run without Docker

Build the frontend:

```powershell
cd frontend
npm install
npm run build
cd ..
python -m uvicorn backend.main:app --reload --port 8080
```

The backend expects sample DICOM folders or `results.zip` at `../dicom-viewer/files`. Override it with `EXAMPLES_DIR` if needed. An example ZIP is indexed on startup; users do not need to upload it through the UI.

## P1 native viewer

See [native DICOM / MPR specification](../knee-service-blueprint/16-native-dicom-and-mpr.md) for controls, geometry checks and acceptance criteria. Build uses Node 24. Do not use this research viewer for clinical diagnosis.

MPR requires regular single-frame grayscale slices with valid IOP/IPP/spacing and a consistent Frame of Reference within that series. Ineligible data shows a reason; original stack views remain available. Patient-specific 3D, persistent annotations, DICOM SR and multi-frame indexing are deferred. Compressed syntax support depends on the bundled decoder; this is not yet validated across vendors or for clinical diagnosis.

Dependency audit currently reports transitive advisories; public deployment is not ready. No source DICOM pixels are modified by presentation tools.
