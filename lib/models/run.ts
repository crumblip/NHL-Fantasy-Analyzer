import { loadLeagueConfig, loadModelConfig } from "../config";
import { getDb } from "../db";
import {
  expectedPoints,
  lambdas,
  letterGrade,
  peripheralPoints,
  percentiles,
  simulateRange,
  type ToiPerGame,
} from "./project";
import { computeTalent } from "./talent";

const FANTASY_POS: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D", LW: "LW", RW: "RW" };
const OPP_METRICS = [
  "ev_toi_share",
  "pp_toi_share",
  "pp1_rate",
  "top_line_rate",
  "with_1c_share",
  "linemate_quality",
  "oz_fo_share",
] as const;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Season the as-of date belongs to: the next regular-season game's season, else the latest. */
export function seasonForDate(asOf: string): number {
  const db = getDb();
  const next = db
    .prepare("SELECT season FROM games WHERE game_type = 2 AND game_date > ? ORDER BY game_date LIMIT 1")
    .get(asOf) as { season: number } | undefined;
  if (next) return next.season;
  return (db.prepare("SELECT MAX(season) s FROM games").get() as { s: number }).s;
}

export function runProjections(asOf: string) {
  const db = getDb();
  const cfg = loadModelConfig();
  const league = loadLeagueConfig();
  const { scoring } = league;
  const pc = cfg.projection;
  const asOfSeason = seasonForDate(asOf);
  const prevSeason = asOfSeason - 10001;
  const minSeason = asOfSeason - 10001 * (cfg.talent.season_weights.length - 1);

  const talent = computeTalent(asOf, asOfSeason, cfg);

  // Fantasy position: override, else NHL listed position, else the player's usual game position.
  const listed = new Map(
    (
      db
        .prepare(
          `SELECT p.id, COALESCE(o.position, p.position) pos FROM players p LEFT JOIN position_override o ON o.player_id = p.id`
        )
        .all() as { id: number; pos: string | null }[]
    ).map((r) => [r.id, r.pos])
  );
  const gamePos = new Map(
    (
      db
        .prepare(
          `SELECT player_id, position_code pos, COUNT(*) n FROM game_rosters WHERE position_code != 'G'
           GROUP BY player_id, position_code ORDER BY n`
        )
        .all() as { player_id: number; pos: string }[]
    ).map((r) => [r.player_id, r.pos]) // ordered by count, so the most common wins
  );
  const positionOf = (id: number) => FANTASY_POS[listed.get(id) ?? gamePos.get(id) ?? ""] ?? null;

  // Pool and current team. In-season: anyone who played in the last 30 days. Preseason: rosters.
  const played = db
    .prepare(
      `SELECT pg.player_id, pg.team_id, pg.game_date FROM player_game pg
       JOIN (SELECT player_id, MAX(game_date) d FROM player_game WHERE season = ? AND game_date <= ? AND is_goalie = 0 GROUP BY player_id) l
         ON l.player_id = pg.player_id AND l.d = pg.game_date`
    )
    .all(asOfSeason, asOf) as { player_id: number; team_id: number; game_date: string }[];
  const pool = new Map<number, number>();
  if (played.length) {
    const cutoff = addDays(asOf, -30);
    for (const r of played) if (r.game_date >= cutoff) pool.set(r.player_id, r.team_id);
  } else {
    for (const r of db
      .prepare(
        `SELECT r.player_id, ts.team_id FROM roster_entries r
         JOIN team_seasons ts ON ts.season = r.season AND ts.abbrev = r.team_abbrev WHERE r.season = ?`
      )
      .all(asOfSeason) as { player_id: number; team_id: number }[]) {
      pool.set(r.player_id, r.team_id);
    }
  }

  // Recent games per player for the TOI projection.
  const history = new Map<number, { season: number; team_id: number; ev: number; pp: number; sh: number }[]>();
  for (const r of db
    .prepare(
      `SELECT player_id, season, team_id, toi_ev ev, toi_pp pp, toi_sh sh FROM player_game
       WHERE is_goalie = 0 AND game_date <= ? AND season >= ? ORDER BY player_id, game_date DESC, game_id DESC`
    )
    .all(asOf, minSeason) as { player_id: number; season: number; team_id: number; ev: number; pp: number; sh: number }[]) {
    const list = history.get(r.player_id) ?? [];
    list.push(r);
    history.set(r.player_id, list);
  }

  // Opponent strength: goals and shots against per game, current + previous season, regressed.
  const teamRows = db
    .prepare(
      `SELECT g.id, g.home_team_id h, g.away_team_id a, e.event_team_id t,
         SUM(e.type = 'goal') goals, SUM(e.type IN ('goal', 'shot-on-goal')) sog
       FROM events e JOIN games g ON g.id = e.game_id
       WHERE g.season IN (?, ?) AND g.game_date <= ? AND e.type IN ('goal', 'shot-on-goal')
       GROUP BY g.id, e.event_team_id`
    )
    .all(asOfSeason, prevSeason, asOf) as { id: number; h: number; a: number; t: number; goals: number; sog: number }[];
  const against = new Map<number, { games: Set<number>; ga: number; sa: number }>();
  for (const r of teamRows) {
    const defender = r.t === r.h ? r.a : r.h;
    const x = against.get(defender) ?? { games: new Set(), ga: 0, sa: 0 };
    x.games.add(r.id);
    x.ga += r.goals;
    x.sa += r.sog;
    against.set(defender, x);
  }
  let lgGames = 0, lgGa = 0, lgSa = 0;
  for (const x of against.values()) {
    lgGames += x.games.size;
    lgGa += x.ga;
    lgSa += x.sa;
  }
  const lgGaPg = lgGames ? lgGa / lgGames : 3;
  const lgSaPg = lgGames ? lgSa / lgGames : 30;
  const k = pc.opponent_prior_games;
  const factor = (team: number) => {
    const x = against.get(team);
    const gp = x?.games.size ?? 0;
    return {
      goals: ((x?.ga ?? 0) + k * lgGaPg) / (gp + k) / lgGaPg,
      shots: ((x?.sa ?? 0) + k * lgSaPg) / (gp + k) / lgSaPg,
    };
  };

  // Remaining schedule per team.
  const schedule = new Map<number, { id: number; date: string; opp: number }[]>();
  for (const g of db
    .prepare(
      `SELECT id, game_date, home_team_id, away_team_id FROM games
       WHERE season = ? AND game_type = 2 AND game_date > ? AND schedule_state != 'CNCL' ORDER BY game_date, id`
    )
    .all(asOfSeason, asOf) as { id: number; game_date: string; home_team_id: number; away_team_id: number }[]) {
    for (const [team, opp] of [
      [g.home_team_id, g.away_team_id],
      [g.away_team_id, g.home_team_id],
    ]) {
      const list = schedule.get(team) ?? [];
      list.push({ id: g.id, date: g.game_date, opp });
      schedule.set(team, list);
    }
  }
  const teamGamesPlayed = new Map(
    (
      db
        .prepare("SELECT team_id, COUNT(*) n FROM team_game WHERE season = ? AND game_date <= ? GROUP BY team_id")
        .all(asOfSeason, asOf) as { team_id: number; n: number }[]
    ).map((r) => [r.team_id, r.n])
  );

  const weekEnd = addDays(asOf, 7);
  type Row = Record<string, any>;
  const rows: Row[] = [];
  for (const [id, teamId] of pool) {
    const t = talent.get(id);
    const hist = history.get(id);
    const position = positionOf(id);
    if (!t || !hist?.length || !position || t.gp < pc.min_nhl_games) continue;

    const recent = hist.slice(0, pc.toi_recent_games);
    const lastSeason = hist.filter((h) => h.season === hist[0].season);
    const avg = (list: typeof hist, key: "ev" | "pp" | "sh") => list.reduce((s, h) => s + h[key], 0) / list.length;
    const w = pc.toi_recent_weight;
    const toi: ToiPerGame = {
      ev: w * avg(recent, "ev") + (1 - w) * avg(lastSeason, "ev"),
      pp: w * avg(recent, "pp") + (1 - w) * avg(lastSeason, "pp"),
      sh: w * avg(recent, "sh") + (1 - w) * avg(lastSeason, "sh"),
    };

    // Availability: share of team games played in the player's latest season, regressed.
    const inProgress = hist[0].season === asOfSeason;
    const teamGames = inProgress ? (teamGamesPlayed.get(teamId) ?? lastSeason.length) : 82;
    const availability = Math.min(
      1,
      Math.max(
        0.3,
        (lastSeason.length + pc.availability_prior_games * pc.availability_prior) /
          (Math.max(teamGames, lastSeason.length) + pc.availability_prior_games)
      )
    );

    const neutral = lambdas(t, toi);
    const isD = position === "D";
    const games = schedule.get(teamId) ?? [];
    const perGame = games.map((g) => {
      const f = factor(g.opp);
      return { ...g, fp: expectedPoints(lambdas(t, toi, f.goals, f.shots), isD, scoring) };
    });
    const neutralFp = expectedPoints(neutral, isD, scoring);
    const projFpGp = perGame.length ? perGame.reduce((s, g) => s + g.fp, 0) / perGame.length : neutralFp;
    const next7 = perGame.filter((g) => g.date <= weekEnd);
    const range = simulateRange(neutral, isD, scoring, pc.simulations, id);

    rows.push({
      player_id: id,
      as_of_date: asOf,
      season: asOfSeason,
      team_id: teamId,
      position,
      new_team: hist[0].team_id !== teamId ? 1 : 0,
      gp_window: t.gp,
      proj_toi_ev: toi.ev,
      proj_toi_pp: toi.pp,
      proj_toi_sh: toi.sh,
      proj_g: neutral.g,
      proj_a: neutral.a,
      proj_ppp: neutral.ppp,
      proj_shp: neutral.shp,
      proj_sog: neutral.sog,
      proj_hit: neutral.hit,
      proj_blk: neutral.blk,
      proj_pim: neutral.pim,
      proj_fp_gp: projFpGp,
      floor_fp: range.floor,
      ceiling_fp: range.ceiling,
      next_game_id: perGame[0]?.id ?? null,
      next_game_fp: perGame[0]?.fp ?? null,
      next7_games: next7.length,
      next7_fp: next7.reduce((s, g) => s + g.fp, 0) * availability,
      games_remaining: perGame.length,
      availability,
      expected_games: perGame.length * availability,
      rest_fp: perGame.reduce((s, g) => s + g.fp, 0) * availability,
      offense_rating: t.offenseRating,
      ev_p60: t.p60.ev,
      pp_p60: t.p60.pp,
      peripheral_fp_gp: peripheralPoints(neutral, scoring),
      detail: JSON.stringify({
        g60: t.g60, a160: t.a160, a260: t.a260, sog60: t.sog60, ixg60: t.ixg60,
        finishing: t.finishing, hit60: t.hit60, blk60NonPk: t.blk60NonPk, blk60Pk: t.blk60Pk, pim60: t.pim60,
      }),
    });
  }

  // Replacement level: the (teams × starting slots)-th best projected FP/GP at each position.
  const roster = league.league.roster as Record<string, number>;
  const replacement = new Map<string, number>();
  for (const pos of ["C", "LW", "RW", "D"]) {
    const list = rows.filter((r) => r.position === pos).map((r) => r.proj_fp_gp).sort((a, b) => b - a);
    const slots = league.league.teams * (roster[pos] ?? 0);
    if (list.length) replacement.set(pos, list[Math.min(slots, list.length) - 1]);
  }

  // Latest deployment (L10) and signals on or before the date.
  const latestOpp = new Map(
    (
      db
        .prepare(
          `SELECT o.* FROM player_opportunity o
           JOIN (SELECT player_id, MAX(as_of_date) d FROM player_opportunity WHERE span = 'L10' AND as_of_date <= ? GROUP BY player_id) l
             ON l.player_id = o.player_id AND l.d = o.as_of_date
           WHERE o.span = 'L10'`
        )
        .all(asOf) as Record<string, any>[]
    ).map((r) => [r.player_id as number, r])
  );
  const latestSignal = new Map(
    (
      db
        .prepare(
          `SELECT s.* FROM opportunity_signal s
           JOIN (SELECT player_id, MAX(as_of_date) d FROM opportunity_signal WHERE as_of_date <= ? GROUP BY player_id) l
             ON l.player_id = s.player_id AND l.d = s.as_of_date`
        )
        .all(asOf) as Record<string, any>[]
    ).map((r) => [r.player_id as number, r])
  );

  // Opportunity score: weighted z-scores of the L10 metrics within forwards / defense.
  const ow = cfg.grades.opportunity_weights;
  for (const group of ["F", "D"]) {
    const members = rows.filter((r) => (r.position === "D") === (group === "D"));
    const stats = new Map<string, { mean: number; sd: number }>();
    for (const m of OPP_METRICS) {
      const xs = members.map((r) => latestOpp.get(r.player_id)?.[m]).filter((x): x is number => typeof x === "number");
      const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
      stats.set(m, { mean, sd });
    }
    for (const r of members) {
      const o = latestOpp.get(r.player_id);
      let num = 0, den = 0;
      for (const m of OPP_METRICS) {
        const v = o?.[m];
        if (typeof v !== "number" || !ow[m]) continue;
        const s = stats.get(m)!;
        num += ow[m] * ((v - s.mean) / s.sd);
        den += ow[m];
      }
      r.opportunity_score = den ? num / den : null;
    }
  }

  const g = cfg.grades;
  for (const pos of ["C", "LW", "RW", "D"]) {
    const members = rows.filter((r) => r.position === pos);
    const value = (r: Row) => (r.games_remaining ? r.rest_fp : r.proj_fp_gp);
    const assign = (key: string, vals: (number | null)[]) => {
      const present = members.map((r, i) => ({ r, v: vals[i] })).filter((x): x is { r: Row; v: number } => x.v !== null);
      const p = percentiles(present.map((x) => x.v));
      present.forEach(({ r }, i) => {
        r[`${key}_pctl`] = p[i];
        r[`${key}_grade`] = letterGrade(p[i], g.letters);
      });
    };
    assign("fantasy", members.map(value));
    assign("offense", members.map((r) => r.offense_rating));
    assign("opportunity", members.map((r) => r.opportunity_score ?? null));
    assign("peripheral", members.map((r) => r.peripheral_fp_gp));
  }

  for (const r of rows) {
    const repl = replacement.get(r.position) ?? 0;
    r.replacement_fp_gp = repl;
    r.vor = (r.proj_fp_gp - repl) * (r.games_remaining ? r.expected_games : 1);
    const sig = latestSignal.get(r.player_id);
    r.opportunity_delta = sig?.opportunity_delta ?? null;
    r.trend =
      r.opportunity_delta === null ? null : r.opportunity_delta >= g.trend_threshold ? "up" : r.opportunity_delta <= -g.trend_threshold ? "down" : "flat";
    const current = sig && sig.season === asOfSeason;
    r.alert = current ? sig.alert : null;
    r.alert_text = current ? sig.alert_text : null;
    r.promotion_flag = current ? sig.promotion_flag : 0;
    r.mismatch =
      r.offense_pctl >= g.mismatch.high && (r.opportunity_pctl ?? 100) <= g.mismatch.low
        ? "waiting on a promotion"
        : (r.opportunity_pctl ?? 0) >= g.mismatch.high && r.offense_pctl <= g.mismatch.low
          ? "sell-high risk"
          : null;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM model_outputs WHERE as_of_date = ?").run(asOf);
    if (!rows.length) return;
    const cols = [
      "player_id", "as_of_date", "season", "team_id", "position", "new_team", "gp_window",
      "proj_toi_ev", "proj_toi_pp", "proj_toi_sh", "proj_g", "proj_a", "proj_ppp", "proj_shp",
      "proj_sog", "proj_hit", "proj_blk", "proj_pim", "proj_fp_gp", "floor_fp", "ceiling_fp",
      "next_game_id", "next_game_fp", "next7_games", "next7_fp", "games_remaining", "availability",
      "expected_games", "rest_fp", "replacement_fp_gp", "vor", "offense_rating", "ev_p60", "pp_p60",
      "peripheral_fp_gp", "opportunity_score", "opportunity_delta", "trend",
      "fantasy_pctl", "fantasy_grade", "offense_pctl", "offense_grade", "opportunity_pctl", "opportunity_grade",
      "peripheral_pctl", "peripheral_grade", "mismatch", "alert", "alert_text", "promotion_flag", "detail",
    ];
    const st = db.prepare(`INSERT INTO model_outputs (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
    for (const r of rows) st.run(Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  })();

  return { asOf, season: asOfSeason, players: rows.length };
}
