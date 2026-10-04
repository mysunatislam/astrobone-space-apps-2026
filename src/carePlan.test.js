import test from "node:test";
import assert from "node:assert/strict";
import { calculateCarePlan } from "./carePlan.js";

test("reported condition flags trigger urgent review without imaging", () => {
  const plan = calculateCarePlan({
    mode: "space",
    decisionBand: "low",
    aiLoaded: false,
    painScore: 3,
    mobility: "unable",
  });

  assert.equal(plan.priority.key, "urgent");
  assert.match(plan.summary, /even if imaging is incomplete/i);
});

test("watch-zone evidence and limited function produce assisted review", () => {
  const plan = calculateCarePlan({
    mode: "space",
    decisionBand: "watch",
    aiLoaded: true,
    painScore: 5,
    swelling: "mild",
    mobility: "limited",
  });

  assert.equal(plan.priority.key, "review");
  assert.ok(plan.actions.some((action) => action.id === "monitor"));
  assert.ok(plan.actions.some((action) => action.id === "relay"));
});

test("a high review rule produces urgent review without symptom red flags", () => {
  const plan = calculateCarePlan({
    mode: "space",
    decisionBand: "high",
    aiLoaded: true,
    painScore: 2,
    mobility: "normal",
  });

  assert.equal(plan.priority.key, "urgent");
  assert.equal(plan.redFlags.length, 0);
});

test("care plan explicitly requires an approved protocol", () => {
  const plan = calculateCarePlan({});

  assert.match(plan.protocolNote, /approved musculoskeletal protocol/i);
  assert.match(plan.protocolNote, /not autonomous treatment/i);
});
