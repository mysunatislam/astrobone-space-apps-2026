from __future__ import annotations

import argparse
import time
from pathlib import Path

import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import classification_report, roc_auc_score
from torch.utils.data import DataLoader
from tqdm import tqdm

from ml.astrobone_ml.config import ensure_dir, load_config
from ml.astrobone_ml.data import ClassificationCsvDataset
from ml.astrobone_ml.metrics import classification_accuracy
from ml.astrobone_ml.models import build_densenet121_classifier
from ml.astrobone_ml.train_utils import count_parameters, get_device, save_json, seed_everything


def main() -> None:
    parser = argparse.ArgumentParser(description="Train DenseNet121 fracture classifier.")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()

    cfg = load_config(args.config)
    seed_everything(int(cfg.get("seed", 42)))
    device = get_device(bool(cfg.get("prefer_cuda", True)))

    run_dir = ensure_dir(cfg["run_dir"])
    train_ds = ClassificationCsvDataset(cfg["train_csv"], cfg["image_size"], train=True)
    val_ds = ClassificationCsvDataset(cfg["val_csv"], cfg["image_size"], train=False)
    test_ds = ClassificationCsvDataset(cfg["test_csv"], cfg["image_size"], train=False)

    train_loader = DataLoader(
        train_ds,
        batch_size=cfg["batch_size"],
        shuffle=True,
        num_workers=cfg.get("num_workers", 0),
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(val_ds, batch_size=cfg["batch_size"], shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=cfg["batch_size"], shuffle=False, num_workers=0)

    model = build_densenet121_classifier(num_classes=2, pretrained=bool(cfg.get("pretrained", True))).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=cfg.get("weight_decay", 1e-4))
    criterion = nn.CrossEntropyLoss()
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda" and bool(cfg.get("amp", True)))

    best_val_auc = -1.0
    history = []
    print(f"Device: {device}")
    print(f"Train/val/test: {len(train_ds)}/{len(val_ds)}/{len(test_ds)}")
    print(f"Trainable parameters: {count_parameters(model):,}")

    for epoch in range(1, int(cfg["epochs"]) + 1):
        start = time.time()
        train_loss, train_acc = run_epoch(model, train_loader, criterion, device, optimizer, scaler)
        val_loss, val_acc, val_auc, _, _ = evaluate(model, val_loader, criterion, device)
        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "train_acc": train_acc,
            "val_loss": val_loss,
            "val_acc": val_acc,
            "val_auc": val_auc,
            "seconds": round(time.time() - start, 2),
        }
        history.append(row)
        print(row)
        if val_auc > best_val_auc:
            best_val_auc = val_auc
            torch.save({"model": model.state_dict(), "config": cfg, "epoch": epoch}, run_dir / "best_classifier.pt")

    best_checkpoint = torch.load(run_dir / "best_classifier.pt", map_location=device, weights_only=False)
    model.load_state_dict(best_checkpoint["model"])
    _, _, test_auc, targets, probs = evaluate(model, test_loader, criterion, device)
    preds = [int(prob >= 0.5) for prob in probs]
    report = classification_report(targets, preds, target_names=["non_fracture", "fracture"], output_dict=True, zero_division=0)
    metrics = {
        "best_val_auc": best_val_auc,
        "tested_checkpoint_epoch": best_checkpoint.get("epoch"),
        "test_auc": test_auc,
        "report": report,
        "history": history,
    }
    save_json(run_dir / "metrics.json", metrics)
    pd.DataFrame({"target": targets, "fracture_probability": probs, "prediction": preds}).to_csv(
        run_dir / "test_predictions.csv",
        index=False,
    )
    print(f"Saved classifier run to {run_dir}")


def run_epoch(model, loader, criterion, device, optimizer, scaler) -> tuple[float, float]:
    model.train()
    total_loss = 0.0
    total_acc = 0.0
    for images, targets in tqdm(loader, desc="train", leave=False):
        images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            logits = model(images)
            loss = criterion(logits, targets)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        total_loss += float(loss.detach().cpu()) * images.size(0)
        total_acc += classification_accuracy(logits, targets) * images.size(0)
    n = len(loader.dataset)
    return total_loss / n, total_acc / n


@torch.no_grad()
def evaluate(model, loader, criterion, device) -> tuple[float, float, float, list[int], list[float]]:
    model.eval()
    total_loss = 0.0
    total_acc = 0.0
    targets_all = []
    probs_all = []
    for images, targets in tqdm(loader, desc="eval", leave=False):
        images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)
        logits = model(images)
        loss = criterion(logits, targets)
        probs = torch.softmax(logits, dim=1)[:, 1]
        total_loss += float(loss.detach().cpu()) * images.size(0)
        total_acc += classification_accuracy(logits, targets) * images.size(0)
        targets_all.extend(targets.detach().cpu().tolist())
        probs_all.extend(probs.detach().cpu().tolist())
    auc = safe_auc(targets_all, probs_all)
    n = len(loader.dataset)
    return total_loss / n, total_acc / n, auc, targets_all, probs_all


def safe_auc(targets: list[int], probs: list[float]) -> float:
    if len(set(targets)) < 2:
        return 0.5
    return float(roc_auc_score(targets, probs))


if __name__ == "__main__":
    main()
