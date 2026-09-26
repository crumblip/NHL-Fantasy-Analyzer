export type UnitType = "F" | "D" | "PP" | "PK";

export interface Unit {
  players: number[];
  /** Mean pairwise shared seconds: roughly how long the group was out together. */
  sharedSeconds: number;
}

/** Symmetric lookup of shared seconds between two players. */
export type PairSeconds = (a: number, b: number) => number;

export function pairLookup(rows: { player_a: number; player_b: number; secs: number }[]): PairSeconds {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = r.player_a < r.player_b ? `${r.player_a}|${r.player_b}` : `${r.player_b}|${r.player_a}`;
    m.set(k, (m.get(k) ?? 0) + r.secs);
  }
  return (a, b) => m.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
}

function* combinations(items: number[], k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

/**
 * Greedy grouping: take the group with the most pairwise shared time, remove its players,
 * repeat. Candidates are capped to the top `maxCandidates` by ice time to bound the search.
 */
export function detectUnits(
  candidates: { id: number; secs: number }[],
  size: number,
  count: number,
  pair: PairSeconds,
  minSharedSeconds: number,
  maxCandidates = 16
): Unit[] {
  let pool = candidates
    .filter((c) => c.secs > 0)
    .sort((a, b) => b.secs - a.secs)
    .slice(0, maxCandidates)
    .map((c) => c.id);
  const pairsPerGroup = (size * (size - 1)) / 2;
  const units: Unit[] = [];

  while (units.length < count && pool.length >= size) {
    let best: number[] | null = null;
    let bestScore = -1;
    for (const combo of combinations(pool, size)) {
      let score = 0;
      for (let i = 0; i < combo.length; i++) {
        for (let j = i + 1; j < combo.length; j++) score += pair(combo[i], combo[j]);
      }
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    if (!best) break;
    const mean = bestScore / pairsPerGroup;
    if (mean < minSharedSeconds) break;
    units.push({ players: best, sharedSeconds: Math.round(mean) });
    const taken = new Set(best);
    pool = pool.filter((p) => !taken.has(p));
  }
  return units;
}

/** Forward lines and D pairs are ranked by the members' total 5v5 TOI (SPEC 5.3). */
export function rankByToi(units: Unit[], toi: (id: number) => number): Unit[] {
  const total = (u: Unit) => u.players.reduce((s, p) => s + toi(p), 0);
  return [...units].sort((a, b) => total(b) - total(a));
}
