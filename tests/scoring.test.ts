import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLeagueConfig } from "../lib/config";
import { goaliePoints, skaterPoints, type SkaterLine } from "../lib/scoring";

const { scoring } = loadLeagueConfig();
const line = (s: Partial<SkaterLine>): SkaterLine => ({
  g: 0, a: 0, pim: 0, ppp: 0, shp: 0, sog: 0, hit: 0, blk: 0, ...s,
});

// Examples straight from SPEC.md section 2. SOG is left at 0 to isolate each rule.
test("defenseman power-play goal = 3 + 0.75 + 0.5 = 4.25", () => {
  assert.equal(skaterPoints(line({ g: 1, ppp: 1 }), true, scoring), 4.25);
});

test("defenseman short-handed assist = 2 + 1.5 + 0.5 = 4.0", () => {
  assert.equal(skaterPoints(line({ a: 1, shp: 1 }), true, scoring), 4.0);
});

test("forward even-strength goal = 3.0", () => {
  assert.equal(skaterPoints(line({ g: 1 }), false, scoring), 3.0);
});

test("DEF bonus only applies to defensemen", () => {
  assert.equal(skaterPoints(line({ g: 1, ppp: 1 }), false, scoring), 3.75);
});

test("3 shots, 2 hits, 1 block = 1.8", () => {
  assert.equal(skaterPoints(line({ sog: 3, hit: 2, blk: 1 }), false, scoring), 1.8);
});

test("hat trick adds +2 once per game", () => {
  assert.equal(skaterPoints(line({ g: 3 }), false, scoring), 11);
  assert.equal(skaterPoints(line({ g: 4 }), false, scoring), 14);
  assert.equal(skaterPoints(line({ g: 2 }), false, scoring), 6);
});

test("PIM are 0.25 per minute", () => {
  assert.equal(skaterPoints(line({ pim: 2 }), false, scoring), 0.5);
});

test("30-save win: 3.25 + 30 x 0.15 - GA x 0.5", () => {
  assert.equal(goaliePoints({ w: 1, otl: 0, sv: 30, ga: 2, so: 0 }, scoring), 6.75);
});

test("shutout win and OT loss", () => {
  assert.equal(goaliePoints({ w: 1, otl: 0, sv: 25, ga: 0, so: 1 }, scoring), 11);
  assert.equal(goaliePoints({ w: 0, otl: 1, sv: 30, ga: 3, so: 0 }, scoring), 3.5);
});
