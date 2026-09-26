import { loadLeagueConfig, loadModelConfig, type OpportunityInput } from "../config";
import { getDb } from "../db";
import { playerNames } from "../names";
import {
  describeInputs,
  inputDeltas,
  INPUTS,
  opportunityDelta,
  standardDeviation,
  windowMetrics,
  type DeployRow,
  type InputDetail,
} from "./metrics";
import { detectUnits, pairLookup, rankByToi, type PairSeconds, type Unit } from "./units";

const FORWARD = new Set(["C", "L", "R"]);
const FANTASY_POS: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D" };
const flipZone = (z: string) => (z === "O" ? "D" : z === "D" ? "O" : z);

interface PlayerGameRow {
  player_id: number;
  team_id: number;
  is_goalie: number;
  toi: number;
  toi_5v5: number;
  toi_pp: number;
  toi_sh: number;
  g: number;
  a: number;
  fantasy_points: number;
}

interface PairRow {
  team_id: number;
  player_a: number;
  player_b: number;
  period: number;
  strength_state: string;
  shared_seconds: number;
}

interface TeamGameContext {
  centers: Map<number, number>; // center → 5v5 seconds
  f1: number[];
  forwardToi: Map<number, number>;
}

type Deployment = DeployRow & {
  game_id: number;
  player_id: number;
  team_id: number;
  season: number;
  game_date: string;
  position: string;
  pk_unit: number | null;
  team_1c: number | null;
  p1_5v5: number;
  late_5v5: number;
  p1_with_1c: number | null;
  late_with_1c: number | null;
  p1_with_top: number | null;
  late_with_top: number | null;
  promo_game: number | null;
  fantasy_points: number;
};

export function buildDeployment(seasonFilter?: number[]) {
  const db = getDb();
  const model = loadModelConfig();
  const league = loadLeagueConfig();
  const dep = model.deployment;

  const seasons = (
    db.prepare("SELECT DISTINCT season FROM team_game ORDER BY season").all() as { season: number }[]
  )
    .map((r) => r.season)
    .filter((s) => !seasonFilter?.length || seasonFilter.includes(s));
  if (!seasons.length) return { seasons: [], games: 0 };

  // Offense proxy for linemate quality: career-to-date points/60 in our data, shrunk toward
  // the position-group average. Running totals start from seasons before the first one built.
  const avgRate = new Map(
    (
      db
        .prepare(
          `SELECT pg.position = 'D' AS is_d, SUM(pg.g + pg.a) * 3600.0 / SUM(pg.toi) AS rate
           FROM player_game pg WHERE pg.is_goalie = 0 AND pg.toi > 0 GROUP BY 1`
        )
        .all() as { is_d: number; rate: number }[]
    ).map((r) => [r.is_d === 1, r.rate])
  );
  const totals = new Map<number, { pts: number; toi: number; isD: boolean }>();
  for (const r of db
    .prepare(
      `SELECT player_id, SUM(g + a) pts, SUM(toi) toi, MAX(position = 'D') is_d FROM player_game
       WHERE is_goalie = 0 AND season < ? GROUP BY player_id`
    )
    .all(seasons[0]) as { player_id: number; pts: number; toi: number; is_d: number }[]) {
    totals.set(r.player_id, { pts: r.pts, toi: r.toi, isD: r.is_d === 1 });
  }
  const priorMin = dep.offense_proxy_prior_minutes;
  const rating = (id: number, isD: boolean) => {
    const t = totals.get(id);
    const avg = avgRate.get(isD) ?? 1.5;
    if (!t) return avg;
    return (t.pts + (avg * priorMin) / 60) / (t.toi / 3600 + priorMin / 60);
  };

  const stmt = {
    games: db.prepare("SELECT DISTINCT game_id, game_date FROM team_game WHERE season = ? ORDER BY game_date, game_id"),
    playerGame: db.prepare(
      `SELECT player_id, team_id, is_goalie, toi, toi_5v5, toi_pp, toi_sh, g, a, fantasy_points
       FROM player_game WHERE game_id = ?`
    ),
    positions: db.prepare("SELECT player_id, position_code FROM game_rosters WHERE game_id = ?"),
    teamGame: db.prepare("SELECT team_id, secs_5v5, secs_pp, secs_pk FROM team_game WHERE game_id = ?"),
    pairs: db.prepare(
      "SELECT team_id, player_a, player_b, period, strength_state, shared_seconds FROM pair_overlap WHERE game_id = ?"
    ),
    periods: db.prepare("SELECT player_id, period, toi_5v5 FROM player_period WHERE game_id = ?"),
    faceoffs: db.prepare(
      "SELECT game_sec, event_team_id, zone FROM events WHERE game_id = ? AND type = 'faceoff' AND situation_code = '1551'"
    ),
    shifts: db.prepare("SELECT player_id, team_id, start_sec, end_sec FROM shifts WHERE game_id = ?"),
  };

  let gameCount = 0;
  for (const season of seasons) {
    for (const t of ["player_deployment", "player_opportunity", "opportunity_signal"]) {
      db.prepare(`DELETE FROM ${t} WHERE season = ?`).run(season);
    }
    db.prepare("DELETE FROM line_assignments WHERE game_id IN (SELECT game_id FROM team_game WHERE season = ?)").run(
      season
    );

    const games = stmt.games.all(season) as { game_id: number; game_date: string }[];
    const history = new Map<number, TeamGameContext[]>();
    const unitRows: Record<string, unknown>[] = [];
    const deployments: Deployment[] = [];

    for (const { game_id: gameId, game_date: gameDate } of games) {
      const pg = stmt.playerGame.all(gameId) as PlayerGameRow[];
      const pos = new Map(
        (stmt.positions.all(gameId) as { player_id: number; position_code: string }[]).map((r) => [
          r.player_id,
          r.position_code,
        ])
      );
      const teamSecs = new Map(
        (stmt.teamGame.all(gameId) as { team_id: number; secs_5v5: number; secs_pp: number; secs_pk: number }[]).map(
          (r) => [r.team_id, r]
        )
      );
      const pairs = stmt.pairs.all(gameId) as PairRow[];
      const periodToi = new Map<string, number>();
      for (const r of stmt.periods.all(gameId) as { player_id: number; period: number; toi_5v5: number }[]) {
        periodToi.set(`${r.player_id}|${r.period}`, r.toi_5v5);
      }
      const pToi = (id: number, periods: number[]) => periods.reduce((s, p) => s + (periodToi.get(`${id}|${p}`) ?? 0), 0);

      // On-ice 5v5 faceoffs by zone, from each player's own team's point of view.
      const fo = new Map<number, { O: number; N: number; D: number }>();
      const shifts = stmt.shifts.all(gameId) as { player_id: number; team_id: number; start_sec: number; end_sec: number }[];
      for (const f of stmt.faceoffs.all(gameId) as { game_sec: number; event_team_id: number; zone: string | null }[]) {
        if (!f.zone) continue;
        const seen = new Set<number>();
        for (const s of shifts) {
          if (s.start_sec > f.game_sec || s.end_sec <= f.game_sec || seen.has(s.player_id)) continue;
          seen.add(s.player_id);
          const z = (s.team_id === f.event_team_id ? f.zone : flipZone(f.zone)) as "O" | "N" | "D";
          const c = fo.get(s.player_id) ?? { O: 0, N: 0, D: 0 };
          c[z]++;
          fo.set(s.player_id, c);
        }
      }

      for (const [teamId, secs] of teamSecs) {
        const skaters = pg.filter((p) => p.team_id === teamId && !p.is_goalie);
        const teamPairs = pairs.filter((p) => p.team_id === teamId);
        const lookup = (state: string, periods?: number[]): PairSeconds =>
          pairLookup(
            teamPairs
              .filter((p) => p.strength_state === state && (!periods || periods.includes(p.period)))
              .map((p) => ({ player_a: p.player_a, player_b: p.player_b, secs: p.shared_seconds }))
          );
        const pair5 = lookup("5v5");
        const pair5p1 = lookup("5v5", [1]);
        const pair5late = lookup("5v5", [3, 4]);
        const toi5 = new Map(skaters.map((s) => [s.player_id, s.toi_5v5]));
        const isFwd = (id: number) => FORWARD.has(pos.get(id) ?? "");

        const fwd = skaters.filter((s) => isFwd(s.player_id)).map((s) => ({ id: s.player_id, secs: s.toi_5v5 }));
        const dmen = skaters.filter((s) => pos.get(s.player_id) === "D").map((s) => ({ id: s.player_id, secs: s.toi_5v5 }));
        const byToi = (id: number) => toi5.get(id) ?? 0;
        const units: Record<string, Unit[]> = {
          F: rankByToi(detectUnits(fwd, 3, 4, pair5, dep.min_unit_seconds.forward_line), byToi),
          D: rankByToi(detectUnits(dmen, 2, 3, pair5, dep.min_unit_seconds.d_pair), byToi),
          PP: detectUnits(
            skaters.map((s) => ({ id: s.player_id, secs: s.toi_pp })),
            5,
            2,
            lookup("PP"),
            dep.min_unit_seconds.pp_unit
          ).sort((a, b) => b.sharedSeconds - a.sharedSeconds),
          PK: detectUnits(
            skaters.map((s) => ({ id: s.player_id, secs: s.toi_sh })),
            4,
            2,
            lookup("PK"),
            dep.min_unit_seconds.pk_unit
          ).sort((a, b) => b.sharedSeconds - a.sharedSeconds),
        };
        const rankOf: Record<string, Map<number, number>> = {};
        for (const [type, list] of Object.entries(units)) {
          rankOf[type] = new Map();
          list.forEach((u, i) => {
            unitRows.push({
              game_id: gameId,
              team_id: teamId,
              unit_type: type,
              rank: i + 1,
              player_ids: JSON.stringify(u.players),
              shared_seconds: u.sharedSeconds,
            });
            for (const p of u.players) if (!rankOf[type].has(p)) rankOf[type].set(p, i + 1);
          });
        }

        // Team context going into this game, from its previous N games.
        const past = history.get(teamId) ?? [];
        const centerSecs = new Map<number, number>();
        const f1Count = new Map<number, number>();
        const fwdSecs = new Map<number, number>();
        for (const h of past) {
          h.centers.forEach((s, c) => centerSecs.set(c, (centerSecs.get(c) ?? 0) + s));
          h.f1.forEach((p) => f1Count.set(p, (f1Count.get(p) ?? 0) + 1));
          h.forwardToi.forEach((s, p) => fwdSecs.set(p, (fwdSecs.get(p) ?? 0) + s));
        }
        // 1C = most 5v5 TOI weighted by offense rating (SPEC 5.3), using the as-of offense proxy.
        const argmax = (m: Map<number, number>) =>
          [...m].sort((a, b) => b[1] * rating(b[0], false) - a[1] * rating(a[0], false))[0]?.[0] ?? null;
        const currentCenters = new Map(
          skaters.filter((s) => pos.get(s.player_id) === "C").map((s) => [s.player_id, s.toi_5v5])
        );
        const oneC = past.length ? argmax(centerSecs) : argmax(currentCenters);
        const topLine = past.length
          ? [...f1Count]
              .sort((a, b) => b[1] - a[1] || (fwdSecs.get(b[0]) ?? 0) - (fwdSecs.get(a[0]) ?? 0))
              .slice(0, 3)
              .map(([p]) => p)
          : (units.F[0]?.players ?? []);
        const dressed = new Set(skaters.map((s) => s.player_id));
        const oneCPlaying = oneC !== null && dressed.has(oneC);
        const topPlaying = topLine.filter((p) => dressed.has(p));

        for (const s of skaters) {
          const id = s.player_id;
          const fwdPlayer = isFwd(id);
          const p1 = pToi(id, [1]);
          const late = pToi(id, [3, 4]);
          const with1c = fwdPlayer && oneCPlaying && id !== oneC;
          const withTop = fwdPlayer && topPlaying.length > 0 && !topLine.includes(id);
          const maxWith = (look: PairSeconds) => Math.max(0, ...topPlaying.map((m) => look(id, m)));

          const row: Deployment = {
            game_id: gameId,
            player_id: id,
            team_id: teamId,
            season,
            game_date: gameDate,
            position: pos.get(id) ?? "?",
            toi_5v5: s.toi_5v5,
            toi_pp: s.toi_pp,
            toi_pk: s.toi_sh,
            team_5v5: secs.secs_5v5,
            team_pp: secs.secs_pp,
            team_pk: secs.secs_pk,
            f_line: rankOf.F.get(id) ?? null,
            d_pair: rankOf.D.get(id) ?? null,
            pp_unit: rankOf.PP.get(id) ?? null,
            pk_unit: rankOf.PK.get(id) ?? null,
            team_1c: oneC,
            with_1c: with1c ? pair5(id, oneC!) : null,
            p1_5v5: p1,
            late_5v5: late,
            p1_with_1c: with1c ? pair5p1(id, oneC!) : null,
            late_with_1c: with1c ? pair5late(id, oneC!) : null,
            p1_with_top: withTop ? maxWith(pair5p1) : null,
            late_with_top: withTop ? maxWith(pair5late) : null,
            promo_game: null,
            fo_oz: fo.get(id)?.O ?? 0,
            fo_nz: fo.get(id)?.N ?? 0,
            fo_dz: fo.get(id)?.D ?? 0,
            lmq_num: 0,
            lmq_den: 0,
            fantasy_points: s.fantasy_points,
          };

          const minSec = model.promotion.min_period_seconds;
          if (fwdPlayer && p1 >= minSec && late >= minSec) {
            const diffs: number[] = [];
            if (row.p1_with_1c !== null) diffs.push(row.late_with_1c! / late - row.p1_with_1c / p1);
            if (row.p1_with_top !== null) diffs.push(row.late_with_top! / late - row.p1_with_top / p1);
            if (diffs.length) row.promo_game = Math.max(...diffs) > model.promotion.threshold ? 1 : 0;
          }

          for (const m of skaters) {
            if (m.player_id === id) continue;
            const shared = pair5(id, m.player_id);
            if (!shared) continue;
            row.lmq_num += shared * rating(m.player_id, pos.get(m.player_id) === "D");
            row.lmq_den += shared;
          }
          deployments.push(row);
        }

        past.push({
          centers: currentCenters,
          f1: units.F[0]?.players ?? [],
          forwardToi: new Map(fwd.map((f) => [f.id, f.secs])),
        });
        history.set(teamId, past.slice(-dep.context_games));
      }

      // Ratings only learn from a game after it's over.
      for (const p of pg) {
        if (p.is_goalie) continue;
        const t = totals.get(p.player_id) ?? { pts: 0, toi: 0, isD: pos.get(p.player_id) === "D" };
        t.pts += p.g + p.a;
        t.toi += p.toi;
        totals.set(p.player_id, t);
      }
      gameCount++;
    }

    // Only 1C names appear in alert text; roster spots cover players without a landing page yet.
    const oneCGames = new Map<number, number>();
    for (const d of deployments) if (d.team_1c !== null) oneCGames.set(d.team_1c, d.game_id);
    const name = playerNames(db, [...new Set(oneCGames.values())]);
    writeSeason(db, season, unitRows, deployments, model, league, (id) => (id === null ? null : name(id)));
    console.log(`  ${season}: ${games.length} games, ${deployments.length} player-games`);
  }
  return { seasons, games: gameCount };
}

function writeSeason(
  db: ReturnType<typeof getDb>,
  season: number,
  unitRows: Record<string, unknown>[],
  deployments: Deployment[],
  model: ReturnType<typeof loadModelConfig>,
  league: ReturnType<typeof loadLeagueConfig>,
  nameOf: (id: number | null) => string | null
) {
  const od = model.opportunity_delta;
  const promo = model.promotion;

  const byPlayer = new Map<number, Deployment[]>();
  for (const d of deployments) byPlayer.set(d.player_id, [...(byPlayer.get(d.player_id) ?? []), d]);

  // Replacement level per fantasy position: the (teams x starting slots)-th best FP/GP (min 20 GP).
  const fpgp = [...byPlayer.values()]
    .filter((rows) => rows.length >= 20)
    .map((rows) => ({
      pos: FANTASY_POS[mostCommon(rows.map((r) => r.position))] ?? "?",
      fpg: rows.reduce((s, r) => s + r.fantasy_points, 0) / rows.length,
    }));
  const replacement = new Map<string, number>();
  for (const posKey of ["C", "LW", "RW", "D"]) {
    const list = fpgp.filter((x) => x.pos === posKey).map((x) => x.fpg).sort((a, b) => b - a);
    const slots = league.league.teams * ((league.league.roster as Record<string, number>)[posKey] ?? 0);
    if (list.length) replacement.set(posKey, list[Math.min(slots, list.length) - 1]);
  }

  type Pending = {
    d: Deployment;
    group: "F" | "D";
    inputs: Partial<Record<OpportunityInput, InputDetail>> | null;
    priorFpg: number | null;
    promotionGames: number;
  };
  const opportunityRows: Record<string, unknown>[] = [];
  const pending: Pending[] = [];

  for (const rows of byPlayer.values()) {
    rows.forEach((d, i) => {
      const spans: [string, Deployment[]][] = [
        ["L5", rows.slice(Math.max(0, i - 4), i + 1)],
        ["L10", rows.slice(Math.max(0, i - 9), i + 1)],
        ["SEASON", rows.slice(0, i + 1)],
      ];
      for (const [span, list] of spans) {
        opportunityRows.push({
          player_id: d.player_id,
          game_id: d.game_id,
          span,
          as_of_date: d.game_date,
          season,
          team_id: d.team_id,
          ...windowMetrics(list),
        });
      }

      const recent = rows.slice(Math.max(0, i - od.recent_games + 1), i + 1);
      const prior = rows.slice(Math.max(0, i - od.recent_games - od.prior_games + 1), Math.max(0, i - od.recent_games + 1));
      const ok = recent.length === od.recent_games && prior.length >= od.min_prior_games;
      const lastN = rows.slice(Math.max(0, i - promo.of_last + 1), i + 1);
      pending.push({
        d,
        group: d.position === "D" ? "D" : "F",
        inputs: ok ? inputDeltas(windowMetrics(recent), windowMetrics(prior)) : null,
        priorFpg: prior.length ? prior.reduce((s, r) => s + r.fantasy_points, 0) / prior.length : null,
        promotionGames: lastN.filter((r) => r.promo_game === 1).length,
      });
    });
  }

  // League-wide SD of each input's change, per position group, turns deltas into z-scores.
  const sd: Record<"F" | "D", Partial<Record<OpportunityInput, number>>> = { F: {}, D: {} };
  for (const group of ["F", "D"] as const) {
    for (const k of INPUTS) {
      const xs = pending.filter((p) => p.group === group && p.inputs?.[k]).map((p) => p.inputs![k]!.delta);
      sd[group][k] = standardDeviation(xs);
    }
  }

  const signalRows = pending.map((p) => {
    const delta = p.inputs ? opportunityDelta(p.inputs, sd[p.group], od.weights) : null;
    const posKey = FANTASY_POS[p.d.position] ?? "?";
    const repl = replacement.get(posKey);
    const rostered = p.priorFpg !== null && repl !== undefined && p.priorFpg >= repl ? 1 : 0;
    let alert: string | null = null;
    if (delta !== null && delta >= od.pickup_threshold) alert = "pickup";
    else if (delta !== null && delta <= od.downgrade_threshold && rostered) alert = "downgrade";
    const text =
      alert && p.inputs
        ? describeInputs(p.inputs, od.weights, alert === "pickup" ? 1 : -1, od.reason_min_z, nameOf(p.d.team_1c))
        : null;
    return {
      player_id: p.d.player_id,
      game_id: p.d.game_id,
      as_of_date: p.d.game_date,
      season,
      team_id: p.d.team_id,
      position: p.d.position,
      opportunity_delta: delta,
      inputs: p.inputs ? JSON.stringify(p.inputs) : null,
      promotion_games: p.promotionGames,
      promotion_flag: p.promotionGames >= promo.min_games ? 1 : 0,
      rostered_quality: rostered,
      alert,
      alert_text: text,
    };
  });

  const insertAll = (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const st = db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
    for (const r of rows) st.run(r);
  };
  db.transaction(() => {
    insertAll("line_assignments", unitRows);
    insertAll("player_deployment", deployments as unknown as Record<string, unknown>[]);
    insertAll("player_opportunity", opportunityRows);
    insertAll("opportunity_signal", signalRows);
  })();
}

function mostCommon(xs: string[]): string {
  const c = new Map<string, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
}
