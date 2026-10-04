import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindHumanRig, canonicalRigName, HUMAN_RIG_NAMES } from "./humanRig.js";

test("provided human GLB contains the named rig and all finger chains", () => {
  const file = readFileSync(new URL("../public/models/human_body_clothed.glb", import.meta.url));
  assert.equal(file.toString("ascii", 0, 4), "glTF");
  const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
  const names = new Set(json.nodes.map((node) => canonicalRigName(node.name)));
  assert.ok(json.skins.some((skin) => skin.joints.length >= 100));
  for (const name of Object.values(HUMAN_RIG_NAMES)) {
    assert.ok(names.has(canonicalRigName(name)), `missing bone ${name}`);
  }
  for (const side of ["L", "R"]) {
    for (let finger = 1; finger <= 5; finger++) {
      for (let segment = 1; segment <= 3; segment++) {
        const name = `finger${finger}-${segment}.${side}`;
        assert.ok(names.has(canonicalRigName(name)), `missing ${name}`);
      }
    }
  }
});

test("rig binding tolerates GLTFLoader's name sanitization", () => {
  const objects = Object.values(HUMAN_RIG_NAMES).map((name) => ({
    isBone: true,
    name: name.replaceAll(".", ""),
  }));
  const rig = bindHumanRig({ traverse: (visit) => objects.forEach(visit) });
  assert.equal(rig.bones.leftArm.name, "upperarm01L");
  assert.equal(rig.bones.jaw.name, "jaw");
});
