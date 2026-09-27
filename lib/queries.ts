import "server-only";
import { getDb } from "./db";
import { teamUnits } from "./deploy/team-view";

const db = () => getDb();

function names(): Map<number, string> {
  return new Map(
    (db().prepare("SELECT id, full_name FROM players").all() as { id: number; full_name: string }[]).map((r) => [r.id, r.full_name])
  );
}
const nameOf = (m: Map<number, string>, id: number | null | undefined) => (id ? (m.get(id) ?? `#${id}`) : null);

function latest(table: "model_outputs" | "goalie_outputs" | "prospect_outputs"): string | null {
  return (db().prepare(`SELECT MAX(as_of_date) d FROM ${table}`).get() as { d: string | null }).d;
}

// ---------------------------------------------------------------- rankings

export function getRankings() {
  const asOf = latest("model_outputs");
  if (!asOf) return { asOf: null, rows: [] };
  const rows = db()
    .prepare(
      `SELECT m.player_id id, COALESCE(p.full_name, '#' || m.player_id) name, t.abbrev team, m.position,
         m.proj_fp_gp fpg, m.floor_fp floor, m.ceiling_fp ceiling, m.rest_fp rest, m.games_remaining games_left,
         m.expected_games, m.vor, m.next7_games, m.next7_fp,
         m.proj_g g, m.proj_a a, m.proj_ppp ppp, m.proj_sog sog, m.proj_hit hit, m.proj_blk blk, m.proj_pim pim,
         m.proj_toi_ev toi_ev, m.proj_toi_pp toi_pp, m.proj_toi_sh toi_sh,
         m.fantasy_grade, m.fantasy_pctl, m.offense_grade, m.offense_pctl, m.opportunity_grade, m.opportunity_pctl,
         m.peripheral_grade, m.peripheral_pctl, m.trend, m.opportunity_delta delta, m.mismatch, m.alert, m.alert_text,
         m.promotion_flag promotion, m.new_team, m.offense_rating
       FROM model_outputs m LEFT JOIN players p ON p.id = m.player_id LEFT JOIN teams t ON t.id = m.team_id
       WHERE m.as_of_date = ?`
    )
    .all(asOf) as RankingRow[];
  return { asOf, rows };
}

export interface RankingRow {
  id: number;
  name: string;
  team: string | null;
  position: string;
  fpg: number;
  floor: number;
  ceiling: number;
  rest: number;
  games_left: number;
  expected_games: number;
  vor: number;
  next7_games: number;
  next7_fp: number;
  g: number;
  a: number;
  ppp: number;
  sog: number;
  hit: number;
  blk: number;
  pim: number;
  toi_ev: number;
  toi_pp: number;
  toi_sh: number;
  fantasy_grade: string;
  fantasy_pctl: number;
  offense_grade: string;
  offense_pctl: number;
  opportunity_grade: string | null;
  opportunity_pctl: number | null;
  peripheral_grade: string;
  peripheral_pctl: number;
  trend: string | null;
  delta: number | null;
  mismatch: string | null;
  alert: string | null;
  alert_text: string | null;
  promotion: number;
  new_team: number;
  offense_rating: number;
}

// ---------------------------------------------------------------- alerts

export function getAlerts() {
  const nm = names();
  const date = (db().prepare("SELECT MAX(as_of_date) d FROM opportunity_signal").get() as { d: string | null }).d;
  if (!date) return { asOf: null, pickups: [], downgrades: [], promotions: [] };
  const gradeDate = latest("model_outputs");
  const rows = db()
    .prepare(
      `WITH ranked AS (
         SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.as_of_date DESC, s.game_id DESC) rn
         FROM opportunity_signal s
         WHERE s.season = (SELECT season FROM opportunity_signal ORDER BY as_of_date DESC LIMIT 1))
       SELECT r.player_id, r.as_of_date, r.position, r.opportunity_delta delta, r.alert, r.alert_text,
         r.promotion_flag, r.promotion_games, r.inputs, t.abbrev team, m.fantasy_grade, m.fantasy_pctl
       FROM ranked r LEFT JOIN teams t ON t.id = r.team_id
       LEFT JOIN model_outputs m ON m.player_id = r.player_id AND m.as_of_date = ?
       WHERE r.rn = 1 AND (r.alert IS NOT NULL OR r.promotion_flag = 1)`
    )
    .all(gradeDate) as any[];
  const shaped = rows.map((r) => ({
    id: r.player_id as number,
    name: nameOf(nm, r.player_id)!,
    team: r.team as string | null,
    position: r.position as string,
    date: r.as_of_date as string,
    delta: r.delta as number | null,
    alert: r.alert as string | null,
    text: r.alert_text as string | null,
    promotion: r.promotion_flag === 1,
    promotionGames: r.promotion_games as number,
    grade: r.fantasy_grade as string | null,
    gradePctl: r.fantasy_pctl as number | null,
  }));
  return {
    asOf: date,
    gradeDate,
    pickups: shaped.filter((r) => r.alert === "pickup"),
    downgrades: shaped.filter((r) => r.alert === "downgrade"),
    promotions: shaped.filter((r) => r.promotion),
  };
}
export type AlertRow = ReturnType<typeof getAlerts>["pickups"][number];

// ---------------------------------------------------------------- goalies

export function getGoalies() {
  const asOf = latest("goalie_outputs");
  if (!asOf) return { asOf: null, rows: [] };
  const rows = db()
    .prepare(
      `SELECT o.player_id id, COALESCE(p.full_name, '#' || o.player_id) name, t.abbrev team, o.*
       FROM goalie_outputs o LEFT JOIN players p ON p.id = o.player_id LEFT JOIN teams t ON t.id = o.team_id
       WHERE o.as_of_date = ? ORDER BY o.week_fp DESC`
    )
    .all(asOf) as any[];
  return { asOf, rows };
}

// ---------------------------------------------------------------- prospects

/** The board without comparables (they're fetched per prospect when a row is opened). */
export function getProspects() {
  const asOf = latest("prospect_outputs");
  if (!asOf) return { asOf: null, rows: [] };
  const rows = db()
    .prepare(
      `SELECT o.player_id, o.snapshot_season, o.age, o.position, o.draft_year, o.draft_overall, o.league,
         o.nhle_ppg, o.peak_nhle_ppg, o.p_regular, o.p_peak50, o.p_peak70, o.expected_peak_fpg, o.median_peak_fpg,
         o.risk, o.pctl, o.grade, COALESCE(p.full_name, '#' || o.player_id) name
       FROM prospect_outputs o LEFT JOIN players p ON p.id = o.player_id
       WHERE o.as_of_date = ? ORDER BY o.expected_peak_fpg DESC`
    )
    .all(asOf) as any[];
  return { asOf, rows };
}

export function getProspectComparables(playerId: number) {
  const row = db()
    .prepare("SELECT comparables FROM prospect_outputs WHERE player_id = ? ORDER BY as_of_date DESC LIMIT 1")
    .get(playerId) as { comparables: string } | undefined;
  if (!row) return [];
  const nm = names();
  return (JSON.parse(row.comparables) as any[]).map((c) => ({ ...c, name: nameOf(nm, c.id) }));
}

// ---------------------------------------------------------------- teams

function latestTeamSeason(): number | null {
  return (db().prepare("SELECT MAX(season) s FROM team_game").get() as { s: number | null }).s;
}

export function getTeams() {
  const season = latestTeamSeason();
  return db()
    .prepare(
      `SELECT t.id, ts.abbrev, t.name, t.logo, t.dark_logo FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
       WHERE ts.season = ? ORDER BY t.name`
    )
    .all(season) as { id: number; abbrev: string; name: string; logo: string; dark_logo: string }[];
}

export type Span = "game" | "5" | "season";

export interface NamedUnit {
  rank: number;
  sharedSeconds: number;
  sharedShare: number;
  players: { id: number; share: number; name: string }[];
}

export function getTeamView(abbrev: string, span: Span) {
  const season = latestTeamSeason();
  const team = db()
    .prepare(`SELECT t.id, ts.abbrev, t.name, t.logo, t.dark_logo FROM team_seasons ts JOIN teams t ON t.id = ts.team_id WHERE ts.season = ? AND ts.abbrev = ?`)
    .get(season, abbrev.toUpperCase()) as { id: number; abbrev: string; name: string; logo: string; dark_logo: string } | undefined;
  if (!team) return null;
  const all = db()
    .prepare("SELECT game_id FROM team_game WHERE team_id = ? AND season = ? ORDER BY game_date DESC, game_id DESC")
    .all(team.id, season) as { game_id: number }[];
  if (!all.length) return null;
  const ids = (span === "game" ? all.slice(0, 1) : span === "5" ? all.slice(0, 5) : all).map((g) => g.game_id);
  const units = teamUnits(team.id, ids);
  const nm = names();
  const games = db()
    .prepare(
      `SELECT id, game_date, home_abbrev, away_abbrev, home_score, away_score, last_period_type FROM games
       WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY game_date`
    )
    .all(...ids) as any[];
  const oneC = db().prepare("SELECT team_1c FROM player_deployment WHERE team_id = ? AND game_id = ? LIMIT 1").get(team.id, ids[0]) as
    | { team_1c: number | null }
    | undefined;
  const withNames = (list: ReturnType<typeof teamUnits>["F"]): NamedUnit[] =>
    list.map((u) => ({ ...u, players: u.players.map((p) => ({ ...p, name: nameOf(nm, p.id)! })) }));
  return {
    team,
    span,
    games: games.map((g) => ({
      id: g.id,
      date: g.game_date,
      matchup: `${g.away_abbrev} ${g.away_score} @ ${g.home_abbrev} ${g.home_score}${g.last_period_type !== "REG" ? ` (${g.last_period_type})` : ""}`,
    })),
    oneC: nameOf(nm, oneC?.team_1c ?? null),
    teamSeconds: units.teamSeconds,
    F: withNames(units.F),
    D: withNames(units.D),
    PP: withNames(units.PP),
    PK: withNames(units.PK),
  };
}
export type TeamViewData = NonNullable<ReturnType<typeof getTeamView>>;

// ---------------------------------------------------------------- player

export function getPlayer(id: number) {
  const nm = names();
  const bio = db()
    .prepare(
      `SELECT p.*, t.abbrev team, t.name team_name FROM players p
       LEFT JOIN teams t ON t.id = (SELECT team_id FROM team_seasons WHERE abbrev = p.current_team ORDER BY season DESC LIMIT 1)
       WHERE p.id = ?`
    )
    .get(id) as any;
  if (!bio) return null;

  const skater = db()
    .prepare(`SELECT m.*, t.abbrev team FROM model_outputs m LEFT JOIN teams t ON t.id = m.team_id WHERE m.player_id = ? ORDER BY m.as_of_date DESC LIMIT 1`)
    .get(id) as any;
  const goalie = db()
    .prepare(`SELECT o.*, t.abbrev team FROM goalie_outputs o LEFT JOIN teams t ON t.id = o.team_id WHERE o.player_id = ? ORDER BY o.as_of_date DESC LIMIT 1`)
    .get(id) as any;
  const prospectRow = db().prepare("SELECT * FROM prospect_outputs WHERE player_id = ? ORDER BY as_of_date DESC LIMIT 1").get(id) as any;
  const prospect = prospectRow
    ? { ...prospectRow, comparables: (JSON.parse(prospectRow.comparables) as any[]).map((c) => ({ ...c, name: nameOf(nm, c.id) })) }
    : null;

  const games = db()
    .prepare(
      `SELECT pg.*, g.home_team_id, g.home_abbrev, g.away_abbrev, g.home_score, g.away_score, g.last_period_type
       FROM player_game pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = ? ORDER BY pg.game_date DESC, pg.game_id DESC LIMIT 25`
    )
    .all(id) as any[];
  const gameLog = games.map((g) => {
    const home = g.team_id === g.home_team_id;
    const opp = home ? g.away_abbrev : g.home_abbrev;
    const us = home ? g.home_score : g.away_score;
    const them = home ? g.away_score : g.home_score;
    return {
      gameId: g.game_id,
      date: g.game_date,
      opp: `${home ? "vs" : "@"} ${opp}`,
      result: `${us > them ? "W" : "L"} ${us}-${them}${g.last_period_type !== "REG" ? ` ${g.last_period_type}` : ""}`,
      isGoalie: g.is_goalie === 1,
      g: g.g, a: g.a, ppp: g.ppp, shp: g.shp, sog: g.sog, hit: g.hit, blk: g.blk, pim: g.pim,
      toi: g.toi, toiPp: g.toi_pp,
      sv: g.sv, ga: g.ga, decision: g.w ? "W" : g.otl ? "OTL" : g.l ? "L" : "", so: g.so,
      fp: g.fantasy_points,
    };
  });

  // Current deployment: the latest game's units and the linemates in the one he was on.
  const dep = db()
    .prepare("SELECT * FROM player_deployment WHERE player_id = ? ORDER BY game_date DESC, game_id DESC LIMIT 1")
    .get(id) as any;
  let deployment = null as null | Record<string, any>;
  if (dep) {
    const units = db()
      .prepare("SELECT unit_type, rank, player_ids FROM line_assignments WHERE game_id = ? AND team_id = ?")
      .all(dep.game_id, dep.team_id) as { unit_type: string; rank: number; player_ids: string }[];
    const mine = (type: string) => {
      const u = units.find((x) => x.unit_type === type && (JSON.parse(x.player_ids) as number[]).includes(id));
      return u ? { rank: u.rank, mates: (JSON.parse(u.player_ids) as number[]).filter((p) => p !== id).map((p) => nameOf(nm, p)!) } : null;
    };
    const opp = db()
      .prepare("SELECT * FROM player_opportunity WHERE player_id = ? AND span = 'L10' ORDER BY as_of_date DESC LIMIT 1")
      .get(id) as any;
    const recent = db()
      .prepare("SELECT game_id FROM player_deployment WHERE player_id = ? ORDER BY game_date DESC LIMIT 10")
      .all(id) as { game_id: number }[];
    const gids = recent.map((r) => r.game_id);
    const toi5 = (db()
      .prepare(`SELECT SUM(toi_5v5) s FROM player_game WHERE player_id = ? AND game_id IN (${gids.map(() => "?").join(",")})`)
      .get(id, ...gids) as { s: number }).s;
    const mates = (
      db()
        .prepare(
          `SELECT CASE WHEN player_a = ? THEN player_b ELSE player_a END mate, SUM(shared_seconds) s FROM pair_overlap
           WHERE (player_a = ? OR player_b = ?) AND strength_state = '5v5' AND game_id IN (${gids.map(() => "?").join(",")})
           GROUP BY mate ORDER BY s DESC LIMIT 6`
        )
        .all(id, id, id, ...gids) as { mate: number; s: number }[]
    ).map((m) => ({ id: m.mate, name: nameOf(nm, m.mate)!, share: toi5 ? m.s / toi5 : 0 }));
    deployment = {
      date: dep.game_date,
      line: mine("F") ?? mine("D"),
      lineKind: mine("F") ? "F" : "D",
      pp: mine("PP"),
      pk: mine("PK"),
      oneC: nameOf(nm, dep.team_1c),
      l10: opp ?? null,
      mates,
    };
  }

  const season = (db().prepare("SELECT MAX(season) s FROM player_opportunity WHERE player_id = ?").get(id) as { s: number | null }).s;
  const trend = season
    ? (db()
        .prepare(
          `SELECT as_of_date date, ev_toi_share ev, pp_toi_share pp, with_1c_share c1 FROM player_opportunity
           WHERE player_id = ? AND span = 'L5' AND season = ? ORDER BY as_of_date`
        )
        .all(id, season) as { date: string; ev: number | null; pp: number | null; c1: number | null }[])
    : [];
  const promotion = db()
    .prepare(
      `SELECT game_date date, p1_5v5, late_5v5, p1_with_1c, late_with_1c, p1_with_top, late_with_top, promo_game
       FROM player_deployment WHERE player_id = ? ORDER BY game_date DESC LIMIT 5`
    )
    .all(id) as any[];
  const signal = db()
    .prepare("SELECT * FROM opportunity_signal WHERE player_id = ? ORDER BY as_of_date DESC LIMIT 1")
    .get(id) as any;

  return {
    bio: {
      id,
      name: bio.full_name as string,
      position: bio.position as string,
      team: (skater?.team ?? goalie?.team ?? bio.current_team) as string | null,
      headshot: bio.headshot_url as string | null,
      age: bio.birth_date ? (Date.now() - Date.parse(bio.birth_date)) / (365.25 * 86400000) : null,
      height: bio.height_in as number | null,
      weight: bio.weight_lb as number | null,
      shoots: bio.shoots as string | null,
      draft: bio.draft_year ? `${bio.draft_year} round ${bio.draft_round}, #${bio.draft_overall} (${bio.draft_team})` : "Undrafted",
    },
    skater: skater ?? null,
    goalie: goalie ?? null,
    prospect,
    gameLog,
    deployment,
    trendSeason: season,
    trend,
    promotion,
    signal: signal
      ? { ...signal, inputs: signal.inputs ? JSON.parse(signal.inputs) : null }
      : null,
  };
}
export type PlayerData = NonNullable<ReturnType<typeof getPlayer>>;

// ---------------------------------------------------------------- search

export function searchPlayers(q: string) {
  return db()
    .prepare("SELECT id, full_name name, position, current_team team FROM players WHERE full_name LIKE ? ORDER BY is_active DESC, full_name LIMIT 12")
    .all(`%${q}%`) as { id: number; name: string; position: string; team: string | null }[];
}
