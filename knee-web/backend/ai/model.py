"""ResNet-34 and masked gated-attention head matching the selected checkpoint."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from torchvision.models import resnet34

from backend.ai.contract import IMAGE_SIZE, POOLING, SLICES_PER_SLOT, SLOTS, TARGETS


class MaskedGatedAttentionSlotHead(nn.Module):
    """Target-specific gated attention across valid slices and available slots."""

    def __init__(self, feature_dim: int, slot_count: int, target_count: int, hidden: int = 256, dropout: float = 0.2):
        super().__init__()
        self.value = nn.Sequential(nn.LayerNorm(feature_dim), nn.Linear(feature_dim, hidden), nn.Tanh())
        self.gate = nn.Sequential(nn.LayerNorm(feature_dim), nn.Linear(feature_dim, hidden), nn.Sigmoid())
        self.slice_score = nn.Linear(hidden, target_count)
        self.slice_to_hidden = nn.Sequential(nn.LayerNorm(feature_dim), nn.Linear(feature_dim, hidden), nn.GELU())
        self.slot_value = nn.Sequential(nn.LayerNorm(hidden), nn.Linear(hidden, hidden), nn.Tanh())
        self.slot_gate = nn.Sequential(nn.LayerNorm(hidden), nn.Linear(hidden, hidden), nn.Sigmoid())
        self.slot_query = nn.Parameter(torch.randn(target_count, hidden) * 0.02)
        self.slot_emb = nn.Parameter(torch.randn(slot_count, hidden) * 0.02)
        self.out_weight = nn.Parameter(torch.randn(target_count, hidden) * 0.02)
        self.out_bias = nn.Parameter(torch.zeros(target_count))
        self.drop = nn.Dropout(dropout)
        self.hidden = hidden

    @staticmethod
    def _masked_softmax(logits: torch.Tensor, mask: torch.Tensor, dim: int) -> torch.Tensor:
        mask = mask.to(logits.dtype)
        attention = torch.softmax(logits.masked_fill(mask < 0.5, -1e4), dim=dim) * mask
        return attention / attention.sum(dim=dim, keepdim=True).clamp_min(1e-6)

    def forward(
        self, features: torch.Tensor, slot_mask: torch.Tensor, slice_mask: torch.Tensor
    ) -> torch.Tensor:
        valid = slice_mask.to(features.dtype)
        gated = self.value(features) * self.gate(features)
        slice_logits = self.slice_score(gated).permute(0, 1, 3, 2)
        slice_attention = self._masked_softmax(slice_logits, valid.unsqueeze(2), dim=-1)
        pooled = torch.einsum("bstk,bskd->bstd", slice_attention, features)
        hidden = self.slice_to_hidden(pooled) + self.slot_emb.view(1, -1, 1, self.hidden)
        slot_gated = self.slot_value(hidden) * self.slot_gate(hidden)
        slot_logits = torch.einsum("bsth,th->bts", slot_gated, self.slot_query)
        slot_attention = self._masked_softmax(slot_logits, slot_mask.unsqueeze(1), dim=-1)
        study = torch.einsum("bts,bsth->bth", slot_attention, hidden)
        study = self.drop(study)
        return (study * self.out_weight.view(1, *self.out_weight.shape)).sum(-1) + self.out_bias


class KneeStudyModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        backbone = resnet34(weights=None)
        feature_dim = backbone.fc.in_features
        backbone.fc = nn.Identity()
        self.backbone = backbone
        self.head = MaskedGatedAttentionSlotHead(feature_dim, len(SLOTS), len(TARGETS))
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(
        self, images: torch.Tensor, slot_mask: torch.Tensor, slice_mask: torch.Tensor
    ) -> torch.Tensor:
        batch, slot_count, slice_count, channels, height, width = images.shape
        valid = (slice_mask > 0.5) & (slot_mask.unsqueeze(-1) > 0.5)
        flat_images = images.reshape(-1, channels, height, width)[valid.reshape(-1)].float() / 255
        if not len(flat_images):
            raise ValueError("All input slots are missing")
        normalized = ((flat_images - self.mean) / self.std).contiguous(memory_format=torch.channels_last)
        if self.training:
            encoded = self.backbone(normalized).flatten(1)
        else:
            encoded = torch.cat([self.backbone(chunk).flatten(1) for chunk in normalized.split(32)])
        features = encoded.new_zeros((batch * slot_count * slice_count, encoded.shape[-1]))
        features[valid.reshape(-1)] = encoded
        return self.head(features.reshape(batch, slot_count, slice_count, -1), slot_mask, valid)


def checkpoint_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as checkpoint_file:
        for block in iter(lambda: checkpoint_file.read(8 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_checkpoint(path: Path, device: torch.device) -> tuple[KneeStudyModel, dict[str, Any], str]:
    """Safely load checkpoint tensors and reject incompatible model configs."""
    try:
        from torch.torch_version import TorchVersion

        torch.serialization.add_safe_globals([TorchVersion])
    except ImportError:
        pass
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    config = checkpoint.get("config", {})
    expected_slots = {slot.name: SLICES_PER_SLOT for slot in SLOTS}
    required = {
        "IMG": IMAGE_SIZE,
        "CROP_MM": 130.0,
        "SLOT_SLICES": expected_slots,
        "INPUT_MODE": "2d",
        "POOLING": POOLING,
        "FINETUNE": "full",
        "WEIGHT_MODE": "direct",
    }
    mismatch = {key: (config.get(key), value) for key, value in required.items() if config.get(key) != value}
    if mismatch:
        raise ValueError(f"Checkpoint config does not match the local runner contract: {mismatch}")
    model = KneeStudyModel()
    model.load_state_dict(checkpoint["model_state"], strict=True)
    model.to(device).eval()
    return model, checkpoint, checkpoint_sha256(path)
