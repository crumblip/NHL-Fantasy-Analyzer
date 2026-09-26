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

const CONFIG_DIR = path.join(process.cwd(), "config");

export function loadLeagueConfig(): LeagueConfig {
  return parse(fs.readFileSync(path.join(CONFIG_DIR, "league.yaml"), "utf8")) as LeagueConfig;
}
