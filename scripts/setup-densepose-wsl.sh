#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--system" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends build-essential python3-venv python3-dev git curl ca-certificates
  exit 0
fi
RUNTIME="${ASTROBONE_DENSEPOSE_RUNTIME:-$HOME/.local/share/astrobone-densepose}"
REVISION=fc3b7a1e658db27cdb52ee94ef5dcec7cc7eb1e7
mkdir -p "$RUNTIME/models"
python3 -m venv "$RUNTIME/venv"
PY="$RUNTIME/venv/bin/python"
"$PY" -m pip install --upgrade pip wheel 'setuptools<81'
"$PY" -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121
"$PY" -m pip install 'numpy<2' 'opencv-python-headless<4.12' fastapi uvicorn scipy pytest httpx av
if [[ ! -d "$RUNTIME/detectron2/.git" ]]; then
  git clone --filter=blob:none https://github.com/facebookresearch/detectron2.git "$RUNTIME/detectron2"
fi
git -C "$RUNTIME/detectron2" checkout "$REVISION"
MAX_JOBS=2 "$PY" -m pip install --no-build-isolation "$RUNTIME/detectron2"
"$PY" -m pip install --no-build-isolation --no-deps "$RUNTIME/detectron2/projects/DensePose"
MODEL="$RUNTIME/models/densepose_r50_fpn.pkl"
if [[ ! -s "$MODEL" ]]; then
  curl --fail --location --retry 3 --output "$MODEL.partial" https://dl.fbaipublicfiles.com/densepose/densepose_rcnn_R_50_FPN_s1x/165712039/model_final_162be9.pkl
  mv "$MODEL.partial" "$MODEL"
fi
printf '%s  %s\n' b8a7382001b16e453bad95ca9dbc68ae8f2b839b304cf90eaf5c27fbdb4dae91 "$MODEL" | sha256sum --check
"$PY" -c 'import torch, torchvision, detectron2, densepose; print("DensePose dependencies ready; GPU:", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")'
printf '\nDensePose runtime: %s\n' "$RUNTIME"
