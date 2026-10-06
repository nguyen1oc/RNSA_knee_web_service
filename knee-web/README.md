# Knee Review — local DICOM workspace

This is the first local vertical slice for the knee diagnostic web service.
The UI is in English and currently supports:

- one seeded example study containing the existing `series_1` and `series_2` DICOM folders;
- importing individual `.dcm` files or a folder of `.dcm` files;
- grouping by `StudyInstanceUID` and `SeriesInstanceUID`;
- browsing series and slices with sagittal/coronal/axial labels when DICOM geometry is available;
- local PNG rendering, slice navigation, wheel/pinch zoom, pointer-drag pan, and Reset view controls;
- zoom starts at the initial fit size (100%); Zoom out cannot go below fit, while Zoom in has no artificial maximum;
- each image card shows its current slice position; clicking an Overview image selects that series without changing tabs, and only the selected card receives Slice/zoom/pan/reset controls; Open moves to the direction-focused tab;
- newly opened series start on a middle representative slice; the user can then browse the full stack;
- a collapsible Study → Series → slice-file tree in the workspace;
- tabs for Overview, Sagittal, Coronal, Axial, and Images / Series, plus a Study information panel; Overview is a compact 4-up comparison, each direction tab focuses its plane in a large fit-to-image viewport, and Images / Series is an acquisition browser;
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

Open <http://localhost:8080>.

The SQLite database and uploaded files are stored in the `knee_data` named volume.
To stop the app while preserving data:

```powershell
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to remove local uploads and the database.

## Run without Docker

Build the frontend:

```powershell
cd frontend
npm install
npm run build
cd ..
python -m uvicorn backend.main:app --reload --port 8080
```

The backend expects the sample DICOM folder at `../dicom-viewer/files`. Override it with `EXAMPLES_DIR` if needed.

## Deliberate first-slice limitations

Only uncompressed grayscale DICOM is rendered in this first slice. ZIP, compressed transfer syntaxes,
multi-frame studies, MPR/crosshair, patient-specific 3D, AI inference, and Triton are intentionally
deferred. DICOM Window Center/Width is used when available; otherwise the preview falls back to a
percentile range. The 3D card is an orientation locator, not a generic anatomy model and not a
diagnosis. The display controls change only the browser presentation; they do not modify source files.
