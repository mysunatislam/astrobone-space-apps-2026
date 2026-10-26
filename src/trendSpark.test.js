import test from "node:test";
import assert from "node:assert/strict";
import { sparklineSvg, SPARK } from "./trendSpark.js";

test("a trend needs at least two values", () => {
  assert.equal(sparklineSvg({ series: [], value: 160 }), "");
  assert.equal(sparklineSvg({ series: [NaN], value: 160 }), "");
});

test("the trend plots history then today, with the usual range and the starting level", () => {
  const svg = sparklineSvg({ series: [165, 165, 163, 160, 157], value: 151, band: [157, 167], start: 162, changed: true, label: "Knee <trend>" });
  assert.equal((svg.match(/[ML]\d/g) || []).length, 6);
  assert.match(svg, /sc-spark-band/);
  assert.match(svg, /sc-spark-start/);
  assert.match(svg, /sc-spark-changed/);
  assert.match(svg, /aria-label="Knee &lt;trend&gt;"/);
  const cy = Number(svg.match(/<circle[^>]*cy="([\d.]+)"/)[1]);
  assert.equal(cy, SPARK.height - SPARK.pad, "the lowest value sits at the bottom");
});

test("a flat series still draws inside the box", () => {
  const svg = sparklineSvg({ series: [3, 3], value: 3 });
  for (const v of svg.match(/(?:cy|y1)="([-\d.]+)"/g) || []) { const n = Number(v.split('"')[1]); assert.ok(n >= 0 && n <= SPARK.height); }
});
