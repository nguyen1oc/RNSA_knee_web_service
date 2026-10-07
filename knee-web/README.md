# Knee Review — local DICOM workspace

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** MRI Volume zoom out được dưới fit ban đầu đến sàn an toàn 1%; zoom in không giới hạn hữu hạn.
> **Lịch sử:** [../knee-service-blueprint/CHANGELOG.md](../knee-service-blueprint/CHANGELOG.md)

This is the first local vertical slice for the knee diagnostic web service. Upload accepts individual `.dcm` files, folders, and unencrypted `.zip` archives containing DICOM files.
The UI is in English and currently supports:

- one seeded, read-only example study; it can be sourced from `series_1`/`series_2` folders or `results.zip` in the mounted examples directory;
- importing individual `.dcm` files or a folder of `.dcm` files;
- grouping by `StudyInstanceUID` and `SeriesInstanceUID`;
- browsing series and slices with sagittal/coronal/axial labels when DICOM geometry is available;
- native DICOM rendering with Cornerstone3D, real Window/Level, slice navigation, center zoom/pan and Reset; PNG remains only for inventory thumbnails;
- zoom starts at the initial fit size (100%); Zoom out can go below fit to a 1% safety floor, while Zoom in has no artificial maximum;
- Overview's `MPR source` selector chooses one acquisition for the 3D volume and all three synchronized MPR planes; changing source reloads them together. Initial selection prefers valid geometry metadata, then sagittal orientation and more slices, but the volume eligibility gate remains authoritative;
- newly opened focused series start on slice 1 instead of an arbitrary middle slice; the user can browse the full stack with the vertical rail or wheel;
- a collapsible Study → Series → slice-file tree in the workspace;
- tabs for Overview, Sagittal, Coronal, Axial, and Images / Series, plus a Study information panel; Overview is the patient-specific 3D MRI + three linked MPR views with `3D four-up`, `3D primary`, and `3D main` layouts; direction tabs show original acquisitions, and Images / Series is the acquisition browser;
- focused direction tabs use one Layout dropdown with presets `1x1` and `2x2`, plus a hover-to-preview custom grid up to `4x4`; each viewport has its own vertical slice rail, zoom/reset controls, can be selected, panned, with independent slice positions;
- focused direction wheel navigation changes slices (scroll down = next, scroll up = previous); zoom remains explicit through the zoom controls;
- focused direction tools are grouped into one selector: Pointer (default), Length, Rectangle, Ellipse, Freehand, and Arrow + note; native geometry-based measurements use spacing metadata where available (calibration must be independently verified);
- Arrow + note opens an inline editor after drawing; the Eraser button removes one clicked mark; `Clear all marks` is a secondary action with confirmation. Capture previews the configured export before downloading PNG/JPEG at 512×512, 256×256 or 128×128; the image is fit without cropping or stretching, with optional annotations and slice/orientation metadata;
- volume appearance offers `Standard MR` and `Angio-style (experimental)`; projection separately selects `Composite` or true maximum-intensity projection (MIP). Angio-style is only a display mapping and does not create angiographic information;
- Overview's 3D volume is intensity rendering from patient DICOM voxels, not a generic anatomy model, surface mesh, segmentation or diagnosis; colored planes follow the current MPR slice positions. A compact black mini-orbit gizmo with three thin rings appears only at the lower-right of MRI Volume: red/axial rotates left-right, yellow/sagittal rotates up-down, and green/coronal rotates obliquely. Drag a ring to rotate around its axis; drag anywhere on the black MRI Volume viewport background to rotate freely (four-way move cursor indicates the draggable area). The volume header has dedicated −/+ zoom controls, a live percentage, a 1% safety floor (so zoom-out can go below initial fit), and no practical upper cap; camera rotation/zoom does not reorient MPR slices;
- In Overview, grabbing an MPR plane moves only that series' slice; drag mapping follows the plane normal from its own viewport and uses its strongest on-screen axis at the current 3D camera angle;
- an explicit local ingest pipeline: DICOM validation, metadata extraction, UID grouping, geometry-aware sorting, and on-demand preview rendering;
- real Window / Level drag tool (window width adjusts contrast range; window level shifts the grayscale brightness center), W/L values, Invert and Reset per native viewport;
- Study information explains cross-series frame mismatches without truncating the status; this blocks cross-series alignment, not necessarily single-series MPR;
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

- backend: Ruff lint, Mypy type-check, Python compilation, and pytest API contract tests;
- frontend: clean `npm ci` followed by `npm run build`;
- Docker: build the production image from a clean checkout.

The backend fixture suite covers ZIP upload, invalid archives, idempotent example seeding, read-only example protection, and uploaded-study cleanup. Run it locally with `python -m pytest -q` from `knee-web`.

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
- `components/OverviewGrid.jsx` and `components/NativeViewport.jsx` — four-slot Overview and reusable image viewport;
- `components/LocatorCard.jsx` — non-diagnostic 3D orientation locator placeholder;
- `components/ViewerTabs.jsx`, `ViewerToolbar.jsx`, `NativeToolPicker.jsx` — navigation and display controls;
- `components/SeriesBrowser.jsx` — Images / Series acquisition browser;
- `components/VolumeOrientationGizmo.jsx` — compact three-axis camera snap control rendered only inside the 3D MRI volume viewport;
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

## P1 native viewer

See [native DICOM / MPR specification](../knee-service-blueprint/16-native-dicom-and-mpr.md) for controls, geometry checks and acceptance criteria. Build uses Node 24. Medical data stays local; no accounts or inference service.

Overview uses one eligible single-frame grayscale series with valid IOP/IPP/spacing to render a patient-specific 3D MRI volume and three linked axial/sagittal/coronal MPR views. Ineligible data shows a reason; original acquisition stacks remain available in the direction tabs. Colored planes on the 3D volume represent current slice positions; select/drag a plane or use the wheel to move it. Appearance (`Standard MR` / `Angio-style (experimental)`) is separate from projection (`Composite` / true maximum-intensity projection). Angio-style changes display mapping only. The volume is intensity rendering, not a surface model, segmentation, AI result, or diagnostic tool. Fluid-sensitive / fat-suppressed contrast is encoded by the acquisition; display presets do not create or remove fat suppression. The generic anatomy reference model is not shown as the patient's 3D. Persistent annotations, DICOM SR, segmentation and multi-frame indexing are deferred. Compressed syntax support depends on the bundled decoder; this is not yet validated across vendors or for clinical diagnosis.

Dependency audit currently reports transitive advisories; public deployment is not ready. No source DICOM pixels are modified by presentation tools.
