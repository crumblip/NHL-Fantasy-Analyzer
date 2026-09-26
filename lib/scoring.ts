import type { LeagueConfig } from "./config";

export interface SkaterLine {
  g: number;
  a: number;
  pim: number;
  ppp: number;
  shp: number;
  sog: number;
  hit: number;
  blk: number;
}

export interface GoalieLine {
  w: number;
  otl: number;
  sv: number;
  ga: number;
  so: number;
}

type Scoring = LeagueConfig["scoring"];

/** PPP, SHP and DEF are bonuses on top of G/A, never replacements. HAT is per game with 3+ goals. */
export function skaterPoints(s: SkaterLine, isDefense: boolean, scoring: Scoring): number {
  const k = scoring.skater;
  const points = s.g + s.a;
  return round(
    s.g * k.G +
      s.a * k.A +
      s.pim * k.PIM +
      s.ppp * k.PPP +
      s.shp * k.SHP +
      (s.g >= 3 ? k.HAT : 0) +
      s.sog * k.SOG +
      s.hit * k.HIT +
      s.blk * k.BLK +
      (isDefense ? points * k.DEF : 0)
  );
}

export function goaliePoints(s: GoalieLine, scoring: Scoring): number {
  const k = scoring.goalie;
  return round(s.w * k.W + s.otl * k.OTL + s.sv * k.SV + s.ga * k.GA + s.so * k.SO);
}

// Scoring values like 0.15 and 0.45 accumulate float noise; 4 decimals is plenty.
function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
