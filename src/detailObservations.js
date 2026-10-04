const MAX_WRIST_DISTANCE = 0.26;
const CLOSED_EYE_SCORE = 0.65;
const OPEN_MOUTH_SCORE = 0.5;
const PROLONGED_CLOSURE_MS = 8_000;

export function assignHandSides(hands = [], poseImageLandmarks = []) {
  const wrists = [
    { side: "left", point: poseImageLandmarks?.[15] },
    { side: "right", point: poseImageLandmarks?.[16] },
  ].filter(({ point }) => Number.isFinite(point?.x) && Number.isFinite(point?.y) && (point.visibility ?? 1) >= 0.4);
  const candidates = [];
  hands.forEach((hand, handIndex) => {
    const point = hand.landmarks?.[0];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    for (const { side, point: wrist } of wrists) {
      const distance = Math.hypot(point.x - wrist.x, point.y - wrist.y);
      if (distance <= MAX_WRIST_DISTANCE) candidates.push({ handIndex, side, distance });
    }
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const usedHands = new Set(), usedSides = new Set(), assigned = hands.map((hand) => ({ ...hand, side: null }));
  for (const candidate of candidates) {
    if (usedHands.has(candidate.handIndex) || usedSides.has(candidate.side)) continue;
    assigned[candidate.handIndex].side = candidate.side;
    usedHands.add(candidate.handIndex);
    usedSides.add(candidate.side);
  }
  return assigned;
}

export class FaceActivityObserver {
  constructor() {
    this.reset();
  }

  reset() {
    this.closedSince = null;
    this.cueIssued = false;
    this.lastTimestamp = null;
  }

  update(face, timestamp) {
    const scores = face?.blendshapes;
    if (!face || !Number.isFinite(timestamp) || !Number.isFinite(scores?.eyeBlinkLeft)
      || !Number.isFinite(scores?.eyeBlinkRight)) {
      this.reset();
      return { visible: false, eyeState: "Not resolved", mouthState: "Not resolved", closureSeconds: 0, prolongedClosure: false, newCue: false };
    }
    if (this.lastTimestamp !== null && (timestamp <= this.lastTimestamp || timestamp - this.lastTimestamp > 2_000)) this.reset();
    this.lastTimestamp = timestamp;
    const closed = scores.eyeBlinkLeft >= CLOSED_EYE_SCORE && scores.eyeBlinkRight >= CLOSED_EYE_SCORE;
    if (!closed) {
      this.closedSince = null;
      this.cueIssued = false;
    }
    else if (this.closedSince === null) this.closedSince = timestamp;
    const closureSeconds = closed ? Math.max(0, (timestamp - this.closedSince) / 1000) : 0;
    const prolongedClosure = closureSeconds * 1000 >= PROLONGED_CLOSURE_MS;
    const newCue = prolongedClosure && !this.cueIssued;
    if (newCue) this.cueIssued = true;
    return {
      visible: true,
      eyeState: closed ? "Eyes closed" : "Eyes open / partial",
      mouthState: Number.isFinite(scores.jawOpen)
        ? scores.jawOpen >= OPEN_MOUTH_SCORE ? "Mouth opening" : "No prominent opening"
        : "Not resolved",
      closureSeconds,
      prolongedClosure,
      newCue,
    };
  }
}
