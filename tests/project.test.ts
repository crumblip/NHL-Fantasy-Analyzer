import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLeagueConfig } from "../lib/config";
import {
  expectedPoints,
  letterGrade,
  percentiles,
  poissonAtLeast,
  simulateRange,
  type Lambdas,
} from "../lib/models/project";

const { scoring } = loadLeagueConfig();
const l = (x: Partial<Lambdas>): Lambdas => ({ g: 0, a: 0, ppp: 0, shp: 0, sog: 0, hit: 0, blk: 0, pim: 0, ...x });

test("P(G >= 3) from a Poisson", () => {
  const lambda = 0.5;
  const exact = 1 - Math.exp(-lambda) * (1 + lambda + (lambda * lambda) / 2);
  assert.ok(Math.abs(poissonAtLeast(3, lambda) - exact) < 1e-12);
  assert.equal(poissonAtLeast(0, 1), 1);
});

test("expected points apply the same rules as the scoring tests, in expectation", () => {
  // A defenseman expected to score 0.1 goals, all on the PP: 0.1 × (3 + 0.75 + 0.5) + tiny HAT.
  const ev = expectedPoints(l({ g: 0.1, ppp: 0.1 }), true, scoring);
  assert.ok(Math.abs(ev - (0.425 + poissonAtLeast(3, 0.1) * 2)) < 1e-12);
  // Peripherals: 3 shots, 2 hits, 1 block = 1.8.
  assert.ok(Math.abs(expectedPoints(l({ sog: 3, hit: 2, blk: 1 }), false, scoring) - 1.8) < 1e-12);
});

test("simulated floor <= expectation <= ceiling for a typical skater, and is reproducible", () => {
  const lam = l({ g: 0.35, a: 0.5, ppp: 0.3, sog: 3.2, hit: 1.1, blk: 0.6, pim: 0.4 });
  const r1 = simulateRange(lam, false, scoring, 4000, 7);
  const r2 = simulateRange(lam, false, scoring, 4000, 7);
  assert.deepEqual(r1, r2);
  const mean = expectedPoints(lam, false, scoring);
  assert.ok(r1.floor < mean && mean < r1.ceiling, `${r1.floor} ${mean} ${r1.ceiling}`);
});

test("percentiles and letters", () => {
  assert.deepEqual(percentiles([10, 20, 30]), [0, 50, 100]);
  assert.deepEqual(percentiles([5, 5]), [50, 50]);
  const letters: [number, string][] = [[90, "A"], [50, "C"], [0, "F"]];
  assert.equal(letterGrade(95, letters), "A");
  assert.equal(letterGrade(50, letters), "C");
  assert.equal(letterGrade(10, letters), "F");
});
