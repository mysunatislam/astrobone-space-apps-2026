from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch.utils.data import DataLoader
from tqdm import tqdm

from ml.astrobone_ml.data import ClassificationCsvDataset, SegmentationCsvDataset
from ml.astrobone_ml.models import build_densenet121_classifier, build_unetpp
from ml.astrobone_ml.train_utils import get_device


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the exact checkpoints served by AstroBone.")
    parser.add_argument("--classification-csv", type=Path, required=True)
    parser.add_argument("--segmentation-csv", type=Path, required=True)
    parser.add_argument("--classifier", type=Path, required=True)
    parser.add_argument("--segmenter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-samples", type=int, default=1000)
    parser.add_argument("--prefer-cuda", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    device = get_device(args.prefer_cuda)
    classifier_result = evaluate_classifier(
        args.classifier,
        args.classification_csv,
        device,
        args.bootstrap_samples,
    )
    segmenter_result = evaluate_segmenter(
        args.segmenter,
        args.segmentation_csv,
        device,
        args.bootstrap_samples,
    )

    payload = {
        "schemaVersion": "astrobone-served-model-evaluation-v1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "device": str(device),
        "classifier": classifier_result,
        "segmenter": segmenter_result,
        "evaluationBoundary": (
            "Internal held-out FracAtlas evaluation. No external, prospective, astronaut-specific, "
            "or clinical validation has been completed. Confidence intervals quantify split sampling "
            "uncertainty only."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))


def evaluate_classifier(
    checkpoint_path: Path,
    csv_path: Path,
    device: torch.device,
    bootstrap_samples: int,
) -> dict:
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_densenet121_classifier(num_classes=2, pretrained=False)
    model.load_state_dict(checkpoint["model"])
    model.to(device).eval()
    dataset = ClassificationCsvDataset(csv_path, image_size=224, train=False)
    loader = DataLoader(dataset, batch_size=32, shuffle=False, num_workers=0)

    targets: list[int] = []
    probabilities: list[float] = []
    with torch.inference_mode():
        for images, batch_targets in tqdm(loader, desc="served classifier"):
            logits = model(images.to(device, non_blocking=True))
            probabilities.extend(torch.softmax(logits, dim=1)[:, 1].cpu().tolist())
            targets.extend(batch_targets.tolist())

    y_true = np.asarray(targets, dtype=np.int64)
    y_score = np.asarray(probabilities, dtype=np.float64)
    y_pred = (y_score >= 0.5).astype(np.int64)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    specificity = tn / max(1, tn + fp)
    metrics = {
        "rocAuc": float(roc_auc_score(y_true, y_score)),
        "averagePrecision": float(average_precision_score(y_true, y_score)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recallSensitivity": float(recall_score(y_true, y_pred, zero_division=0)),
        "specificity": float(specificity),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "brierScore": float(brier_score_loss(y_true, y_score)),
        "expectedCalibrationError10Bin": expected_calibration_error(y_true, y_score, 10),
    }
    return {
        "architecture": "DenseNet121",
        "checkpointEpoch": checkpoint.get("epoch"),
        "checkpointSha256": sha256(checkpoint_path),
        "splitSha256": sha256(csv_path),
        "testImages": int(len(y_true)),
        "fractureImages": int(y_true.sum()),
        "threshold": 0.5,
        "confusionMatrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "metrics": rounded(metrics),
        "bootstrap95Ci": {
            "rocAuc": bootstrap_ci(y_true, y_score, roc_auc_score, bootstrap_samples),
            "recallSensitivity": bootstrap_ci(
                y_true,
                y_pred,
                lambda truth, pred: recall_score(truth, pred, zero_division=0),
                bootstrap_samples,
            ),
            "specificity": bootstrap_ci(
                y_true,
                y_pred,
                specificity_metric,
                bootstrap_samples,
            ),
        },
    }


def evaluate_segmenter(
    checkpoint_path: Path,
    csv_path: Path,
    device: torch.device,
    bootstrap_samples: int,
) -> dict:
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    config = checkpoint.get("config", {})
    model = build_unetpp(
        encoder_name=config.get("encoder_name", "densenet121"),
        encoder_weights=None,
        classes=1,
    )
    model.load_state_dict(checkpoint["model"])
    model.to(device).eval()
    dataset = SegmentationCsvDataset(csv_path, image_size=256, train=False)
    loader = DataLoader(dataset, batch_size=8, shuffle=False, num_workers=0)

    dice_values: list[float] = []
    iou_values: list[float] = []
    with torch.inference_mode():
        for images, masks in tqdm(loader, desc="served segmenter"):
            predictions = (torch.sigmoid(model(images.to(device))) >= 0.5).cpu().float()
            masks = masks.float()
            intersection = (predictions * masks).sum(dim=(1, 2, 3))
            prediction_sum = predictions.sum(dim=(1, 2, 3))
            mask_sum = masks.sum(dim=(1, 2, 3))
            union = prediction_sum + mask_sum - intersection
            dice_values.extend(((2 * intersection + 1e-7) / (prediction_sum + mask_sum + 1e-7)).tolist())
            iou_values.extend(((intersection + 1e-7) / (union + 1e-7)).tolist())

    dice = np.asarray(dice_values, dtype=np.float64)
    iou = np.asarray(iou_values, dtype=np.float64)
    return {
        "architecture": "U-Net++ with DenseNet121 encoder",
        "checkpointEpoch": checkpoint.get("epoch"),
        "checkpointSha256": sha256(checkpoint_path),
        "splitSha256": sha256(csv_path),
        "testImages": int(len(dice)),
        "threshold": 0.5,
        "metrics": {
            "meanDice": round(float(dice.mean()), 6),
            "medianDice": round(float(np.median(dice)), 6),
            "meanIou": round(float(iou.mean()), 6),
            "medianIou": round(float(np.median(iou)), 6),
        },
        "bootstrap95Ci": {
            "meanDice": bootstrap_mean_ci(dice, bootstrap_samples),
            "meanIou": bootstrap_mean_ci(iou, bootstrap_samples),
        },
    }


def expected_calibration_error(y_true: np.ndarray, y_score: np.ndarray, bins: int) -> float:
    boundaries = np.linspace(0, 1, bins + 1)
    total = len(y_true)
    error = 0.0
    for index in range(bins):
        upper_inclusive = index == bins - 1
        selected = (y_score >= boundaries[index]) & (
            y_score <= boundaries[index + 1] if upper_inclusive else y_score < boundaries[index + 1]
        )
        if not selected.any():
            continue
        error += selected.mean() * abs(y_true[selected].mean() - y_score[selected].mean())
    return float(error if total else 0)


def specificity_metric(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    tn, fp, _, _ = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    return float(tn / max(1, tn + fp))


def bootstrap_ci(y_true, values, metric, samples: int) -> list[float]:
    rng = np.random.default_rng(42)
    estimates = []
    for _ in range(samples):
        indices = rng.integers(0, len(y_true), len(y_true))
        if len(np.unique(y_true[indices])) < 2:
            continue
        estimates.append(metric(y_true[indices], values[indices]))
    return percentile_ci(estimates)


def bootstrap_mean_ci(values: np.ndarray, samples: int) -> list[float]:
    rng = np.random.default_rng(42)
    estimates = [float(values[rng.integers(0, len(values), len(values))].mean()) for _ in range(samples)]
    return percentile_ci(estimates)


def percentile_ci(values) -> list[float]:
    lower, upper = np.percentile(np.asarray(values, dtype=np.float64), [2.5, 97.5])
    return [round(float(lower), 6), round(float(upper), 6)]


def rounded(values: dict[str, float]) -> dict[str, float]:
    return {key: round(value, 6) for key, value in values.items()}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
