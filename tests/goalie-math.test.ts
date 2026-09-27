import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLeagueConfig } from "../lib/config";
import { scoreMatrix, simulateStart, startOutcome } from "../lib/models/goalie-math";

const { scoring } = loadLeagueConfig();
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test("score matrix sums to 1 and has the requested tie rate", () => {
  const m = scoreMatrix(3.1, 2.9, 0.22);
  let total = 0;
  let tie = 0;
  m.forEach((row, i) => row.forEach((p, j) => ((total += p), i === j && (tie += p))));
  close(total, 1);
  close(tie, 0.22);
});

test("evenly matched teams: 50% wins, OT losses are half the ties", () => {
  const o = startOutcome(3, 3, 30, 0.22, 0.5, scoring);
  close(o.pWin, 0.5, 1e-9);
  close(o.pOtl, 0.11);
  close(o.pWin + o.pOtl + o.pLoss, 1);
});

test("a better team and a lower goals-against both raise the win and shutout odds", () => {
  const base = startOutcome(3, 3, 30, 0.22, 0.5, scoring);
  const strong = startOutcome(3.5, 2.5, 30, 0.22, 0.5, scoring);
  assert.ok(strong.pWin > base.pWin);
  assert.ok(strong.pShutout > base.pShutout);
});

test("fantasy points per start follow the league formula in expectation", () => {
  const o = startOutcome(3, 2.5, 30, 0.22, 0.5, scoring);
  const expected = o.pWin * 3.25 + o.pOtl * 0.5 + (30 - 2.5) * 0.15 - 2.5 * 0.5 + o.pShutout * 4;
  close(o.fantasyPoints, Math.round(expected * 10000) / 10000, 1e-4);
});

test("simulated range brackets the expectation and is reproducible", () => {
  const o = startOutcome(3, 2.7, 29, 0.22, 0.5, scoring);
  const r = simulateStart(3, 2.7, 29, 0.22, 0.5, scoring, 4000, 11);
  assert.deepEqual(r, simulateStart(3, 2.7, 29, 0.22, 0.5, scoring, 4000, 11));
  assert.ok(r.floor < o.fantasyPoints && o.fantasyPoints < r.ceiling, `${r.floor} ${o.fantasyPoints} ${r.ceiling}`);
});
