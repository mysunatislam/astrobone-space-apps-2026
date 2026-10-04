import test from "node:test";
import assert from "node:assert/strict";
import { isAnatomySurface, anatomyDisplayName } from "./anatomyMetadata.js";

test("atlas excludes annotation and muscle-attachment markers, not real left/right structures", () => {
  for (const name of ["Tibia.j", "Tibia.i", "Femur.g", "Soleus muscle.o1r", "Gracilis muscle.er", "Patellar ligament.ol"]) assert.equal(isAnatomySurface(name, 800), false);
  for (const name of ["Tibia.r", "Femur.l", "Soleus muscle.l", "Hyoid bone"]) assert.equal(isAnatomySurface(name, 800), true);
  assert.equal(isAnatomySurface("Marker", 2), false);
  assert.equal(anatomyDisplayName("Rectus_femoris_muscle.l"), "Rectus femoris muscle (left)");
});
