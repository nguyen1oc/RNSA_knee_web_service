"""Immutable model input/output contract for the selected fold-0 checkpoint."""

from dataclasses import dataclass

TARGETS = (
    "ACL",
    "MCL",
    "Medial Meniscus",
    "Lateral Meniscus",
    "Medial OA",
    "Lateral OA",
    "PF OA",
    "Effusion",
    "Synovitis",
    "Baker's",
    "Contusion",
    "Fracture",
)


@dataclass(frozen=True)
class Slot:
    name: str
    plane: str
    fat_suppression: bool


SLOTS = (
    Slot("SAG_FS", "Sagittal", True),
    Slot("SAG_NOFS", "Sagittal", False),
    Slot("COR_FS", "Coronal", True),
    Slot("AX_FS", "Axial", True),
)

IMAGE_SIZE = 224
CROP_MM = 130.0
SLICES_PER_SLOT = 16
STACK_START = 0.10
STACK_END = 0.90
POOLING = "gated_attention"
INPUT_MODE = "2d"
SCORE_SEMANTICS = "sigmoid model score; not calibrated probability"
