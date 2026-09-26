import { getDb } from "../lib/db";
import { listSeasons } from "../lib/ingest";

const GAMES_PER_TEAM = 82;

async function main() {
  const db = getDb();
  const seasons = (await listSeasons()).slice(-4);
  const current = seasons[seasons.length - 1];
  let failed = false;
  const fail = (msg: string) => {
    failed = true;
    console.log(`  FAIL ${msg}`);
  };

  console.log("== Games vs schedule");
  for (const s of seasons) {
    const teams = (db.prepare("SELECT COUNT(*) n FROM team_seasons WHERE season = ?").get(s.id) as any).n;
    const g = db
      .prepare(
        `SELECT COUNT(*) total,
           SUM(g.game_state = 'OFF') off,
           SUM(g.game_state = 'OFF' AND i.pbp_events > 0 AND i.boxscore_players > 0 AND i.error IS NULL) ingested,
           SUM(g.game_state = 'OFF' AND COALESCE(i.shift_rows, 0) = 0) no_shifts,
           SUM(g.game_state = 'OFF' AND i.shift_players_missing > 0) partial_shifts,
           SUM(g.game_state = 'OFF' AND COALESCE(i.toi_rows, 0) = 0) no_toi
         FROM games g LEFT JOIN game_ingest i ON i.game_id = g.id
         WHERE g.season = ? AND g.game_type = 2`
      )
      .get(s.id) as Record<string, number>;
    console.log(
      `  ${s.id}: ${teams} teams, ${g.total} scheduled, ${g.off ?? 0} final, ${g.ingested ?? 0} ingested` +
        ` | shifts missing ${g.no_shifts ?? 0}, partial ${g.partial_shifts ?? 0} | official TOI missing ${g.no_toi ?? 0}`
    );

    if (s.complete) {
      const expected = (teams * GAMES_PER_TEAM) / 2;
      if (g.total !== expected) fail(`${s.id}: ${g.total} games scheduled, expected ${expected}`);
      const perTeam = db
        .prepare(
          `SELECT abbrev, COUNT(*) n FROM (
             SELECT home_abbrev abbrev FROM games WHERE season = ? AND game_type = 2
             UNION ALL SELECT away_abbrev FROM games WHERE season = ? AND game_type = 2)
           GROUP BY abbrev HAVING n != ${GAMES_PER_TEAM}`
        )
        .all(s.id, s.id) as { abbrev: string; n: number }[];
      for (const t of perTeam) fail(`${s.id}: ${t.abbrev} has ${t.n} games`);
    }
    if ((g.ingested ?? 0) !== (g.off ?? 0)) fail(`${s.id}: ${g.off - g.ingested} final games not ingested`);
  }

  const problems = db
    .prepare(
      `SELECT g.id, g.game_date, g.away_abbrev || '@' || g.home_abbrev matchup, i.shift_rows, i.shift_players_missing, i.error
       FROM games g JOIN game_ingest i ON i.game_id = g.id
       WHERE g.game_state = 'OFF' AND (i.error IS NOT NULL OR COALESCE(i.shift_rows, 0) = 0 OR i.shift_players_missing > 0)
       ORDER BY g.id`
    )
    .all() as any[];
  if (problems.length) {
    console.log(`\n== Games with missing or incomplete data (${problems.length})`);
    for (const p of problems.slice(0, 40)) {
      console.log(
        `  ${p.id} ${p.game_date} ${p.matchup}: shifts=${p.shift_rows ?? "-"} players_without_shifts=${p.shift_players_missing ?? "-"}${p.error ? ` error=${p.error}` : ""}`
      );
    }
  }

  console.log(`\n== Active players (${current.id} rosters)`);
  const active = db
    .prepare(
      `SELECT COUNT(DISTINCT r.player_id) total,
         COUNT(DISTINCT CASE WHEN p.id IS NULL THEN r.player_id END) no_landing,
         COUNT(DISTINCT CASE WHEN p.id IS NOT NULL AND COALESCE(p.headshot_url, '') = '' THEN r.player_id END) no_headshot
       FROM roster_entries r LEFT JOIN players p ON p.id = r.player_id WHERE r.season = ?`
    )
    .get(current.id) as Record<string, number>;
  console.log(`  ${active.total} rostered, ${active.no_landing} without landing page, ${active.no_headshot} without headshot`);
  if (active.total === 0) fail("no current-season rosters ingested");
  if (active.no_landing || active.no_headshot) fail("some active players have no stored headshot URL");

  const totals = db.prepare("SELECT COUNT(*) players, (SELECT COUNT(*) FROM player_season_totals) rows, (SELECT COUNT(DISTINCT league) FROM player_season_totals) leagues FROM players").get() as any;
  console.log(`  ${totals.players} players stored, ${totals.rows} season-total rows across ${totals.leagues} leagues`);

  console.log(failed ? "\nPhase 1 acceptance: FAIL" : "\nPhase 1 acceptance: PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
