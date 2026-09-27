import fs from "fs";
import path from "path";
import { parse } from "yaml";

export type Position = "C" | "LW" | "RW" | "D" | "UTIL" | "G" | "BN";

export interface LeagueConfig {
  league: {
    teams: number;
    roster: Record<Position, number>;
  };
  scoring: {
    skater: Record<"G" | "A" | "PIM" | "PPP" | "SHP" | "HAT" | "SOG" | "HIT" | "BLK" | "DEF", number>;
    goalie: Record<"W" | "GA" | "SV" | "SO" | "OTL", number>;
  };
}

export type OpportunityInput =
  | "pp_toi_share"
  | "pp1_rate"
  | "ev_toi_share"
  | "with_1c_share"
  | "top_line_rate"
  | "linemate_quality";

export interface ModelConfig {
  deployment: {
    context_games: number;
    min_unit_seconds: Record<"forward_line" | "d_pair" | "pp_unit" | "pk_unit", number>;
    offense_proxy_prior_minutes: number;
  };
  promotion: { threshold: number; min_games: number; of_last: number; min_period_seconds: number };
  opportunity_delta: {
    recent_games: number;
    prior_games: number;
    min_prior_games: number;
    weights: Record<OpportunityInput, number>;
    pickup_threshold: number;
    downgrade_threshold: number;
    reason_min_z: number;
  };
  talent: {
    season_weights: number[];
    prior_minutes: {
      ixg: Record<"ev" | "pp" | "sh", number>;
      on_ice_gf: Record<"ev" | "pp" | "sh", number>;
      shots: Record<"ev" | "pp" | "sh", number>;
      peripherals: number;
    };
    finishing_prior_xg: number;
    ipp_prior_goals: { a1: number; a2: number };
    offense_mix: { ev: number; pp: number };
  };
  projection: {
    toi_recent_games: number;
    toi_recent_weight: number;
    availability_prior: number;
    availability_prior_games: number;
    opponent_prior_games: number;
    simulations: number;
    min_nhl_games: number;
  };
  goalie: {
    team_season_weights: number[];
    team_prior_games: number;
    team_finishing_prior_xg: number;
    quality_prior_shots: number;
    start_share_recent_weight: number;
    start_share_recent_games: number;
    unknown_goalie_share: number;
    ot_win_share: number;
    min_nhl_games: number;
    simulations: number;
  };
  grades: {
    letters: [number, string][];
    opportunity_weights: Record<string, number>;
    trend_threshold: number;
    mismatch: { high: number; low: number };
  };
}

const CONFIG_DIR = path.join(process.cwd(), "config");

export function loadLeagueConfig(): LeagueConfig {
  return parse(fs.readFileSync(path.join(CONFIG_DIR, "league.yaml"), "utf8")) as LeagueConfig;
}

export function loadModelConfig(): ModelConfig {
  return parse(fs.readFileSync(path.join(CONFIG_DIR, "model.yaml"), "utf8")) as ModelConfig;
}
