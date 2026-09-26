import type { OpportunityInput } from "../config";

export interface DeployRow {
  toi_5v5: number;
  toi_pp: number;
  toi_pk: number;
  team_5v5: number;
  team_pp: number;
  team_pk: number;
  f_line: number | null;
  d_pair: number | null;
  pp_unit: number | null;
  with_1c: number | null;
  fo_oz: number;
  fo_nz: number;
  fo_dz: number;
  lmq_num: number;
  lmq_den: number;
}

export interface Metrics {
  games: number;
  ev_toi_share: number | null;
  pp_toi_share: number | null;
  pk_toi_share: number | null;
  pp1_rate: number | null;
  top_line_rate: number | null;
  with_1c_share: number | null;
  linemate_quality: number | null;
  oz_fo_share: number | null;
}

export const INPUTS: OpportunityInput[] = [
  "pp_toi_share",
  "pp1_rate",
  "ev_toi_share",
  "with_1c_share",
  "top_line_rate",
  "linemate_quality",
];

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Shares are ratios of sums over the window, so short games don't count as much as long ones. */
export function windowMetrics(rows: DeployRow[]): Metrics {
  const n = rows.length;
  const fwd1c = rows.filter((r) => r.with_1c !== null);
  return {
    games: n,
    ev_toi_share: ratio(sum(rows, (r) => r.toi_5v5), sum(rows, (r) => r.team_5v5)),
    pp_toi_share: ratio(sum(rows, (r) => r.toi_pp), sum(rows, (r) => r.team_pp)),
    pk_toi_share: ratio(sum(rows, (r) => r.toi_pk), sum(rows, (r) => r.team_pk)),
    pp1_rate: n ? rows.filter((r) => r.pp_unit === 1).length / n : null,
    top_line_rate: n ? rows.filter((r) => r.f_line === 1 || r.d_pair === 1).length / n : null,
    with_1c_share: fwd1c.length
      ? ratio(sum(fwd1c, (r) => r.with_1c ?? 0), sum(fwd1c, (r) => r.toi_5v5))
      : null,
    linemate_quality: ratio(sum(rows, (r) => r.lmq_num), sum(rows, (r) => r.lmq_den)),
    oz_fo_share: ratio(sum(rows, (r) => r.fo_oz), sum(rows, (r) => r.fo_oz + r.fo_nz + r.fo_dz)),
  };
}

export type InputDetail = { prior: number; recent: number; delta: number; z?: number };

export function inputDeltas(recent: Metrics, prior: Metrics): Partial<Record<OpportunityInput, InputDetail>> {
  const out: Partial<Record<OpportunityInput, InputDetail>> = {};
  for (const k of INPUTS) {
    const r = recent[k];
    const p = prior[k];
    if (r === null || p === null) continue;
    out[k] = { prior: p, recent: r, delta: r - p };
  }
  return out;
}

/** Weighted mean of per-input z-scores; the z denominators are league-wide SDs of each delta. */
export function opportunityDelta(
  inputs: Partial<Record<OpportunityInput, InputDetail>>,
  sd: Partial<Record<OpportunityInput, number>>,
  weights: Record<OpportunityInput, number>
): number | null {
  let num = 0;
  let den = 0;
  for (const k of INPUTS) {
    const d = inputs[k];
    const s = sd[k];
    if (!d || !s) continue;
    d.z = d.delta / s;
    num += weights[k] * d.z;
    den += weights[k];
  }
  return den ? num / den : null;
}

export function standardDeviation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** e.g. "PP share 12% → 41%, moved to PP1, 38% of 5v5 TOI with Auston Matthews". */
export function describeInputs(
  inputs: Partial<Record<OpportunityInput, InputDetail>>,
  weights: Record<OpportunityInput, number>,
  direction: 1 | -1,
  minZ: number,
  oneCName: string | null
): string {
  const moved = INPUTS.filter((k) => {
    const z = inputs[k]?.z;
    return z !== undefined && z * direction >= minZ;
  }).sort((a, b) => Math.abs(weights[b] * inputs[b]!.z!) - Math.abs(weights[a] * inputs[a]!.z!));

  const parts = moved.map((k) => {
    const { prior, recent } = inputs[k]!;
    switch (k) {
      case "pp_toi_share":
        return `PP share ${pct(prior)} → ${pct(recent)}`;
      case "pp1_rate":
        if (direction > 0 && recent >= 0.6 && prior < 0.4) return "moved to PP1";
        if (direction < 0 && prior >= 0.6 && recent < 0.4) return "lost PP1";
        return `on PP1 in ${pct(recent)} of games (was ${pct(prior)})`;
      case "ev_toi_share":
        return `5v5 TOI share ${pct(prior)} → ${pct(recent)}`;
      case "with_1c_share":
        return direction > 0
          ? `${pct(recent)} of 5v5 TOI with ${oneCName ?? "the 1C"}`
          : `time with ${oneCName ?? "the 1C"} ${pct(prior)} → ${pct(recent)}`;
      case "top_line_rate":
        if (direction > 0 && recent >= 0.6 && prior < 0.4) return "promoted to the top unit";
        if (direction < 0 && prior >= 0.6 && recent < 0.4) return "demoted from the top unit";
        return `top unit in ${pct(recent)} of games (was ${pct(prior)})`;
      case "linemate_quality":
        return `linemate quality ${prior.toFixed(2)} → ${recent.toFixed(2)} P/60`;
    }
  });
  return parts.join(", ");
}
