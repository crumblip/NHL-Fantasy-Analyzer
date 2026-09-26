import { test } from "node:test";
import assert from "node:assert/strict";
import { auc, calibration, fitLogistic, logLoss, predictLogistic } from "../lib/models/logistic";

// Deterministic pseudo-random numbers so the test is stable.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("recovers known coefficients from simulated data", () => {
  const rand = rng(42);
  const n = 20000;
  const X = new Float64Array(n * 2);
  const y = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = rand() * 4 - 2;
    const b = rand() < 0.3 ? 1 : 0;
    X[i * 2] = a;
    X[i * 2 + 1] = b;
    const p = 1 / (1 + Math.exp(-(-1 + 1.5 * a - 0.8 * b)));
    y[i] = rand() < p ? 1 : 0;
  }
  const m = fitLogistic(X, y, ["a", "b"], { l2: 0 });
  // Coefficients are on standardized features; convert back to raw units.
  const rawA = m.coef[0] / m.sd[0];
  const rawB = m.coef[1] / m.sd[1];
  assert.ok(Math.abs(rawA - 1.5) < 0.1, `a=${rawA}`);
  assert.ok(Math.abs(rawB + 0.8) < 0.12, `b=${rawB}`);
  const p0 = predictLogistic(m, [0, 0]);
  assert.ok(Math.abs(p0 - 1 / (1 + Math.exp(1))) < 0.03);
});

test("metrics: perfect ranking has AUC 1, log loss matches the formula", () => {
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.equal(auc([0.5, 0.5], [0, 1]), 0.5);
  assert.ok(Math.abs(logLoss([0.5], [1]) - Math.log(2)) < 1e-12);
  const cal = calibration([0.1, 0.1, 0.9, 0.9], [0, 0, 1, 1], 2);
  assert.deepEqual(cal.map((c) => c.observed), [0, 1]);
});
