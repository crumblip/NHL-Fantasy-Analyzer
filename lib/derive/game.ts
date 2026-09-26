import type { LeagueConfig } from "../config";
import { mmssToSec, SHIFT_TYPE } from "../nhl/parse";
import type { Boxscore, PbpPlay, PlayByPlay, ShiftRow, SkaterToiRow } from "../nhl/types";
import { goaliePoints, skaterPoints } from "../scoring";
import {
  buildTimeline,
  gameSec,
  periodOf,
  situationCode,
  strengthState,
  timelineSegments,
  type Side,
  type StrengthState,
  type TimelineEvent,
} from "./timeline";

export interface GameInput {
  game: { id: number; season: number; game_date: string };
  pbp: PlayByPlay;
  box: Boxscore;
  shifts: ShiftRow[];
  officialToi: SkaterToiRow[];
  /** Fantasy eligibility: position override, else landing position; falls back to the game roster. */
  positions: Map<number, string>;
  scoring: LeagueConfig["scoring"];
}

const MAX_PERIOD = 4; // regular-season OT; the shootout (period 5) is excluded everywhere
const flipZone = (z: string) => (z === "O" ? "D" : z === "D" ? "O" : z);

export function deriveGame(input: GameInput) {
  const { game, pbp, box, scoring } = input;
  const gameId = game.id;
  const sideOf = (teamId: number | undefined): Side | undefined =>
    teamId === pbp.homeTeam.id ? "home" : teamId === pbp.awayTeam.id ? "away" : undefined;

  const rosterPos = new Map(pbp.rosterSpots.map((r) => [r.playerId, r.positionCode]));
  const playerTeam = new Map(pbp.rosterSpots.map((r) => [r.playerId, r.teamId]));
  const goalies = new Set(pbp.rosterSpots.filter((r) => r.positionCode === "G").map((r) => r.playerId));

  const plays = pbp.plays
    .filter((p) => p.periodDescriptor.periodType !== "SO" && p.periodDescriptor.number <= MAX_PERIOD)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const secOf = (p: PbpPlay) => gameSec(p.periodDescriptor.number, p.timeInPeriod);
  const endSec = Math.max(...plays.map(secOf));

  // ---- shifts and per-second on-ice sets
  const shiftRows = input.shifts
    .filter((s) => s.typeCode === SHIFT_TYPE && s.period <= MAX_PERIOD)
    .map((s) => ({
      game_id: gameId,
      player_id: s.playerId,
      team_id: s.teamId,
      period: s.period,
      start_sec: (s.period - 1) * 1200 + mmssToSec(s.startTime),
      end_sec: Math.min(endSec, (s.period - 1) * 1200 + mmssToSec(s.endTime)),
    }))
    .filter((s) => s.end_sec > s.start_sec);

  const onIce: Record<Side, number[][]> = {
    home: Array.from({ length: endSec }, () => []),
    away: Array.from({ length: endSec }, () => []),
  };
  for (const s of shiftRows) {
    const side = sideOf(s.team_id);
    if (!side) continue;
    for (let t = s.start_sec; t < s.end_sec; t++) {
      const list = onIce[side][t];
      if (!list.includes(s.player_id)) list.push(s.player_id);
    }
  }
  const goalieIn = (side: Side) =>
    Uint8Array.from(onIce[side], (list) => (list.some((p) => goalies.has(p)) ? 1 : 0));

  // ---- strength timeline
  const tlEvents: TimelineEvent[] = plays.map((p) => ({
    sec: secOf(p),
    period: p.periodDescriptor.number,
    kind:
      p.typeDescKey === "goal"
        ? "goal"
        : p.typeDescKey === "penalty"
          ? "penalty"
          : ["stoppage", "faceoff", "period-end"].includes(p.typeDescKey)
            ? "stoppage"
            : "other",
    side: sideOf(p.details?.eventOwnerTeamId),
    playerId: p.details?.committedByPlayerId ?? p.details?.servedByPlayerId,
    penaltyType: p.details?.typeCode,
    penaltyMinutes: p.details?.duration,
  }));
  const tl = buildTimeline(endSec, tlEvents, goalieIn("home"), goalieIn("away"));
  const sk = { home: tl.homeSkaters, away: tl.awaySkaters };
  const gIn = { home: tl.homeGoalieIn, away: tl.awayGoalieIn };

  // ---- events
  const eventRows = plays.map((p, i) => {
    const d = p.details ?? {};
    const t = secOf(p);
    const st = tl.eventState[i];
    // Play-ending events see the ice as it was during the last second of play (a goalie
    // returning at the whistle hasn't come back yet); faceoffs see the new state.
    const startsPlay = p.typeDescKey === "faceoff" || p.typeDescKey === "period-start";
    const periodStart = (p.periodDescriptor.number - 1) * 1200;
    const tc = Math.min(startsPlay || t === periodStart ? t : t - 1, endSec - 1);
    const side = sideOf(d.eventOwnerTeamId);
    const strength = side
      ? st[side] > st[side === "home" ? "away" : "home"]
        ? "PP"
        : st[side] < st[side === "home" ? "away" : "home"]
          ? "SH"
          : "EV"
      : null;
    return {
      game_id: gameId,
      event_id: p.eventId,
      sort_order: p.sortOrder,
      period: p.periodDescriptor.number,
      game_sec: t,
      type: p.typeDescKey,
      event_team_id: d.eventOwnerTeamId ?? null,
      situation_code: p.situationCode ?? null,
      derived_situation_code: situationCode(st.home, st.away, gIn.home[tc] === 1, gIn.away[tc] === 1),
      strength,
      zone: d.zoneCode ?? null,
      x: d.xCoord ?? null,
      y: d.yCoord ?? null,
      shot_type: d.shotType ?? null,
      shooter_id: d.shootingPlayerId ?? null,
      scorer_id: d.scoringPlayerId ?? null,
      assist1_id: d.assist1PlayerId ?? null,
      assist2_id: d.assist2PlayerId ?? null,
      goalie_id: d.goalieInNetId ?? null,
      hitter_id: d.hittingPlayerId ?? null,
      hittee_id: d.hitteePlayerId ?? null,
      blocker_id: d.blockingPlayerId ?? null,
      block_reason: d.reason ?? null,
      penalized_id: d.committedByPlayerId ?? null,
      drawn_by_id: d.drawnByPlayerId ?? null,
      served_by_id: d.servedByPlayerId ?? null,
      penalty_type: p.typeDescKey === "penalty" ? (d.typeCode ?? null) : null,
      penalty_desc: p.typeDescKey === "penalty" ? (d.descKey ?? null) : null,
      penalty_minutes: p.typeDescKey === "penalty" ? (d.duration ?? null) : null,
      faceoff_winner_id: d.winningPlayerId ?? null,
      faceoff_loser_id: d.losingPlayerId ?? null,
      shooter_team_id: null as number | null,
      shot_distance: null as number | null,
      shot_angle: null as number | null,
      is_rebound: null as number | null,
      is_rush: null as number | null,
      empty_net: null as number | null,
      xg: null as number | null,
    };
  });

  // ---- shot geometry and context for the xG model
  const SHOTS = new Set(["goal", "shot-on-goal", "missed-shot", "blocked-shot"]);
  const ATTEMPTS = new Set(["shot-on-goal", "missed-shot", "blocked-shot"]);
  // Blocked shots belong to the shooting team, but their zone code is from the blocker's view.
  const zoneFor = (e: (typeof eventRows)[number], teamId: number): string | null => {
    if (!e.zone || !e.event_team_id) return null;
    const ownerView = e.type === "blocked-shot" ? flipZone(e.zone) : e.zone;
    return e.event_team_id === teamId ? ownerView : flipZone(ownerView);
  };
  eventRows.forEach((e, i) => {
    if (!SHOTS.has(e.type) || !e.event_team_id) return;
    const p = plays[i];
    const side = sideOf(e.event_team_id);
    e.shooter_team_id = e.event_team_id;
    if (e.x !== null && e.y !== null && side) {
      let netX: number;
      if (p.homeTeamDefendingSide) {
        const homeAttacksLeft = p.homeTeamDefendingSide === "right";
        netX = (side === "home") === homeAttacksLeft ? -89 : 89;
      } else {
        netX = e.x >= 0 ? 89 : -89; // no side info: assume the shot is in its attacking half
      }
      const dx = netX > 0 ? netX - e.x : e.x - netX; // positive in front of the goal line
      e.shot_distance = Math.round(Math.hypot(dx, e.y) * 10) / 10;
      e.shot_angle = Math.round(((Math.atan2(Math.abs(e.y), dx) * 180) / Math.PI) * 10) / 10;
    }
    if (e.type !== "blocked-shot") e.empty_net = e.goalie_id ? 0 : 1;

    e.is_rebound = 0;
    e.is_rush = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = eventRows[j];
      if (prev.period !== e.period || e.game_sec - prev.game_sec > 4) break;
      if (e.game_sec - prev.game_sec <= 3 && ATTEMPTS.has(prev.type) && prev.event_team_id === e.event_team_id) {
        e.is_rebound = 1;
      }
    }
    for (let j = i - 1; j >= 0; j--) {
      const prev = eventRows[j];
      if (prev.period !== e.period || e.game_sec - prev.game_sec > 4) break;
      const z = zoneFor(prev, e.event_team_id);
      if (z === null) continue;
      if (z === "N" || z === "D") e.is_rush = 1;
      break;
    }
  });

  // ---- on-ice goals for, by strength from the scoring team's view (for IPP)
  const onIceGf = new Map<number, { ev: number; pp: number; sh: number }>();
  eventRows.forEach((e) => {
    if (e.type !== "goal" || !e.event_team_id) return;
    const side = sideOf(e.event_team_id);
    if (!side) return;
    const t = Math.min(Math.max(0, e.game_sec - 1), endSec - 1);
    const k = e.strength === "PP" ? "pp" : e.strength === "SH" ? "sh" : "ev";
    for (const pid of onIce[side][t] ?? []) {
      if (goalies.has(pid)) continue;
      const r = onIceGf.get(pid) ?? { ev: 0, pp: 0, sh: 0 };
      r[k]++;
      onIceGf.set(pid, r);
    }
  });

  // ---- per-player TOI by strength and pair overlap
  type Toi = { toi: number; ev: number; pp: number; sh: number; v5: number };
  const toi = new Map<number, Toi>();
  const pairs = new Map<string, number>();
  const periodToi = new Map<string, { v5: number; pp: number; sh: number }>();
  const teamSecs: Record<Side, { v5: number; ev: number; pp: number; pk: number }> = {
    home: { v5: 0, ev: 0, pp: 0, pk: 0 },
    away: { v5: 0, ev: 0, pp: 0, pk: 0 },
  };
  const stateAt = (side: Side, t: number): StrengthState =>
    strengthState(
      sk[side][t],
      sk[side === "home" ? "away" : "home"][t],
      gIn.home[t] === 1 && gIn.away[t] === 1
    );

  for (const side of ["home", "away"] as const) {
    let segKey = "";
    let segStart = 0;
    let segPlayers: number[] = [];
    let segMeta = { period: 1, state: "5v5" as StrengthState };
    const flush = (end: number) => {
      const len = end - segStart;
      if (len <= 0 || segPlayers.length < 2) return;
      for (let i = 0; i < segPlayers.length; i++) {
        for (let j = i + 1; j < segPlayers.length; j++) {
          const k = `${segPlayers[i]}|${segPlayers[j]}|${segMeta.period}|${segMeta.state}`;
          pairs.set(k, (pairs.get(k) ?? 0) + len);
        }
      }
    };

    for (let t = 0; t < endSec; t++) {
      const state = stateAt(side, t);
      const period = periodOf(t);
      const ts = teamSecs[side];
      if (state === "PP") ts.pp++;
      else if (state === "PK") ts.pk++;
      else ts.ev++;
      if (state === "5v5") ts.v5++;

      const players = onIce[side][t];
      for (const pid of players) {
        let r = toi.get(pid);
        if (!r) toi.set(pid, (r = { toi: 0, ev: 0, pp: 0, sh: 0, v5: 0 }));
        r.toi++;
        if (state === "PP") r.pp++;
        else if (state === "PK") r.sh++;
        else r.ev++;
        if (state === "5v5") r.v5++;

        const pk = `${pid}|${period}`;
        let pr = periodToi.get(pk);
        if (!pr) periodToi.set(pk, (pr = { v5: 0, pp: 0, sh: 0 }));
        if (state === "5v5") pr.v5++;
        else if (state === "PP") pr.pp++;
        else if (state === "PK") pr.sh++;
      }
      const skaters = players.filter((p) => !goalies.has(p)).sort((a, b) => a - b);
      const key = `${period}|${state}|${skaters.join(",")}`;
      if (key !== segKey) {
        flush(t);
        segKey = key;
        segStart = t;
        segPlayers = skaters;
        segMeta = { period, state };
      }
    }
    flush(endSec);
  }

  const pairRows = [...pairs].map(([k, secs]) => {
    const [a, b, period, state] = k.split("|");
    return {
      game_id: gameId,
      team_id: playerTeam.get(Number(a)) ?? 0,
      player_a: Number(a),
      player_b: Number(b),
      period: Number(period),
      strength_state: state,
      shared_seconds: secs,
    };
  });

  // ---- per-player counting stats from play-by-play (PP/SH splits, primary assists, faceoffs)
  type Pbp = { a1: number; a2: number; ppg: number; ppa: number; shg: number; sha: number; fow: number; fol: number };
  const pbpStats = new Map<number, Pbp>();
  const bump = (pid: number | undefined, k: keyof Pbp) => {
    if (!pid) return;
    let r = pbpStats.get(pid);
    if (!r) pbpStats.set(pid, (r = { a1: 0, a2: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, fow: 0, fol: 0 }));
    r[k]++;
  };
  for (const e of eventRows) {
    if (e.type === "goal") {
      bump(e.assist1_id ?? undefined, "a1");
      bump(e.assist2_id ?? undefined, "a2");
      if (e.strength === "PP") {
        bump(e.scorer_id ?? undefined, "ppg");
        bump(e.assist1_id ?? undefined, "ppa");
        bump(e.assist2_id ?? undefined, "ppa");
      } else if (e.strength === "SH") {
        bump(e.scorer_id ?? undefined, "shg");
        bump(e.assist1_id ?? undefined, "sha");
        bump(e.assist2_id ?? undefined, "sha");
      }
    } else if (e.type === "faceoff") {
      bump(e.faceoff_winner_id ?? undefined, "fow");
      bump(e.faceoff_loser_id ?? undefined, "fol");
    }
  }

  // ---- player_game: official counts from the boxscore, splits from play-by-play, TOI from shifts
  const official = new Map(input.officialToi.map((r) => [r.playerId, r]));
  const rows: Record<string, unknown>[] = [];
  const zero: Pbp = { a1: 0, a2: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, fow: 0, fol: 0 };
  for (const [side, teamKey] of [
    ["home", "homeTeam"],
    ["away", "awayTeam"],
  ] as const) {
    const teamId = side === "home" ? pbp.homeTeam.id : pbp.awayTeam.id;
    const t = box.playerByGameStats[teamKey];
    for (const s of [...t.forwards, ...t.defense]) {
      const ps = pbpStats.get(s.playerId) ?? zero;
      const ti = toi.get(s.playerId);
      const off = official.get(s.playerId);
      const position = input.positions.get(s.playerId) ?? rosterPos.get(s.playerId) ?? s.position;
      const line = {
        g: s.goals ?? 0,
        a: s.assists ?? 0,
        pim: s.pim ?? 0,
        ppp: ps.ppg + ps.ppa,
        shp: ps.shg + ps.sha,
        sog: s.sog ?? 0,
        hit: s.hits ?? 0,
        blk: s.blockedShots ?? 0,
      };
      rows.push({
        game_id: gameId,
        player_id: s.playerId,
        team_id: teamId,
        season: game.season,
        game_date: game.game_date,
        position,
        is_goalie: 0,
        toi: ti?.toi ?? 0,
        toi_ev: ti?.ev ?? 0,
        toi_pp: ti?.pp ?? 0,
        toi_sh: ti?.sh ?? 0,
        toi_5v5: ti?.v5 ?? 0,
        boxscore_toi: mmssToSec(s.toi),
        official_toi: off?.timeOnIce ?? null,
        official_ev: off?.evTimeOnIce ?? null,
        official_pp: off?.ppTimeOnIce ?? null,
        official_sh: off?.shTimeOnIce ?? null,
        ...line,
        a1: ps.a1,
        a2: ps.a2,
        ppg: ps.ppg,
        ppa: ps.ppa,
        shg: ps.shg,
        sha: ps.sha,
        boxscore_ppg: s.powerPlayGoals ?? null,
        gf_ev: onIceGf.get(s.playerId)?.ev ?? 0,
        gf_pp: onIceGf.get(s.playerId)?.pp ?? 0,
        gf_sh: onIceGf.get(s.playerId)?.sh ?? 0,
        fow: ps.fow,
        fol: ps.fol,
        gs: 0, w: 0, l: 0, otl: 0, sa: 0, sv: 0, ga: 0, so: 0,
        fantasy_points: skaterPoints(line, position === "D", scoring),
      });
    }

    const played = t.goalies.filter((g) => mmssToSec(g.toi) > 0);
    for (const g of played) {
      const ti = toi.get(g.playerId);
      const line = {
        w: g.decision === "W" ? 1 : 0,
        otl: g.decision === "O" ? 1 : 0,
        sv: g.saves ?? 0,
        ga: g.goalsAgainst ?? 0,
        so: g.decision === "W" && (g.goalsAgainst ?? 0) === 0 && played.length === 1 ? 1 : 0,
      };
      rows.push({
        game_id: gameId,
        player_id: g.playerId,
        team_id: teamId,
        season: game.season,
        game_date: game.game_date,
        position: "G",
        is_goalie: 1,
        toi: ti?.toi ?? 0,
        toi_ev: ti?.ev ?? 0,
        toi_pp: ti?.pp ?? 0,
        toi_sh: ti?.sh ?? 0,
        toi_5v5: ti?.v5 ?? 0,
        boxscore_toi: mmssToSec(g.toi),
        official_toi: null, official_ev: null, official_pp: null, official_sh: null,
        g: 0, a: 0, a1: 0, a2: 0, sog: 0, hit: 0, blk: 0, pim: 0,
        ppg: 0, ppa: 0, shg: 0, sha: 0, ppp: 0, shp: 0, boxscore_ppg: null,
        gf_ev: 0, gf_pp: 0, gf_sh: 0, fow: 0, fol: 0,
        gs: g.starter ? 1 : 0,
        w: line.w,
        l: g.decision === "L" ? 1 : 0,
        otl: line.otl,
        sa: g.shotsAgainst ?? 0,
        sv: line.sv,
        ga: line.ga,
        so: line.so,
        fantasy_points: goaliePoints(line, scoring),
      });
    }
  }

  const playerPeriods = [...periodToi].map(([k, v]) => {
    const [pid, period] = k.split("|").map(Number);
    return { game_id: gameId, player_id: pid, period, toi_5v5: v.v5, toi_pp: v.pp, toi_sh: v.sh };
  });
  const teamGames = (["home", "away"] as const).map((side) => ({
    game_id: gameId,
    team_id: side === "home" ? pbp.homeTeam.id : pbp.awayTeam.id,
    opponent_id: side === "home" ? pbp.awayTeam.id : pbp.homeTeam.id,
    season: game.season,
    game_date: game.game_date,
    is_home: side === "home" ? 1 : 0,
    secs_5v5: teamSecs[side].v5,
    secs_ev: teamSecs[side].ev,
    secs_pp: teamSecs[side].pp,
    secs_pk: teamSecs[side].pk,
  }));

  return {
    shifts: shiftRows,
    events: eventRows,
    timeline: timelineSegments(tl).map((s) => ({ game_id: gameId, ...s })),
    playerGame: rows,
    pairs: pairRows,
    playerPeriods,
    teamGames,
  };
}
