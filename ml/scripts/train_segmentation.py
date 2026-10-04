from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import segmentation_models_pytorch as smp
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

from ml.astrobone_ml.config import ensure_dir, load_config
from ml.astrobone_ml.data import SegmentationCsvDataset
from ml.astrobone_ml.metrics import segmentation_scores
from ml.astrobone_ml.models import build_unetpp
from ml.astrobone_ml.train_utils import count_parameters, get_device, save_json, seed_everything


def main() -> None:
    parser = argparse.ArgumentParser(description="Train U-Net++ fracture segmenter.")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()

    cfg = load_config(args.config)
    seed_everything(int(cfg.get("seed", 42)))
    device = get_device(bool(cfg.get("prefer_cuda", True)))
    run_dir = ensure_dir(cfg["run_dir"])

    train_ds = SegmentationCsvDataset(cfg["train_csv"], cfg["image_size"], train=True)
    val_ds = SegmentationCsvDataset(cfg["val_csv"], cfg["image_size"], train=False)
    test_ds = SegmentationCsvDataset(cfg["test_csv"], cfg["image_size"], train=False)

    train_loader = DataLoader(
        train_ds,
        batch_size=cfg["batch_size"],
        shuffle=True,
        num_workers=cfg.get("num_workers", 0),
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(val_ds, batch_size=cfg["batch_size"], shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=cfg["batch_size"], shuffle=False, num_workers=0)

    model = build_unetpp(
        encoder_name=cfg.get("encoder_name", "densenet121"),
        encoder_weights=cfg.get("encoder_weights", "imagenet"),
        classes=1,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=cfg.get("weight_decay", 1e-4))
    bce = nn.BCEWithLogitsLoss()
    dice_loss = smp.losses.DiceLoss(mode="binary", from_logits=True)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda" and bool(cfg.get("amp", True)))

    best_val_dice = -1.0
    history = []
    print(f"Device: {device}")
    print(f"Train/val/test: {len(train_ds)}/{len(val_ds)}/{len(test_ds)}")
    print(f"Trainable parameters: {count_parameters(model):,}")

    for epoch in range(1, int(cfg["epochs"]) + 1):
        start = time.time()
        train_loss = train_epoch(model, train_loader, bce, dice_loss, optimizer, scaler, device)
        val_loss, val_scores = evaluate(model, val_loader, bce, dice_loss, device)
        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "val_dice": val_scores["dice"],
            "val_iou": val_scores["iou"],
            "seconds": round(time.time() - start, 2),
        }
        history.append(row)
        print(row)
        if val_scores["dice"] > best_val_dice:
            best_val_dice = val_scores["dice"]
            torch.save({"model": model.state_dict(), "config": cfg, "epoch": epoch}, run_dir / "best_segmenter.pt")

    best_checkpoint = torch.load(run_dir / "best_segmenter.pt", map_location=device, weights_only=False)
    model.load_state_dict(best_checkpoint["model"])
    test_loss, test_scores = evaluate(model, test_loader, bce, dice_loss, device)
    metrics = {
        "best_val_dice": best_val_dice,
        "tested_checkpoint_epoch": best_checkpoint.get("epoch"),
        "test_loss": test_loss,
        "test_dice": test_scores["dice"],
        "test_iou": test_scores["iou"],
        "history": history,
    }
    save_json(run_dir / "metrics.json", metrics)
    pd.DataFrame(history).to_csv(run_dir / "history.csv", index=False)
    print(f"Saved segmenter run to {run_dir}")


def combined_loss(logits, targets, bce, dice_loss) -> torch.Tensor:
    return 0.5 * bce(logits, targets) + 0.5 * dice_loss(logits, targets)


def train_epoch(model, loader, bce, dice_loss, optimizer, scaler, device) -> float:
    model.train()
    total_loss = 0.0
    for images, masks in tqdm(loader, desc="train", leave=False):
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            logits = model(images)
            loss = combined_loss(logits, masks, bce, dice_loss)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        total_loss += float(loss.detach().cpu()) * images.size(0)
    return total_loss / len(loader.dataset)


@torch.no_grad()
def evaluate(model, loader, bce, dice_loss, device) -> tuple[float, dict[str, float]]:
    model.eval()
    total_loss = 0.0
    dice_values = []
    iou_values = []
    for images, masks in tqdm(loader, desc="eval", leave=False):
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)
        logits = model(images)
        loss = combined_loss(logits, masks, bce, dice_loss)
        scores = segmentation_scores(logits, masks)
        total_loss += float(loss.detach().cpu()) * images.size(0)
        dice_values.append(scores["dice"])
        iou_values.append(scores["iou"])
    return total_loss / len(loader.dataset), {
        "dice": float(sum(dice_values) / max(1, len(dice_values))),
        "iou": float(sum(iou_values) / max(1, len(iou_values))),
    }


if __name__ == "__main__":
    main()
