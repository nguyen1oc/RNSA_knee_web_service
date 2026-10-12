"""Local example-study seeding helpers."""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from typing import Any


def seed_example(services: Any) -> None:
    if services.cloud_mode():
        # Cloud examples should be provisioned as reviewed, immutable bucket data.
        return
    examples_dir = services.EXAMPLES_DIR
    if not examples_dir.exists():
        return
    archive = next(
        (candidate for candidate in [examples_dir / "results.zip", examples_dir / "result.zip"] if candidate.is_file()),
        None,
    )
    with services.db() as connection:
        sample_row = connection.execute("SELECT id FROM studies WHERE source = 'sample' LIMIT 1").fetchone()
        if sample_row:
            sample_paths = connection.execute(
                "SELECT path FROM instances WHERE series_id IN (SELECT id FROM series WHERE study_id = ?)",
                (sample_row["id"],),
            ).fetchall()
            if sample_paths and all(Path(row["path"]).is_file() for row in sample_paths):
                return
            if archive is None:
                return
            connection.execute("DELETE FROM studies WHERE id = ?", (sample_row["id"],))
    if archive is not None:
        seed_example_archive(services, archive)
        return
    dicom_files = sorted(examples_dir.rglob("*.dcm"))
    if not dicom_files:
        return
    parsed: list[tuple[dict[str, Any], Path]] = []
    for path in dicom_files:
        try:
            parsed.append((services.parse_metadata(path.read_bytes()), path.resolve()))
        except Exception:
            continue
    if not parsed or len({item[0]["study_uid"] for item in parsed}) != 1:
        return
    services.insert_study(
        study_uid=parsed[0][0]["study_uid"],
        display_name="Example Knee Study",
        source="sample",
        files=parsed,
        study_id="sample-knee",
    )


def seed_example_archive(services: Any, archive: Path) -> None:
    sample_root = services.STORAGE_DIR / "sample-archive"
    shutil.rmtree(sample_root, ignore_errors=True)
    sample_root.mkdir(parents=True, exist_ok=True)
    parsed: list[tuple[dict[str, Any], Path]] = []
    try:
        with zipfile.ZipFile(archive) as source:
            members = [
                member
                for member in source.infolist()
                if not member.is_dir() and member.filename.lower().endswith(".dcm")
            ]
            for index, member in enumerate(members):
                raw = source.read(member)
                try:
                    metadata = services.parse_metadata(raw)
                except Exception:
                    continue
                target = sample_root / f"slice-{index:05d}.dcm"
                target.write_bytes(raw)
                parsed.append((metadata, target.resolve()))
    except (zipfile.BadZipFile, OSError, RuntimeError):
        shutil.rmtree(sample_root, ignore_errors=True)
        return
    if not parsed or len({item[0]["study_uid"] for item in parsed}) != 1:
        shutil.rmtree(sample_root, ignore_errors=True)
        return
    services.insert_study(
        study_uid=parsed[0][0]["study_uid"],
        display_name="Example Knee Study",
        source="sample",
        files=parsed,
        study_id="sample-knee",
    )

