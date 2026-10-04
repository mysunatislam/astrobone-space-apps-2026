from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ApiSettings:
    classifier_checkpoint: Path
    segmenter_checkpoint: Path
    allowed_origins: tuple[str, ...]
    prefer_cuda: bool
    maximum_upload_bytes: int = 15 * 1024 * 1024
    maximum_image_pixels: int = 25_000_000

    @classmethod
    def from_environment(cls) -> "ApiSettings":
        return cls(
            classifier_checkpoint=_checkpoint_path(
                "ASTROBONE_CLASSIFIER_CHECKPOINT",
                REPOSITORY_ROOT / "ml" / "runs" / "classifier_densenet121" / "best_classifier.pt",
            ),
            segmenter_checkpoint=_checkpoint_path(
                "ASTROBONE_SEGMENTER_CHECKPOINT",
                REPOSITORY_ROOT
                / "ml"
                / "runs"
                / "segmentation_unetpp_densenet121"
                / "best_segmenter.pt",
            ),
            allowed_origins=_allowed_origins(),
            prefer_cuda=os.getenv("ASTROBONE_PREFER_CUDA", "1") != "0",
        )


def _checkpoint_path(variable: str, fallback: Path) -> Path:
    configured = os.getenv(variable, "").strip()
    return Path(configured).expanduser().resolve() if configured else fallback.resolve()


def _allowed_origins() -> tuple[str, ...]:
    defaults = (
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5173",
        "http://localhost:5174",
        "https://localhost",
        "https://mysunatislam.github.io",
    )
    configured = tuple(
        origin.strip().rstrip("/")
        for origin in os.getenv("ASTROBONE_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    )
    return tuple(dict.fromkeys((*defaults, *configured)))
