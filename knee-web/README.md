# Knee Review — local DICOM workspace

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Focused multi-view dùng Pointer mặc định, rail dọc chọn slice, zoom/reset riêng từng viewport và bắt đầu từ slice 1.
> **Lịch sử:** [../knee-service-blueprint/CHANGELOG.md](../knee-service-blueprint/CHANGELOG.md)

This is the first local vertical slice for the knee diagnostic web service. Upload accepts individual `.dcm` files, folders, and unencrypted `.zip` archives containing DICOM files.
The UI is in English and currently supports:

- one seeded, read-only example study; it can be sourced from `series_1`/`series_2` folders or `results.zip` in the mounted examples directory;
- importing individual `.dcm` files or a folder of `.dcm` files;
- grouping by `StudyInstanceUID` and `SeriesInstanceUID`;
- browsing series and slices with sagittal/coronal/axial labels when DICOM geometry is available;
- local PNG rendering, slice navigation, wheel/pinch zoom, pointer-drag pan, and Reset view controls;
- zoom starts at the initial fit size (100%); Zoom out cannot go below fit, while Zoom in has no artificial maximum;
- each image card shows its current slice position; clicking an Overview image selects that series without changing tabs, and only the selected card receives Slice/zoom/pan/reset controls; Open moves to the direction-focused tab;
- newly opened focused series start on slice 1 instead of an arbitrary middle slice; the user can browse the full stack with the vertical rail or wheel;
- a collapsible Study → Series → slice-file tree in the workspace;
- tabs for Overview, Sagittal, Coronal, Axial, and Images / Series, plus a Study information panel; Overview is a compact 4-up comparison, each direction tab focuses its plane in a large fit-to-image viewport, and Images / Series is an acquisition browser;
- focused direction tabs use one Layout dropdown with presets `1x1` and `2x2`, plus a hover-to-preview custom grid up to `4x4`; each viewport has its own vertical slice rail, zoom/reset controls, can be selected, panned, or optionally slice-synced;
- focused direction wheel navigation changes slices (scroll down = next, scroll up = previous); zoom remains explicit through the zoom controls;
- focused direction tools are grouped into one selector: Pointer (default), Length, Rectangle, Ellipse, Freehand, and Arrow + note; preview measurements show px or calibrated mm when DICOM PixelSpacing is available;
- Arrow + note opens an inline editor after drawing; `Undo mark` removes the last mark and `Clear slice marks` removes all marks on the current slice. Capture exports the active viewport as PNG/JPEG with optional annotations and slice/orientation metadata;
- Overview supports `3D four-up`, `3D primary`, and `3D main` arrangements; the 3D card remains an orientation locator, not patient-specific anatomy;
- Crosshair is visible but disabled until mapped MPR geometry is available; current sample geometry is not cross-series compatible;
- an explicit local ingest pipeline: DICOM validation, metadata extraction, UID grouping, geometry-aware sorting, and on-demand preview rendering;
- Contrast, Brightness, Invert, and Reset display controls for the local presentation preview;
- an Analyze button that clearly reports that the future AI/Triton pipeline is not connected yet;
- deleting imported studies; the example study is read-only;
- no accounts, passwords, AI, Triton, GPU, or GCP dependency.

## Run with Docker

From this directory:

```powershell
docker compose up --build
```

The Dockerfile builds the React frontend in a multi-stage image, so `frontend/dist` does not need to exist in a fresh clone.

## CI baseline

GitHub Actions runs on pushes to `main` and on pull requests. The current gate is intentionally small:

- backend: Ruff lint, Mypy type-check, and Python compilation;
- frontend: clean `npm ci` followed by `npm run build`;
- Docker: build the production image from a clean checkout.

There is not yet a DICOM fixture test suite. Add API/rendering tests before treating CI as a clinical-quality release gate; the current workflow only proves that the service is statically valid and packages successfully.

Open <http://localhost:8080>.

The SQLite database and uploaded files are stored in the `knee_data` named volume.
To stop the app while preserving data:

```powershell
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to remove local uploads and the database.

## Frontend source layout

`frontend/src/main.jsx` is intentionally kept as the page orchestrator: it owns study/session state, API calls and viewer interaction state. The visual surface is split into small components so direction cards and controls can be changed independently:

- `components/StudySidebar.jsx` — Study → Series → slice tree and import/delete actions;
- `components/OverviewGrid.jsx` and `components/ImageCard.jsx` — four-slot Overview and reusable image viewport;
- `components/LocatorCard.jsx` — non-diagnostic 3D orientation locator placeholder;
- `components/ViewerTabs.jsx`, `ViewerToolbar.jsx`, `DisplayToolbar.jsx` — navigation and display controls;
- `components/SeriesBrowser.jsx` — Images / Series acquisition browser;
- `components/StudyInfoPanel.jsx`, `EmptyWorkspace.jsx` — supporting panels and empty state.

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

## Deliberate first-slice limitations

Only uncompressed grayscale DICOM is rendered in this first slice. ZIP, compressed transfer syntaxes,
multi-frame studies, mapped MPR/crosshair, patient-specific 3D, AI inference, and Triton are intentionally
deferred. Freehand/shape overlays are viewport-coordinate annotations in this phase; calibrated mm
measurements, persisted annotations, DICOM SR, and MPR-linked crosshair require a geometry-aware viewer
engine. DICOM Window Center/Width is used when available; otherwise the preview falls back to a percentile
range. The 3D card is an orientation locator, not a generic anatomy model and not a diagnosis. Capture
and display controls change only the browser presentation; they do not modify source files.
