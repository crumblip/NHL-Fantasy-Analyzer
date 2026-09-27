import { getDb } from "./db";
import { endpoints } from "./nhl/endpoints";
import { DAY, HOUR, fetchJson, NotFoundError } from "./nhl/http";
import {
  boxscorePlayerCount,
  isSettled,
  parseLanding,
  parseScheduleGame,
  playersMissingShifts,
  rosterPlayers,
} from "./nhl/parse";
import type {
  Boxscore,
  CalendarTeam,
  PlayByPlay,
  PlayerLanding,
  Roster,
  ScheduleGame,
  ShiftRow,
  SkaterToiRow,
  StandingsSeason,
  StatsResponse,
} from "./nhl/types";

const REGULAR = 2;

export interface SeasonInfo {
  id: number;
  start: string;
  end: string;
  /** Regular season is over, so rosters for it are frozen. */
  complete: boolean;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export async function listSeasons(): Promise<SeasonInfo[]> {
  const res = await fetchJson<{ seasons: StandingsSeason[] }>(endpoints.standingsSeasons(), {
    maxAgeMs: DAY,
  });
  return res.seasons
    .map((s) => ({
      id: s.id,
      start: s.standingsStart,
      end: s.standingsEnd,
      complete: addDays(s.standingsEnd, 3) < today(),
    }))
    .sort((a, b) => a.id - b.id);
}

async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function progress(label: string, total: number) {
  const started = Date.now();
  let done = 0;
  const every = Math.max(8, Math.ceil(total / 40));
  return () => {
    done++;
    if (done % every === 0 || done === total) {
      const elapsed = (Date.now() - started) / 1000;
      const eta = done ? Math.round(((total - done) * elapsed) / done / 60) : 0;
      console.log(`  ${label}: ${done}/${total}${done < total ? ` (~${eta} min left)` : ""}`);
    }
  };
}

export async function ingestTeams(season: SeasonInfo): Promise<string[]> {
  const cal = await fetchJson<{ teams: CalendarTeam[] }>(
    endpoints.scheduleCalendar(addDays(season.start, 10)),
    { maxAgeMs: DAY, final: () => season.complete }
  );
  const teams = cal.teams.filter((t) => t.seasonId === season.id);
  if (teams.length === 0) throw new Error(`No teams found for season ${season.id}`);

  const db = getDb();
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, abbrev, name, logo, dark_logo) VALUES (@id, @abbrev, @name, @logo, @dark_logo)
    ON CONFLICT(id) DO UPDATE SET abbrev = excluded.abbrev, name = excluded.name,
      logo = excluded.logo, dark_logo = excluded.dark_logo`);
  const upsertTeamSeason = db.prepare(
    "INSERT OR REPLACE INTO team_seasons (season, team_id, abbrev) VALUES (?, ?, ?)"
  );
  db.transaction(() => {
    for (const t of teams) {
      upsertTeam.run({ id: t.id, abbrev: t.abbrev, name: t.name.default, logo: t.logo, dark_logo: t.darkLogo });
      upsertTeamSeason.run(season.id, t.id, t.abbrev);
    }
  })();
  return teams.map((t) => t.abbrev);
}

export async function ingestSchedule(season: SeasonInfo, teams: string[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO games (id, season, game_type, game_date, start_time_utc, home_team_id, home_abbrev,
      away_team_id, away_abbrev, home_score, away_score, game_state, schedule_state, last_period_type, neutral_site)
    VALUES (@id, @season, @game_type, @game_date, @start_time_utc, @home_team_id, @home_abbrev,
      @away_team_id, @away_abbrev, @home_score, @away_score, @game_state, @schedule_state, @last_period_type, @neutral_site)
    ON CONFLICT(id) DO UPDATE SET game_date = excluded.game_date, start_time_utc = excluded.start_time_utc,
      home_score = excluded.home_score, away_score = excluded.away_score, game_state = excluded.game_state,
      schedule_state = excluded.schedule_state, last_period_type = excluded.last_period_type`);

  const tick = progress(`${season.id} schedules`, teams.length);
  for (const team of teams) {
    const res = await fetchJson<{ games: ScheduleGame[] }>(endpoints.clubScheduleSeason(team, season.id), {
      maxAgeMs: 6 * HOUR,
      final: (j: { games: ScheduleGame[] }) => {
        const reg = j.games.filter((g) => g.gameType === REGULAR);
        return reg.length > 0 && reg.every(isSettled);
      },
    });
    const games = res.games.filter((g) => g.gameType === REGULAR && g.season === season.id);
    db.transaction(() => games.forEach((g) => upsert.run(parseScheduleGame(g))))();
    tick();
  }
}

export async function ingestRosters(season: SeasonInfo, teams: string[]) {
  const db = getDb();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO roster_entries (season, team_abbrev, player_id) VALUES (?, ?, ?)"
  );
  const tick = progress(`${season.id} rosters`, teams.length);
  for (const team of teams) {
    try {
      const roster = await fetchJson<Roster>(endpoints.roster(team, season.id), {
        maxAgeMs: 12 * HOUR,
        final: () => season.complete,
      });
      db.transaction(() => rosterPlayers(roster).forEach((p) => insert.run(season.id, team, p.id)))();
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      console.warn(`  ! no roster for ${team} ${season.id}`);
    }
    tick();
  }
}

export async function ingestGames(seasonIds: number[], limit?: number) {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT g.id FROM games g LEFT JOIN game_ingest i ON i.game_id = g.id
       WHERE g.season IN (${seasonIds.map(() => "?").join(",")}) AND g.game_type = ${REGULAR}
         AND g.game_state = 'OFF'
         AND (i.game_id IS NULL OR i.error IS NOT NULL OR i.pbp_events IS NULL
              OR COALESCE(i.shift_rows, 0) = 0 OR i.shift_players_missing > 0)
       ORDER BY g.id`
    )
    .all(...seasonIds)
    .map((r: any) => r.id as number)
    .slice(0, limit);
  if (pending.length === 0) {
    console.log("  games: nothing new");
    return;
  }

  const insertSpot = db.prepare(`
    INSERT OR REPLACE INTO game_rosters (game_id, player_id, team_id, position_code, sweater_number)
    VALUES (?, ?, ?, ?, ?)`);
  const upsertIngest = db.prepare(`
    INSERT INTO game_ingest (game_id, pbp_events, boxscore_players, shift_rows, shift_players_missing, error, updated_at)
    VALUES (@game_id, @pbp_events, @boxscore_players, @shift_rows, @shift_players_missing, @error, datetime('now'))
    ON CONFLICT(game_id) DO UPDATE SET pbp_events = excluded.pbp_events,
      boxscore_players = excluded.boxscore_players, shift_rows = excluded.shift_rows,
      shift_players_missing = excluded.shift_players_missing, error = excluded.error,
      updated_at = excluded.updated_at`);

  const official = (j: { gameState: string }) => j.gameState === "OFF";
  const tick = progress("games", pending.length);
  await pool(pending, 3, async (gameId) => {
    const [pbp, box, shifts] = await Promise.allSettled([
      fetchJson<PlayByPlay>(endpoints.playByPlay(gameId), { cacheIf: official }),
      fetchJson<Boxscore>(endpoints.boxscore(gameId), { cacheIf: official }),
      fetchJson<StatsResponse<ShiftRow>>(endpoints.shiftCharts(gameId), {
        cacheIf: (j: StatsResponse<ShiftRow>) => j.data.length > 0,
      }),
    ]);
    const errors = [pbp, box, shifts]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason?.message ?? r.reason));

    const p = pbp.status === "fulfilled" ? pbp.value : null;
    const b = box.status === "fulfilled" ? box.value : null;
    const s = shifts.status === "fulfilled" ? shifts.value.data : null;

    db.transaction(() => {
      if (p) {
        for (const r of p.rosterSpots) {
          insertSpot.run(gameId, r.playerId, r.teamId, r.positionCode, r.sweaterNumber);
        }
      }
      upsertIngest.run({
        game_id: gameId,
        pbp_events: p ? p.plays.length : null,
        boxscore_players: b ? boxscorePlayerCount(b) : null,
        shift_rows: s ? s.length : null,
        shift_players_missing: b && s ? playersMissingShifts(b, s).length : null,
        error: errors.length ? errors.join(" | ") : null,
      });
    })();
    tick();
  });
}

/** Official EV/PP/SH TOI per skater per game, the Phase 2 reconciliation target. */
export async function ingestSkaterToi(seasonIds: number[], limit?: number) {
  const db = getDb();
  const dates = db
    .prepare(
      `SELECT g.game_date AS date FROM games g LEFT JOIN game_ingest i ON i.game_id = g.id
       WHERE g.season IN (${seasonIds.map(() => "?").join(",")}) AND g.game_type = ${REGULAR}
       GROUP BY g.game_date
       HAVING SUM(g.game_state = 'OFF' OR g.schedule_state = 'CNCL') = COUNT(*)
          AND SUM(COALESCE(i.toi_rows, 0) = 0 AND g.game_state = 'OFF') > 0
       ORDER BY g.game_date`
    )
    .all(...seasonIds)
    .map((r: any) => r.date as string)
    .slice(0, limit);
  if (dates.length === 0) {
    console.log("  skater TOI: nothing new");
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO game_ingest (game_id, toi_rows, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(game_id) DO UPDATE SET toi_rows = excluded.toi_rows`);
  const tick = progress("skater TOI dates", dates.length);
  for (const date of dates) {
    const res = await fetchJson<StatsResponse<SkaterToiRow>>(endpoints.skaterToiByDate(date), {
      cacheIf: (j: StatsResponse<SkaterToiRow>) => j.total > 0 && j.data.length === j.total,
    });
    if (res.data.length < res.total) {
      console.warn(`  ! TOI for ${date} truncated: ${res.data.length}/${res.total} rows`);
    }
    const perGame = new Map<number, number>();
    for (const r of res.data) perGame.set(r.gameId, (perGame.get(r.gameId) ?? 0) + 1);
    db.transaction(() => perGame.forEach((n, gameId) => upsert.run(gameId, n)))();
    tick();
  }
}

export async function ingestPlayers(seasonIds: number[]) {
  const db = getDb();
  const marks = seasonIds.map(() => "?").join(",");
  const ids = db
    .prepare(
      `SELECT player_id FROM roster_entries WHERE season IN (${marks})
       UNION
       SELECT gr.player_id FROM game_rosters gr JOIN games g ON g.id = gr.game_id WHERE g.season IN (${marks})`
    )
    .all(...seasonIds, ...seasonIds)
    .map((r: any) => r.player_id as number);
  await ingestLandings(ids);
}

/** Landing pages (bio, headshot, draft, all-league season totals) for any list of players. */
export async function ingestLandings(ids: number[], label = "player landings") {
  const db = getDb();
  const upsertPlayer = db.prepare(`
    INSERT INTO players (id, first_name, last_name, full_name, position, shoots, birth_date, birth_city,
      birth_country, height_in, weight_lb, headshot_url, sweater_number, current_team, is_active,
      draft_year, draft_team, draft_round, draft_pick_in_round, draft_overall, landing_fetched_at)
    VALUES (@id, @first_name, @last_name, @full_name, @position, @shoots, @birth_date, @birth_city,
      @birth_country, @height_in, @weight_lb, @headshot_url, @sweater_number, @current_team, @is_active,
      @draft_year, @draft_team, @draft_round, @draft_pick_in_round, @draft_overall, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      full_name = excluded.full_name, position = excluded.position, shoots = excluded.shoots,
      birth_date = excluded.birth_date, birth_city = excluded.birth_city, birth_country = excluded.birth_country,
      height_in = excluded.height_in, weight_lb = excluded.weight_lb, headshot_url = excluded.headshot_url,
      sweater_number = excluded.sweater_number, current_team = excluded.current_team,
      is_active = excluded.is_active, draft_year = excluded.draft_year, draft_team = excluded.draft_team,
      draft_round = excluded.draft_round, draft_pick_in_round = excluded.draft_pick_in_round,
      draft_overall = excluded.draft_overall, landing_fetched_at = excluded.landing_fetched_at`);
  const clearTotals = db.prepare("DELETE FROM player_season_totals WHERE player_id = ?");
  const insertTotal = db.prepare(`
    INSERT OR REPLACE INTO player_season_totals (player_id, season, game_type, league, sequence, team, gp, g, a, pts, pim)
    VALUES (@player_id, @season, @game_type, @league, @sequence, @team, @gp, @g, @a, @pts, @pim)`);

  let missing = 0;
  const tick = progress(label, ids.length);
  await pool(ids, 2, async (id) => {
    try {
      const landing = await fetchJson<PlayerLanding>(endpoints.playerLanding(id), {
        maxAgeMs: 7 * DAY,
        final: (l: PlayerLanding) => !l.isActive,
      });
      const { player, totals } = parseLanding(landing);
      db.transaction(() => {
        upsertPlayer.run(player);
        clearTotals.run(id);
        totals.forEach((t) => insertTotal.run(t));
      })();
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      missing++;
      console.warn(`  ! no landing page for player ${id}`);
    }
    tick();
  });
  if (missing) console.warn(`  ${missing} players had no landing page`);
}

export async function ingestSeasons(seasons: SeasonInfo[], opts: { limitGames?: number; skipPlayers?: boolean } = {}) {
  for (const season of seasons) {
    console.log(`\n== Season ${season.id} (${season.start} → ${season.end})`);
    const teams = await ingestTeams(season);
    console.log(`  ${teams.length} teams`);
    await ingestSchedule(season, teams);
    await ingestRosters(season, teams);
  }

  const ids = seasons.map((s) => s.id);
  console.log("\n== Game data (play-by-play, boxscore, shifts) + official skater TOI");
  // The two run in parallel because they mostly hit different hosts.
  await Promise.all([ingestGames(ids, opts.limitGames), ingestSkaterToi(ids, opts.limitGames)]);

  if (!opts.skipPlayers) {
    console.log("\n== Player landing pages");
    await ingestPlayers(ids);
  }
}
