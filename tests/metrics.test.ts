import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeInputs,
  inputDeltas,
  opportunityDelta,
  windowMetrics,
  type DeployRow,
} from "../lib/deploy/metrics";

const row = (r: Partial<DeployRow>): DeployRow => ({
  toi_5v5: 600, toi_pp: 0, toi_pk: 0, team_5v5: 2400, team_pp: 240, team_pk: 240,
  f_line: 3, d_pair: null, pp_unit: null, with_1c: 0,
  fo_oz: 0, fo_nz: 0, fo_dz: 0, lmq_num: 0, lmq_den: 0, ...r,
});

test("window shares are ratios of sums, not means of ratios", () => {
  const m = windowMetrics([
    row({ toi_pp: 240, team_pp: 240 }), // 100% of a 4-minute PP game
    row({ toi_pp: 0, team_pp: 720 }), //   0% of a 12-minute PP game
  ]);
  assert.equal(m.pp_toi_share, 0.25);
  assert.equal(m.ev_toi_share, 0.25);
});

test("rates count games; with_1c ignores games where it doesn't apply", () => {
  const m = windowMetrics([
    row({ pp_unit: 1, f_line: 1, with_1c: 300 }),
    row({ pp_unit: 2, f_line: 2, with_1c: null }),
  ]);
  assert.equal(m.pp1_rate, 0.5);
  assert.equal(m.top_line_rate, 0.5);
  assert.equal(m.with_1c_share, 0.5); // 300 of 600 in the one game it applies to
});

test("PP share with no team PP time is unknown, not zero", () => {
  assert.equal(windowMetrics([row({ team_pp: 0 })]).pp_toi_share, null);
});

test("opportunity delta weights z-scores and the alert text names what moved", () => {
  const prior = windowMetrics([row({ toi_pp: 29, team_pp: 240, pp_unit: 2 })]);
  const recent = windowMetrics([row({ toi_pp: 98, team_pp: 240, pp_unit: 1 })]);
  const inputs = inputDeltas(recent, prior);
  const weights = { pp_toi_share: 3, pp1_rate: 1.5, ev_toi_share: 2, with_1c_share: 1, top_line_rate: 1.5, linemate_quality: 1 };
  const od = opportunityDelta(inputs, { pp_toi_share: 0.1, pp1_rate: 0.5, ev_toi_share: 0.05, with_1c_share: 0.1, top_line_rate: 0.3 }, weights);
  assert.ok(od! > 1);
  assert.equal(describeInputs(inputs, weights, 1, 1, "Auston Matthews"), "PP share 12% → 41%, moved to PP1");
});
