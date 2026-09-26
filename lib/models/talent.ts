import type { ModelConfig } from "../config";
import { getDb } from "../db";

export type Strength = "ev" | "pp" | "sh";
const STRENGTHS: Strength[] = ["ev", "pp", "sh"];
const strengthKey = (s: string | null): Strength => (s === "PP" ? "pp" : s === "SH" ? "sh" : "ev");
/** Blocks are credited to the blocker's team, the opposite of the shooter's strength. */
const blockerKey = (s: string | null): Strength => (s === "PP" ? "sh" : s === "SH" ? "pp" : "ev");

export interface Talent {
  playerId: number;
  isD: boolean;
  gp: number;
  /** Per-60 rates by strength (regressed). */
  g60: Record<Strength, number>;
  a160: Record<Strength, number>;
  a260: Record<Strength, number>;
  sog60: Record<Strength, number>;
  icf60: Record<Strength, number>;
  ixg60: Record<Strength, number>;
  finishing: number;
  hit60: number;
  pim60: number;
  blk60NonPk: number;
  blk60Pk: number;
  /** SPEC 6: projected points/60 at a reference EV/PP mix, independent of role. */
  offenseRating: number;
  p60: Record<Strength, number>;
}

type Acc = {
  gp: number;
  toi: number;
  toiBy: Record<Strength, number>;
  hit: number;
  pim: number;
  gfBy: Record<Strength, number>;
  gBy: Record<Strength, number>;
  a1By: Record<Strength, number>;
  a2By: Record<Strength, number>;
  sogBy: Record<Strength, number>;
  icfBy: Record<Strength, number>;
  ixgBy: Record<Strength, number>;
  blkBy: Record<Strength, number>;
  isD: number;
};

const zero = (): Record<Strength, number> => ({ ev: 0, pp: 0, sh: 0 });
const newAcc = (): Acc => ({
  gp: 0, toi: 0, toiBy: zero(), hit: 0, pim: 0, gfBy: zero(), gBy: zero(), a1By: zero(), a2By: zero(),
  sogBy: zero(), icfBy: zero(), ixgBy: zero(), blkBy: zero(), isD: 0,
});

const startYear = (season: number) => Math.floor(season / 10000);

/**
 * Weighted, regressed per-60 talent for every skater, using games on or before `asOf` from the
 * last few seasons (SPEC 6). Weights come from config.talent.season_weights by seasons ago.
 */
export function computeTalent(asOf: string, asOfSeason: number, cfg: ModelConfig): Map<number, Talent> {
  const db = getDb();
  const t = cfg.talent;
  const weights = t.season_weights;
  const minSeason = (startYear(asOfSeason) - (weights.length - 1)) * 10001 + 1; // e.g. 20232024
  const weightOf = (season: number) => weights[startYear(asOfSeason) - startYear(season)] ?? 0;

  const acc = new Map<number, Acc>();
  const get = (id: number) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = newAcc()));
    return a;
  };

  for (const r of db
    .prepare(
      `SELECT player_id, season, COUNT(*) gp, SUM(toi) toi, SUM(toi_ev) toi_ev, SUM(toi_pp) toi_pp, SUM(toi_sh) toi_sh,
         SUM(hit) hit, SUM(pim) pim, SUM(gf_ev) gf_ev, SUM(gf_pp) gf_pp, SUM(gf_sh) gf_sh, MAX(position = 'D') is_d
       FROM player_game WHERE is_goalie = 0 AND game_date <= ? AND season >= ? GROUP BY player_id, season`
    )
    .all(asOf, minSeason) as any[]) {
    const w = weightOf(r.season);
    if (!w) continue;
    const a = get(r.player_id);
    a.gp += r.gp;
    a.toi += w * r.toi;
    a.toiBy.ev += w * r.toi_ev;
    a.toiBy.pp += w * r.toi_pp;
    a.toiBy.sh += w * r.toi_sh;
    a.hit += w * r.hit;
    a.pim += w * r.pim;
    a.gfBy.ev += w * r.gf_ev;
    a.gfBy.pp += w * r.gf_pp;
    a.gfBy.sh += w * r.gf_sh;
    a.isD = Math.max(a.isD, r.is_d);
  }

  const eventRows = (sql: string) =>
    db.prepare(sql).all(asOf, minSeason) as { pid: number; season: number; strength: string | null; n: number; x?: number }[];
  const from = `FROM events e JOIN games g ON g.id = e.game_id WHERE g.game_date <= ? AND g.season >= ?`;

  for (const r of eventRows(
    `SELECT COALESCE(e.shooter_id, e.scorer_id) pid, g.season, e.strength,
       COUNT(*) n, SUM(e.type IN ('goal', 'shot-on-goal')) sog, SUM(e.type = 'goal') goals,
       SUM(CASE WHEN e.type != 'blocked-shot' THEN COALESCE(e.xg, 0) ELSE 0 END) x
     ${from} AND e.type IN ('goal', 'shot-on-goal', 'missed-shot', 'blocked-shot') GROUP BY 1, 2, 3`
  ) as any[]) {
    const w = weightOf(r.season);
    if (!w || !acc.has(r.pid)) continue;
    const a = get(r.pid);
    const k = strengthKey(r.strength);
    a.icfBy[k] += w * r.n;
    a.sogBy[k] += w * r.sog;
    a.gBy[k] += w * r.goals;
    a.ixgBy[k] += w * (r.x ?? 0);
  }
  for (const [col, key] of [
    ["assist1_id", "a1By"],
    ["assist2_id", "a2By"],
  ] as const) {
    for (const r of eventRows(`SELECT e.${col} pid, g.season, e.strength, COUNT(*) n ${from} AND e.type = 'goal' AND e.${col} IS NOT NULL GROUP BY 1, 2, 3`)) {
      const w = weightOf(r.season);
      if (!w || !acc.has(r.pid)) continue;
      get(r.pid)[key][strengthKey(r.strength)] += w * r.n;
    }
  }
  for (const r of eventRows(
    `SELECT e.blocker_id pid, g.season, e.strength, COUNT(*) n ${from}
     AND e.type = 'blocked-shot' AND e.blocker_id IS NOT NULL AND COALESCE(e.block_reason, 'blocked') = 'blocked' GROUP BY 1, 2, 3`
  )) {
    const w = weightOf(r.season);
    if (!w || !acc.has(r.pid)) continue;
    get(r.pid).blkBy[blockerKey(r.strength)] += w * r.n;
  }

  // Position-group priors (weighted league averages).
  const groups = { F: newAcc(), D: newAcc() };
  for (const a of acc.values()) {
    const gr = groups[a.isD ? "D" : "F"];
    gr.toi += a.toi;
    gr.hit += a.hit;
    gr.pim += a.pim;
    for (const s of STRENGTHS) {
      for (const k of ["toiBy", "gfBy", "gBy", "a1By", "a2By", "sogBy", "icfBy", "ixgBy", "blkBy"] as const) gr[k][s] += a[k][s];
    }
  }
  const per60 = (n: number, secs: number) => (secs > 0 ? (n * 3600) / secs : 0);
  const shrink = (n: number, secs: number, priorRate: number, priorMin: number) =>
    (n + (priorRate * priorMin) / 60) / (secs / 3600 + priorMin / 60);
  const sum3 = (r: Record<Strength, number>) => r.ev + r.pp + r.sh;

  const out = new Map<number, Talent>();
  for (const [id, a] of acc) {
    const gr = groups[a.isD ? "D" : "F"];
    const pm = t.prior_minutes;
    const posFinish = sum3(gr.gBy) / Math.max(1e-9, sum3(gr.ixgBy));
    const finishing = (sum3(a.gBy) + t.finishing_prior_xg * posFinish) / (sum3(a.ixgBy) + t.finishing_prior_xg);
    const posIpp1 = sum3(gr.a1By) / Math.max(1e-9, sum3(gr.gfBy));
    const posIpp2 = sum3(gr.a2By) / Math.max(1e-9, sum3(gr.gfBy));
    const ipp1 = (sum3(a.a1By) + t.ipp_prior_goals.a1 * posIpp1) / (sum3(a.gfBy) + t.ipp_prior_goals.a1);
    const ipp2 = (sum3(a.a2By) + t.ipp_prior_goals.a2 * posIpp2) / (sum3(a.gfBy) + t.ipp_prior_goals.a2);

    const rec = (): Record<Strength, number> => zero();
    const g60 = rec(), a160 = rec(), a260 = rec(), sog60 = rec(), icf60 = rec(), ixg60 = rec(), p60 = rec();
    for (const s of STRENGTHS) {
      const secs = a.toiBy[s];
      ixg60[s] = shrink(a.ixgBy[s], secs, per60(gr.ixgBy[s], gr.toiBy[s]), pm.ixg[s]);
      const gf60 = shrink(a.gfBy[s], secs, per60(gr.gfBy[s], gr.toiBy[s]), pm.on_ice_gf[s]);
      g60[s] = ixg60[s] * finishing;
      a160[s] = gf60 * ipp1;
      a260[s] = gf60 * ipp2;
      sog60[s] = shrink(a.sogBy[s], secs, per60(gr.sogBy[s], gr.toiBy[s]), pm.shots[s]);
      icf60[s] = shrink(a.icfBy[s], secs, per60(gr.icfBy[s], gr.toiBy[s]), pm.shots[s]);
      p60[s] = g60[s] + a160[s] + a260[s];
    }
    const nonPkSecs = a.toiBy.ev + a.toiBy.pp;
    out.set(id, {
      playerId: id,
      isD: a.isD === 1,
      gp: a.gp,
      g60, a160, a260, sog60, icf60, ixg60, p60,
      finishing,
      hit60: shrink(a.hit, a.toi, per60(gr.hit, gr.toi), pm.peripherals),
      pim60: shrink(a.pim, a.toi, per60(gr.pim, gr.toi), pm.peripherals),
      blk60NonPk: shrink(a.blkBy.ev + a.blkBy.pp, nonPkSecs, per60(gr.blkBy.ev + gr.blkBy.pp, gr.toiBy.ev + gr.toiBy.pp), pm.peripherals),
      blk60Pk: shrink(a.blkBy.sh, a.toiBy.sh, per60(gr.blkBy.sh, gr.toiBy.sh), pm.peripherals),
      offenseRating: t.offense_mix.ev * p60.ev + t.offense_mix.pp * p60.pp,
    });
  }
  return out;
}
