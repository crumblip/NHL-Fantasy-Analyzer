import { loadModelConfig } from "../lib/config";
import { getDb } from "../lib/db";
import { detectUnits, pairLookup, rankByToi, type Unit } from "../lib/deploy/units";
import { playerNames } from "../lib/names";

const USAGE = `Usage: npm run lines -- <TEAM> [--game <gameId>] [--last <N>]
  Prints forward lines, D pairs, PP and PK units for the team's most recent game (default),
  a specific game, or aggregated over its last N games.`;

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const team = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!team) {
  console.error(USAGE);
  process.exit(1);
}

const db = getDb();
const model = loadModelConfig();
const t = db
  .prepare(
    `SELECT tg.team_id FROM team_game tg JOIN games g ON g.id = tg.game_id
     WHERE (g.home_team_id = tg.team_id AND g.home_abbrev = ?) OR (g.away_team_id = tg.team_id AND g.away_abbrev = ?)
     ORDER BY tg.game_date DESC LIMIT 1`
  )
  .get(team.toUpperCase(), team.toUpperCase()) as { team_id: number } | undefined;
if (!t) {
  console.error(`No derived games for ${team}.`);
  process.exit(1);
}
const teamId = t.team_id;

const gameArg = opt("--game");
const last = Number(opt("--last") ?? 1);
const games = (
  gameArg
    ? [{ game_id: Number(gameArg) }]
    : db
        .prepare(
          `SELECT game_id FROM team_game
           WHERE team_id = ? AND season = (SELECT MAX(season) FROM team_game WHERE team_id = ?)
           ORDER BY game_date DESC, game_id DESC LIMIT ?`
        )
        .all(teamId, teamId, last)
) as { game_id: number }[];
const gameIds = games.map((g) => g.game_id);
const marks = gameIds.map(() => "?").join(",");
const name = playerNames(db, gameIds);

const header = db
  .prepare(
    `SELECT g.id, g.game_date, g.away_abbrev, g.home_abbrev, g.away_score, g.home_score, g.last_period_type
     FROM games g WHERE g.id IN (${marks}) ORDER BY g.game_date`
  )
  .all(...gameIds) as any[];
const secs = db
  .prepare(
    `SELECT SUM(secs_5v5) v5, SUM(secs_pp) pp, SUM(secs_pk) pk FROM team_game WHERE team_id = ? AND game_id IN (${marks})`
  )
  .get(teamId, ...gameIds) as { v5: number; pp: number; pk: number };
const toi = new Map(
  (
    db
      .prepare(
        `SELECT player_id, SUM(toi_5v5) v5, SUM(toi_pp) pp, SUM(toi_sh) sh FROM player_game
         WHERE team_id = ? AND is_goalie = 0 AND game_id IN (${marks}) GROUP BY player_id`
      )
      .all(teamId, ...gameIds) as { player_id: number; v5: number; pp: number; sh: number }[]
  ).map((r) => [r.player_id, r])
);

const mins = (s: number) => `${(s / 60).toFixed(1)} min`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "-");

let units: Record<string, Unit[]>;
if (gameIds.length === 1) {
  units = { F: [], D: [], PP: [], PK: [] };
  for (const r of db
    .prepare("SELECT unit_type, rank, player_ids, shared_seconds FROM line_assignments WHERE game_id = ? AND team_id = ? ORDER BY unit_type, rank")
    .all(gameIds[0], teamId) as any[]) {
    units[r.unit_type].push({ players: JSON.parse(r.player_ids), sharedSeconds: r.shared_seconds });
  }
} else {
  const pairs = db
    .prepare(
      `SELECT player_a, player_b, strength_state, SUM(shared_seconds) secs FROM pair_overlap
       WHERE team_id = ? AND game_id IN (${marks}) GROUP BY 1, 2, 3`
    )
    .all(teamId, ...gameIds) as { player_a: number; player_b: number; strength_state: string; secs: number }[];
  const look = (state: string) => pairLookup(pairs.filter((p) => p.strength_state === state));
  const pos = new Map(
    (
      db
        .prepare(`SELECT player_id, position_code FROM game_rosters WHERE team_id = ? AND game_id IN (${marks})`)
        .all(teamId, ...gameIds) as { player_id: number; position_code: string }[]
    ).map((r) => [r.player_id, r.position_code])
  );
  const skaters = [...toi.values()];
  const byToi = (id: number) => toi.get(id)?.v5 ?? 0;
  const min = model.deployment.min_unit_seconds;
  units = {
    F: rankByToi(
      detectUnits(skaters.filter((s) => ["C", "L", "R"].includes(pos.get(s.player_id) ?? "")).map((s) => ({ id: s.player_id, secs: s.v5 })), 3, 4, look("5v5"), min.forward_line),
      byToi
    ),
    D: rankByToi(
      detectUnits(skaters.filter((s) => pos.get(s.player_id) === "D").map((s) => ({ id: s.player_id, secs: s.v5 })), 2, 3, look("5v5"), min.d_pair),
      byToi
    ),
    PP: detectUnits(skaters.map((s) => ({ id: s.player_id, secs: s.pp })), 5, 2, look("PP"), min.pp_unit),
    PK: detectUnits(skaters.map((s) => ({ id: s.player_id, secs: s.sh })), 4, 2, look("PK"), min.pk_unit),
  };
}

const oneC = db
  .prepare(`SELECT team_1c FROM player_deployment WHERE team_id = ? AND game_id = ? LIMIT 1`)
  .get(teamId, gameIds[0]) as { team_1c: number | null } | undefined;

console.log(
  gameIds.length === 1
    ? `\n${team.toUpperCase()}: ${header[0].away_abbrev} ${header[0].away_score} @ ${header[0].home_abbrev} ${header[0].home_score}${header[0].last_period_type !== "REG" ? ` (${header[0].last_period_type})` : ""}, ${header[0].game_date} (game ${gameIds[0]})`
    : `\n${team.toUpperCase()}: last ${gameIds.length} games, ${header[0].game_date} → ${header[header.length - 1].game_date}`
);
console.log(`Team time: 5v5 ${mins(secs.v5)}, PP ${mins(secs.pp)}, PK ${mins(secs.pk)}. 1C going in: ${name(oneC?.team_1c ?? null)}`);

const labels: Record<string, string> = { F: "Forward lines (5v5)", D: "D pairs (5v5)", PP: "Power-play units", PK: "Penalty-kill units" };
const prefix: Record<string, string> = { F: "L", D: "D", PP: "PP", PK: "PK" };
const denom: Record<string, number> = { F: secs.v5, D: secs.v5, PP: secs.pp, PK: secs.pk };
const indiv: Record<string, (id: number) => number> = {
  F: (id) => toi.get(id)?.v5 ?? 0,
  D: (id) => toi.get(id)?.v5 ?? 0,
  PP: (id) => toi.get(id)?.pp ?? 0,
  PK: (id) => toi.get(id)?.sh ?? 0,
};
for (const type of ["F", "D", "PP", "PK"]) {
  console.log(`\n${labels[type]}`);
  if (!units[type].length) console.log("  (none detected)");
  units[type].forEach((u, i) => {
    const members = u.players.map((p) => `${name(p)} (${pct(indiv[type](p), denom[type])})`).join(", ");
    console.log(`  ${prefix[type]}${i + 1}  together ~${mins(u.sharedSeconds)} (${pct(u.sharedSeconds, denom[type])} of team ${type === "PP" ? "PP" : type === "PK" ? "PK" : "5v5"})  ${members}`);
  });
}
console.log("\n(%) after a name = that player's share of the team's time in that state.");
