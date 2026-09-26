import type Database from "better-sqlite3";
import { loadLeagueConfig } from "../config";
import { getDb } from "../db";
import { endpoints } from "../nhl/endpoints";
import { readCached } from "../nhl/http";
import type { Boxscore, PlayByPlay, ShiftRow, SkaterToiRow, StatsResponse } from "../nhl/types";
import { deriveGame } from "./game";

const DERIVED_TABLES = [
  "shifts",
  "events",
  "strength_timeline",
  "player_game",
  "pair_overlap",
  "player_period",
  "team_game",
] as const;

function inserter(db: Database.Database, table: string, sample: Record<string, unknown>) {
  const cols = Object.keys(sample);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`
  );
  return (rows: Record<string, unknown>[]) => rows.forEach((r) => stmt.run(r));
}

export interface BuildOptions {
  rebuild?: boolean;
  seasons?: number[];
  limit?: number;
}

export function buildDerived(opts: BuildOptions = {}) {
  const db = getDb();
  const { scoring } = loadLeagueConfig();

  const where = [
    "g.game_type = 2",
    "g.game_state = 'OFF'",
    "i.pbp_events > 0",
    "i.boxscore_players > 0",
    "i.shift_rows > 0",
  ];
  if (opts.seasons?.length) where.push(`g.season IN (${opts.seasons.join(",")})`);
  if (!opts.rebuild) where.push("NOT EXISTS (SELECT 1 FROM player_game pg WHERE pg.game_id = g.id)");
  const games = db
    .prepare(
      `SELECT g.id, g.season, g.game_date FROM games g JOIN game_ingest i ON i.game_id = g.id
       WHERE ${where.join(" AND ")} ORDER BY g.id`
    )
    .all()
    .slice(0, opts.limit) as { id: number; season: number; game_date: string }[];

  const positions = new Map(
    (
      db
        .prepare(
          `SELECT p.id, COALESCE(o.position, p.position) AS position FROM players p
           LEFT JOIN position_override o ON o.player_id = p.id
           UNION SELECT player_id, position FROM position_override`
        )
        .all() as { id: number; position: string | null }[]
    )
      .filter((r) => r.position)
      .map((r) => [r.id, r.position as string])
  );

  const deletes = DERIVED_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE game_id = ?`));
  const inserters = new Map<string, ReturnType<typeof inserter>>();
  const insert = (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    if (!inserters.has(table)) inserters.set(table, inserter(db, table, rows[0]));
    inserters.get(table)!(rows);
  };
  const toiByDate = new Map<string, SkaterToiRow[]>();
  let built = 0;
  let skipped = 0;
  const started = Date.now();

  for (const game of games) {
    const pbp = readCached<PlayByPlay>(endpoints.playByPlay(game.id));
    const box = readCached<Boxscore>(endpoints.boxscore(game.id));
    const shifts = readCached<StatsResponse<ShiftRow>>(endpoints.shiftCharts(game.id));
    if (!pbp || !box || !shifts) {
      skipped++;
      continue;
    }
    if (!toiByDate.has(game.game_date)) {
      toiByDate.clear(); // games are in date order, so only the current date is needed
      toiByDate.set(
        game.game_date,
        readCached<StatsResponse<SkaterToiRow>>(endpoints.skaterToiByDate(game.game_date))?.data ?? []
      );
    }
    const officialToi = toiByDate.get(game.game_date)!.filter((r) => r.gameId === game.id);

    const out = deriveGame({ game, pbp, box, shifts: shifts.data, officialToi, positions, scoring });
    db.transaction(() => {
      deletes.forEach((d) => d.run(game.id));
      const sets: [string, Record<string, unknown>[]][] = [
        ["shifts", out.shifts],
        ["events", out.events],
        ["strength_timeline", out.timeline],
        ["player_game", out.playerGame],
        ["pair_overlap", out.pairs],
        ["player_period", out.playerPeriods],
        ["team_game", out.teamGames],
      ];
      for (const [table, rows] of sets) insert(table, rows);
    })();

    built++;
    if (built % 250 === 0) {
      const rate = built / ((Date.now() - started) / 1000);
      console.log(`  built ${built}/${games.length} (${rate.toFixed(1)} games/s)`);
    }
  }
  return { built, skipped, total: games.length };
}
