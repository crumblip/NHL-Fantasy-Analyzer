import { loadLeagueConfig, loadModelConfig } from "../config";
import { getDb } from "../db";
import { addDays, franchiseOf, seasonForDate, weekWindow } from "./calendar";
import { simulateStart, startOutcome, type StartOutcome } from "./goalie-math";
import { letterGrade, percentiles } from "./project";

export interface GoalieGame {
  gameId: number;
  date: string;
  opp: string;
  home: boolean;
  b2b2: boolean;
  pStart: number;
  outcome: StartOutcome;
}

export interface GoalieProjection {
  playerId: number;
  team: string;
  teamId: number;
  gpWindow: number;
  startShareL10: number;
  startShareSeason: number;
  projShare: number;
  gsaxRaw: number;
  gsaxPerShot: number;
  neutral: StartOutcome;
  floor: number;
  ceiling: number;
  games: GoalieGame[];
}

interface TeamRates {
  gfPg: number;
  gaPg: number;
  uaForPg: number;
  uaAgPg: number;
  xpsFor: number;
  xpsAg: number;
  /** Goals ÷ xG on shots at a goalie, regressed toward league: team shooting talent. */
  finishing: number;
}

export interface TeamModel {
  rates: Map<string, TeamRates>;
  league: {
    goals: number;
    ua: number;
    xps: number;
    onGoal: number;
    home: number;
    tieShare: number;
    /** Share of a team's saves made by the starter (starters get pulled or relieved). */
    starterSaveShare: number;
    /** Observed starter shutout rate ÷ the Poisson model's rate at league-average scoring. */
    shutoutCalibration: number;
  };
}

/** Team offense/defense rates as of a date, regressed toward league average (by franchise). */
export function teamModel(asOf: string, season: number): TeamModel {
  const db = getDb();
  const gc = loadModelConfig().goalie;
  const prev = season - 10001;
  const w = (s: number) => (s === season ? gc.team_season_weights[0] : (gc.team_season_weights[1] ?? 0));
  const fr = new Map(
    (db.prepare("SELECT team_id, abbrev FROM team_seasons").all() as { team_id: number; abbrev: string }[]).map((r) => [
      r.team_id,
      franchiseOf(r.abbrev),
    ])
  );

  const rows = db
    .prepare(
      `SELECT g.id, g.season, g.home_team_id h, g.away_team_id a, e.event_team_id t,
         SUM(e.empty_net = 0) ua, SUM(CASE WHEN e.empty_net = 0 THEN e.xg ELSE 0 END) xg,
         SUM(e.empty_net = 0 AND e.type IN ('goal', 'shot-on-goal')) sog, SUM(e.type = 'goal') goals,
         SUM(e.empty_net = 0 AND e.type = 'goal') goals_in
       FROM events e JOIN games g ON g.id = e.game_id
       WHERE g.season IN (?, ?) AND g.game_date <= ? AND g.game_type = 2
         AND e.type IN ('goal', 'shot-on-goal', 'missed-shot')
       GROUP BY g.id, e.event_team_id`
    )
    .all(season, prev, asOf) as {
      id: number; season: number; h: number; a: number; t: number; ua: number; xg: number; sog: number; goals: number; goals_in: number;
    }[];

  type Acc = { games: number; gf: number; ga: number; uaF: number; uaA: number; xgF: number; xgA: number; gin: number };
  const acc = new Map<string, Acc>();
  const seen = new Set<string>();
  const get = (k: string) => {
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { games: 0, gf: 0, ga: 0, uaF: 0, uaA: 0, xgF: 0, xgA: 0, gin: 0 }));
    return a;
  };
  const lg = { games: 0, goals: 0, ua: 0, xg: 0, sog: 0, homeGoals: 0, awayGoals: 0, gin: 0 };
  for (const r of rows) {
    const wt = w(r.season);
    if (!wt) continue;
    const off = fr.get(r.t);
    const def = fr.get(r.t === r.h ? r.a : r.h);
    if (!off || !def) continue;
    for (const team of [off, def]) {
      const key = `${team}|${r.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        get(team).games += wt;
        lg.games += wt;
      }
    }
    const o = get(off);
    const d = get(def);
    o.gf += wt * r.goals;
    o.gin += wt * r.goals_in;
    lg.gin += wt * r.goals_in;
    o.uaF += wt * r.ua;
    o.xgF += wt * r.xg;
    d.ga += wt * r.goals;
    d.uaA += wt * r.ua;
    d.xgA += wt * r.xg;
    lg.goals += wt * r.goals;
    lg.ua += wt * r.ua;
    lg.xg += wt * r.xg;
    lg.sog += wt * r.sog;
    if (r.t === r.h) lg.homeGoals += wt * r.goals;
    else lg.awayGoals += wt * r.goals;
  }

  const lgGoals = lg.games ? lg.goals / lg.games : 3;
  const lgUa = lg.games ? lg.ua / lg.games : 40;
  const lgXps = lg.ua ? lg.xg / lg.ua : 0.07;
  const k = gc.team_prior_games;
  const lgFinish = lg.xg ? lg.gin / lg.xg : 1;
  const pf = gc.team_finishing_prior_xg;
  const rates = new Map<string, TeamRates>();
  for (const [team, a] of acc) {
    rates.set(team, {
      finishing: (a.gin + pf * lgFinish) / (a.xgF + pf),
      gfPg: (a.gf + k * lgGoals) / (a.games + k),
      gaPg: (a.ga + k * lgGoals) / (a.games + k),
      uaForPg: (a.uaF + k * lgUa) / (a.games + k),
      uaAgPg: (a.uaA + k * lgUa) / (a.games + k),
      xpsFor: (a.xgF + k * lgUa * lgXps) / (a.uaF + k * lgUa),
      xpsAg: (a.xgA + k * lgUa * lgXps) / (a.uaA + k * lgUa),
    });
  }
  const ot = db
    .prepare(
      `SELECT AVG(last_period_type != 'REG') share FROM games
       WHERE game_type = 2 AND game_state = 'OFF' AND season IN (?, ?) AND game_date <= ?`
    )
    .get(season, prev, asOf) as { share: number | null };
  const goalieGames = db
    .prepare(
      `SELECT SUM(CASE WHEN gs = 1 THEN sv ELSE 0 END) starter_sv, SUM(sv) all_sv,
         SUM(CASE WHEN gs = 1 THEN so ELSE 0 END) so, SUM(gs) starts
       FROM player_game WHERE is_goalie = 1 AND season IN (?, ?) AND game_date <= ?`
    )
    .get(season, prev, asOf) as { starter_sv: number; all_sv: number; so: number; starts: number };
  const tieShare = ot.share ?? 0.22;
  const lgLambda = lgUa * lgXps;
  const modelShutout = startOutcome(lgLambda, lgLambda, 0, tieShare, gc.ot_win_share, loadLeagueConfig().scoring).pShutout;
  const observedShutout = goalieGames.starts ? goalieGames.so / goalieGames.starts : modelShutout;
  return {
    rates,
    league: {
      goals: lgGoals,
      ua: lgUa,
      xps: lgXps,
      onGoal: lg.ua ? lg.sog / lg.ua : 0.65,
      home: lg.awayGoals ? Math.sqrt(lg.homeGoals / lg.awayGoals) : 1.03,
      tieShare,
      starterSaveShare: goalieGames.all_sv ? goalieGames.starter_sv / goalieGames.all_sv : 0.95,
      shutoutCalibration: modelShutout > 0 ? observedShutout / modelShutout : 1,
    },
  };
}

export function projectGoalies(asOf: string) {
  const db = getDb();
  const cfg = loadModelConfig();
  const gc = cfg.goalie;
  const { scoring } = loadLeagueConfig();
  const season = seasonForDate(asOf);
  const minSeason = season - 10001 * (cfg.talent.season_weights.length - 1);
  const seasonWeight = (s: number) => cfg.talent.season_weights[(season - s) / 10001] ?? 0;
  const fr = new Map(
    (db.prepare("SELECT team_id, abbrev FROM team_seasons").all() as { team_id: number; abbrev: string }[]).map((r) => [
      r.team_id,
      franchiseOf(r.abbrev),
    ])
  );
  const teamIdNow = new Map(
    (db.prepare("SELECT team_id, abbrev FROM team_seasons WHERE season = ?").all(season) as { team_id: number; abbrev: string }[]).map(
      (r) => [franchiseOf(r.abbrev), r.team_id]
    )
  );
  const tm = teamModel(asOf, season);
  const L = tm.league;
  const rate = (team: string): TeamRates =>
    tm.rates.get(team) ?? { gfPg: L.goals, gaPg: L.goals, uaForPg: L.ua, uaAgPg: L.ua, xpsFor: L.xps, xpsAg: L.xps, finishing: 1 };

  // Goalie quality: goals saved above expected per unblocked shot, weighted by season, regressed to 0.
  const quality = new Map<number, { shots: number; xg: number; ga: number; rawXg: number; rawGa: number }>();
  for (const r of db
    .prepare(
      `SELECT e.goalie_id gid, g.season, COUNT(*) shots, SUM(e.xg) xg, SUM(e.type = 'goal') ga
       FROM events e JOIN games g ON g.id = e.game_id
       WHERE e.type IN ('goal', 'shot-on-goal', 'missed-shot') AND e.goalie_id IS NOT NULL
         AND g.game_date <= ? AND g.season >= ? AND g.game_type = 2
       GROUP BY 1, 2`
    )
    .all(asOf, minSeason) as { gid: number; season: number; shots: number; xg: number; ga: number }[]) {
    const wt = seasonWeight(r.season);
    const q = quality.get(r.gid) ?? { shots: 0, xg: 0, ga: 0, rawXg: 0, rawGa: 0 };
    q.shots += wt * r.shots;
    q.xg += wt * r.xg;
    q.ga += wt * r.ga;
    if (r.season >= season - 10001) {
      q.rawXg += r.xg;
      q.rawGa += r.ga;
    }
    quality.set(r.gid, q);
  }
  const gsaxPerShot = (id: number) => {
    const q = quality.get(id);
    return q ? (q.xg - q.ga) / (q.shots + gc.quality_prior_shots) : 0;
  };

  // Every derived team-game with its starter, most recent first.
  const appearances = db
    .prepare(
      `SELECT pg.game_id, pg.player_id, pg.team_id, pg.season, pg.game_date, pg.gs FROM player_game pg
       WHERE pg.is_goalie = 1 AND pg.game_date <= ? AND pg.season >= ? ORDER BY pg.game_date DESC, pg.game_id DESC`
    )
    .all(asOf, minSeason) as { game_id: number; player_id: number; team_id: number; season: number; game_date: string; gs: number }[];
  const teamGames = new Map<string, { gameId: number; season: number; date: string; starter: number | null }[]>();
  {
    const seenGame = new Set<string>();
    for (const a of appearances) {
      const team = fr.get(a.team_id);
      if (!team) continue;
      const key = `${team}|${a.game_id}`;
      if (!seenGame.has(key)) {
        seenGame.add(key);
        const list = teamGames.get(team) ?? [];
        list.push({ gameId: a.game_id, season: a.season, date: a.game_date, starter: null });
        teamGames.set(team, list);
      }
      if (a.gs) {
        const g = teamGames.get(team)!.find((x) => x.gameId === a.game_id)!;
        g.starter = a.player_id;
      }
    }
  }
  const lastTeam = new Map<number, string>();
  const gpWindow = new Map<number, number>();
  for (const a of appearances) {
    if (!lastTeam.has(a.player_id)) lastTeam.set(a.player_id, fr.get(a.team_id) ?? "");
    gpWindow.set(a.player_id, (gpWindow.get(a.player_id) ?? 0) + 1);
  }

  // Back-to-backs: how often a team's primary goalie starts the second game vs any other game.
  let pB2 = 0, nB2 = 0, pOther = 0, nOther = 0;
  for (const games of teamGames.values()) {
    const bySeason = new Map<number, typeof games>();
    games.forEach((g) => bySeason.set(g.season, [...(bySeason.get(g.season) ?? []), g]));
    for (const list of bySeason.values()) {
      const asc = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const counts = new Map<number, number>();
      asc.forEach((g) => g.starter && counts.set(g.starter, (counts.get(g.starter) ?? 0) + 1));
      const primary = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      asc.forEach((g, i) => {
        const b2b2 = i > 0 && addDays(asc[i - 1].date, 1) === g.date;
        if (b2b2) {
          nB2++;
          if (g.starter === primary) pB2++;
        } else {
          nOther++;
          if (g.starter === primary) pOther++;
        }
      });
    }
  }
  const primaryB2b = nB2 && pOther ? pB2 / nB2 / (pOther / nOther) : 1;
  const backupB2b = nB2 && nOther - pOther ? (nB2 - pB2) / nB2 / ((nOther - pOther) / nOther) : 1;

  // Pool: in season, goalies who appeared in the last 30 days; before it, the rosters.
  const started = db.prepare("SELECT 1 FROM games WHERE season = ? AND game_type = 2 AND game_date <= ? LIMIT 1").get(season, asOf);
  const pool = new Map<number, string>();
  if (started) {
    const cutoff = addDays(asOf, -30);
    for (const a of appearances) {
      if (a.season === season && a.game_date >= cutoff && !pool.has(a.player_id)) pool.set(a.player_id, fr.get(a.team_id) ?? "");
    }
  } else {
    for (const r of db
      .prepare(
        `SELECT r.player_id, r.team_abbrev FROM roster_entries r JOIN players p ON p.id = r.player_id
         WHERE r.season = ? AND p.position = 'G'`
      )
      .all(season) as { player_id: number; team_abbrev: string }[]) {
      pool.set(r.player_id, franchiseOf(r.team_abbrev));
    }
  }

  // Start share: recent + season share with the goalie's latest team, normalized within his current team.
  const shareOn = (id: number, team: string) => {
    const games = teamGames.get(team) ?? [];
    if (!games.length) return { l10: 0, season: 0 };
    const recent = games.slice(0, gc.start_share_recent_games);
    const latest = games.filter((g) => g.season === games[0].season);
    const share = (list: typeof games) => list.filter((g) => g.starter === id).length / list.length;
    return { l10: share(recent), season: share(latest) };
  };
  const raw = new Map<number, { l10: number; season: number; raw: number }>();
  for (const [id, team] of pool) {
    const from = lastTeam.get(id) && lastTeam.get(id) !== team ? lastTeam.get(id)! : team;
    const s = shareOn(id, from);
    const r = gc.start_share_recent_weight * s.l10 + (1 - gc.start_share_recent_weight) * s.season;
    raw.set(id, { ...s, raw: r > 0 ? r : gc.unknown_goalie_share });
  }
  const share = new Map<number, number>();
  const byTeam = new Map<string, number[]>();
  for (const [id, team] of pool) byTeam.set(team, [...(byTeam.get(team) ?? []), id]);
  for (const ids of byTeam.values()) {
    const total = ids.reduce((s, id) => s + raw.get(id)!.raw, 0);
    ids.forEach((id) => share.set(id, raw.get(id)!.raw / total));
  }

  // Remaining schedule per franchise, with back-to-back second games flagged.
  const upcoming = db
    .prepare(
      `SELECT id, game_date, home_team_id, away_team_id FROM games
       WHERE season = ? AND game_type = 2 AND game_date > ? AND schedule_state != 'CNCL' ORDER BY game_date, id`
    )
    .all(season, asOf) as { id: number; game_date: string; home_team_id: number; away_team_id: number }[];
  const schedule = new Map<string, { id: number; date: string; opp: string; home: boolean; b2b2: boolean }[]>();
  const lastDate = new Map<string, string>();
  for (const [team, games] of teamGames) if (games[0]?.season === season) lastDate.set(team, games[0].date);
  for (const g of upcoming) {
    for (const [tid, oid, home] of [
      [g.home_team_id, g.away_team_id, true],
      [g.away_team_id, g.home_team_id, false],
    ] as const) {
      const team = fr.get(tid);
      const opp = fr.get(oid);
      if (!team || !opp) continue;
      const prevDate = lastDate.get(team);
      const list = schedule.get(team) ?? [];
      list.push({ id: g.id, date: g.game_date, opp, home, b2b2: prevDate !== undefined && addDays(prevDate, 1) === g.game_date });
      schedule.set(team, list);
      lastDate.set(team, g.game_date);
    }
  }

  // Start probabilities per game for every team first: each side's expected goalie matters to the other.
  const startProbs = new Map<string, Map<number, number>>(); // `${gameId}|${team}` → goalie → p
  for (const [team, ids] of byTeam) {
    const primary = [...ids].sort((a, b) => share.get(b)! - share.get(a)!)[0];
    for (const g of schedule.get(team) ?? []) {
      const weights = ids.map((id) => share.get(id)! * (g.b2b2 ? (id === primary ? primaryB2b : backupB2b) : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      startProbs.set(`${g.id}|${team}`, new Map(ids.map((id, i) => [id, weights[i] / total])));
    }
  }
  const expectedGoalieQuality = (gameId: number, team: string) => {
    const m = startProbs.get(`${gameId}|${team}`);
    if (!m) return 0;
    let s = 0;
    m.forEach((p, id) => (s += p * gsaxPerShot(id)));
    return s;
  };

  // Both sides of a game use the same model: shot volume (offense × defense) times xG per shot
  // (offense × defense), minus the goalie in net's saves above expected per shot.
  const q = gc.ot_win_share;
  const cal = { saveShare: L.starterSaveShare, shutoutCalibration: L.shutoutCalibration };
  const outcomeFor = (id: number, team: string, opp: string | null, home: boolean | null, oppGoalie: number) => {
    const t = rate(team);
    const o = opp ? rate(opp) : { uaForPg: L.ua, uaAgPg: L.ua, xpsFor: L.xps, xpsAg: L.xps, finishing: 1 };
    const h = home === null ? 1 : home ? L.home : 1 / L.home;
    const shotsFor = (t.uaForPg * o.uaAgPg) / L.ua;
    const xpsFor = ((t.xpsFor * o.xpsAg) / L.xps) * t.finishing;
    const shotsAg = (o.uaForPg * t.uaAgPg) / L.ua;
    const xpsAg = ((o.xpsFor * t.xpsAg) / L.xps) * o.finishing;
    const lambdaGf = shotsFor * Math.max(0.005, xpsFor - oppGoalie) * h;
    const lambdaGa = (shotsAg * Math.max(0.005, xpsAg - gsaxPerShot(id))) / h;
    const sog = shotsAg * L.onGoal;
    return { lambdaGf, lambdaGa, sog, outcome: startOutcome(lambdaGf, lambdaGa, sog, L.tieShare, q, scoring, cal) };
  };

  const goalies: GoalieProjection[] = [];
  for (const [team, ids] of byTeam) {
    const games = schedule.get(team) ?? [];
    for (const id of ids) {
      const neutral = outcomeFor(id, team, null, null, 0);
      const range = simulateStart(neutral.lambdaGf, neutral.lambdaGa, neutral.sog, L.tieShare, q, scoring, gc.simulations, id, cal);
      const q10 = quality.get(id);
      goalies.push({
        playerId: id,
        team,
        teamId: teamIdNow.get(team) ?? 0,
        gpWindow: gpWindow.get(id) ?? 0,
        startShareL10: raw.get(id)!.l10,
        startShareSeason: raw.get(id)!.season,
        projShare: share.get(id)!,
        gsaxRaw: q10 ? q10.rawXg - q10.rawGa : 0,
        gsaxPerShot: gsaxPerShot(id),
        neutral: neutral.outcome,
        floor: range.floor,
        ceiling: range.ceiling,
        games: games.map((g) => ({
          gameId: g.id,
          date: g.date,
          opp: g.opp,
          home: g.home,
          b2b2: g.b2b2,
          pStart: startProbs.get(`${g.id}|${team}`)!.get(id)!,
          outcome: outcomeFor(id, team, g.opp, g.home, expectedGoalieQuality(g.id, g.opp)).outcome,
        })),
      });
    }
  }
  return { season, week: weekWindow(asOf, season), goalies, b2b: { primaryB2b, backupB2b }, league: L };
}

export function runGoalies(asOf: string) {
  const db = getDb();
  const cfg = loadModelConfig();
  const { season, week, goalies } = projectGoalies(asOf);

  const rows = goalies.map((g) => {
    const startsLeft = g.games.reduce((s, x) => s + x.pStart, 0);
    const restFp = g.games.reduce((s, x) => s + x.pStart * x.outcome.fantasyPoints, 0);
    const wk = g.games.filter((x) => x.date >= week.start && x.date <= week.end);
    const perStart = startsLeft ? restFp / startsLeft : g.neutral.fantasyPoints;
    const avg = (f: (o: StartOutcome) => number) =>
      startsLeft ? g.games.reduce((s, x) => s + x.pStart * f(x.outcome), 0) / startsLeft : f(g.neutral);
    return {
      player_id: g.playerId,
      as_of_date: asOf,
      season,
      team_id: g.teamId,
      gp_window: g.gpWindow,
      start_share_l10: g.startShareL10,
      start_share_season: g.startShareSeason,
      proj_start_share: g.projShare,
      gsax_raw: g.gsaxRaw,
      gsax_per_shot: g.gsaxPerShot,
      p_win: avg((o) => o.pWin),
      p_otl: avg((o) => o.pOtl),
      p_so: avg((o) => o.pShutout),
      proj_ga: avg((o) => o.expectedGa),
      proj_sv: avg((o) => o.expectedSaves),
      fp_per_start: perStart,
      floor_fp: g.floor,
      ceiling_fp: g.ceiling,
      next_game_id: g.games[0]?.gameId ?? null,
      next_game_p_start: g.games[0]?.pStart ?? null,
      next_game_fp: g.games[0]?.outcome.fantasyPoints ?? null,
      week_start: week.start,
      week_end: week.end,
      week_games: wk.length,
      week_starts: wk.reduce((s, x) => s + x.pStart, 0),
      week_fp: wk.reduce((s, x) => s + x.pStart * x.outcome.fantasyPoints, 0),
      games_remaining: g.games.length,
      rest_starts: startsLeft,
      rest_fp: restFp,
      eligible: g.gpWindow >= cfg.goalie.min_nhl_games ? 1 : 0,
    } as Record<string, any>;
  });

  const graded = rows.filter((r) => r.eligible);
  const assign = (key: string, value: (r: Record<string, any>) => number) => {
    const p = percentiles(graded.map(value));
    graded.forEach((r, i) => {
      r[`${key}_pctl`] = p[i];
      r[`${key}_grade`] = letterGrade(p[i], cfg.grades.letters);
    });
  };
  assign("fantasy", (r) => (r.games_remaining ? r.rest_fp : r.fp_per_start * r.proj_start_share));
  assign("workload", (r) => r.proj_start_share);
  assign("quality", (r) => r.gsax_per_shot);

  db.transaction(() => {
    db.prepare("DELETE FROM goalie_outputs WHERE as_of_date = ?").run(asOf);
    if (!rows.length) return;
    const cols = [
      "player_id", "as_of_date", "season", "team_id", "gp_window", "start_share_l10", "start_share_season",
      "proj_start_share", "gsax_raw", "gsax_per_shot", "p_win", "p_otl", "p_so", "proj_ga", "proj_sv",
      "fp_per_start", "floor_fp", "ceiling_fp", "next_game_id", "next_game_p_start", "next_game_fp",
      "week_start", "week_end", "week_games", "week_starts", "week_fp", "games_remaining", "rest_starts", "rest_fp",
      "fantasy_pctl", "fantasy_grade", "workload_pctl", "workload_grade", "quality_pctl", "quality_grade",
    ];
    const st = db.prepare(`INSERT INTO goalie_outputs (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
    for (const r of rows) st.run(Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  })();
  return { asOf, season, goalies: rows.length, graded: graded.length };
}
