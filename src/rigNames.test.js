import test from "node:test";
import assert from "node:assert/strict";
import { PropertyBinding } from "three";
import { matchesRigBoneName } from "./rigNames.js";

test("Mixamo spine names bind before and after Three.js GLTF sanitization", () => {
  for (const bone of ["Spine", "Spine1", "Spine2", "Neck", "Head"]) {
    const original = `mixamorig:${bone}_02`;
    const pattern = new RegExp(`(?:^|:)${bone}(?:_|$)`, "i");
    assert.equal(matchesRigBoneName(original, pattern), true);
    assert.equal(matchesRigBoneName(PropertyBinding.sanitizeNodeName(original), pattern), true);
  }
});

test("bone matching does not confuse spine levels or left and right limbs", () => {
  assert.equal(matchesRigBoneName("mixamorigSpine1_03", /(?:^|:)Spine(?:_|$)/i), false);
  assert.equal(matchesRigBoneName("mixamorigRightArm_09", /LeftArm(?:_|$)/i), false);
  assert.equal(matchesRigBoneName("LeftArm", /LeftArm(?:_|$)/i), true);
});
