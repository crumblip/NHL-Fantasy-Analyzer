import { test } from "node:test";
import assert from "node:assert/strict";
import { detectUnits, pairLookup, rankByToi } from "../lib/deploy/units";

// Two clean trios (1-2-3 and 4-5-6) plus a spare forward (7) who floats between them.
const pairs = pairLookup([
  { player_a: 1, player_b: 2, secs: 600 },
  { player_a: 1, player_b: 3, secs: 580 },
  { player_a: 2, player_b: 3, secs: 590 },
  { player_a: 4, player_b: 5, secs: 500 },
  { player_a: 4, player_b: 6, secs: 480 },
  { player_a: 5, player_b: 6, secs: 470 },
  { player_a: 7, player_b: 1, secs: 100 },
  { player_a: 7, player_b: 4, secs: 120 },
]);
const toi = new Map([[1, 800], [2, 790], [3, 780], [4, 900], [5, 880], [6, 870], [7, 300]]);
const candidates = [...toi].map(([id, secs]) => ({ id, secs }));

test("greedy grouping finds the two trios", () => {
  const units = detectUnits(candidates, 3, 4, pairs, 60);
  assert.deepEqual(units.map((u) => u.players.sort()), [[1, 2, 3], [4, 5, 6]]);
  assert.equal(units[0].sharedSeconds, 590);
});

test("lines are ranked by total 5v5 TOI, not by how tight the trio is", () => {
  const ranked = rankByToi(detectUnits(candidates, 3, 4, pairs, 60), (id) => toi.get(id) ?? 0);
  assert.deepEqual(ranked[0].players.sort(), [4, 5, 6]);
});

test("groups below the minimum shared time are dropped", () => {
  const units = detectUnits(candidates, 3, 4, pairs, 500);
  assert.equal(units.length, 1);
});

test("pair lookup is symmetric and sums repeated rows (periods)", () => {
  const p = pairLookup([
    { player_a: 1, player_b: 2, secs: 10 },
    { player_a: 2, player_b: 1, secs: 5 },
  ]);
  assert.equal(p(1, 2), 15);
  assert.equal(p(2, 1), 15);
  assert.equal(p(1, 3), 0);
});
