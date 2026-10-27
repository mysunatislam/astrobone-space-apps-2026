#!/bin/bash
# Runs every pose model over every REHAB24-6 job; skips outputs that exist.
P=/home/user/data/pose_out
PY="python -I $(dirname "$0")/run_pose.py"
for m in ${MODELS:-mp-lite mp-full mp-heavy yolo11m movenet-thunder rtmo-m vitpose-b synthpose-b}; do
  while read ex vid cam path n; do
    out=$P/${m}__${ex}_${vid}_${cam}.npz
    [ -f $out ] && continue
    boxes=$P/yolo11m__${ex}_${vid}_${cam}.npz
    ff=$P/frames_${ex}_${vid}.npy; case $m in mp-*) ;; *) ff=$P/fsub_${ex}_${vid}.npy;; esac
    OMP_NUM_THREADS=${THREADS:-2} $PY $m $path $out $ff $boxes 2>&1 | grep -E "ms/frame|Error|error" 
  done < $P/jobs.txt
  echo "MODEL DONE $m $(date +%T)"
done
