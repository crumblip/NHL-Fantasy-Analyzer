import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModelConfig } from "../lib/config";
import { ageAt, fitTranslation, growthToPeak, type SeasonRow } from "../lib/prospects/leagues";

test("age is measured on Sept 15 of the season's first year", () => {
  assert.equal(Math.floor(ageAt("2007-09-15", 20252026)), 18);
  assert.equal(Math.floor(ageAt("2007-09-16", 20252026)), 17);
});

test("the network fit recovers league factors and age growth, including a league only linked via another", () => {
  // Truth: JR = 0.2 × NHL, MINOR = 0.5 × NHL. JR players never jump straight to the NHL,
  // so JR's factor can only come through MINOR. Everyone grows 20% per year from 18 to 21.
  const truth: Record<string, number> = { JR: 0.2, MINOR: 0.5, NHL: 1 };
  const rows: SeasonRow[] = [];
  let id = 0;
  // Varied career paths, as in real data: otherwise league moves and ages are confounded.
  const paths: [string, number][][] = [
    [["JR", 18], ["JR", 19], ["MINOR", 20], ["NHL", 21]],
    [["JR", 18], ["MINOR", 19], ["MINOR", 20], ["NHL", 21]],
    [["JR", 18], ["JR", 19], ["JR", 20], ["MINOR", 21]],
    [["MINOR", 19], ["MINOR", 20], ["NHL", 21], ["NHL", 22]],
  ];
  for (let p = 0; p < 300; p++) {
    id++;
    const talent = 0.4 + (p % 10) * 0.08; // NHL-equivalent PPG at 18
    const path = paths[p % paths.length];
    path.forEach(([league, age], k) => {
      // Weaker leagues inflate scoring: league PPG = NHL-equivalent PPG ÷ factor.
      const ppg = (talent / truth[league]) * Math.pow(1.2, age - 18);
      const gp = 60;
      rows.push({
        playerId: id,
        season: (2010 + k) * 10000 + 2011 + k,
        league,
        gp,
        g: null,
        pts: Math.round(ppg * gp),
        age: age + 0.5,
        group: "F",
      });
    });
  }
  const cfg = { ...loadModelConfig().prospects, min_gp: 20, min_league_obs: 10, bootstrap: 5 };
  const t = fitTranslation(rows, cfg, 99999999);
  assert.ok(Math.abs(t.factors.get("MINOR")!.factor - 0.5) < 0.03, `MINOR ${t.factors.get("MINOR")!.factor}`);
  assert.ok(Math.abs(t.factors.get("JR")!.factor - 0.2) < 0.02, `JR ${t.factors.get("JR")!.factor}`);
  assert.equal(t.factors.get("JR")!.toNhl, 0);
  for (const age of [18, 19, 20]) {
    assert.ok(Math.abs(Math.exp(t.growth.F[age]) - 1.2) < 0.05, `growth ${age}: ${Math.exp(t.growth.F[age])}`);
  }
  // Growth to peak from 18 to 21 is three years at +20%.
  assert.ok(Math.abs(Math.exp(growthToPeak(t, "F", 18.5, 21)) - 1.2 ** 3) < 0.1);
});
