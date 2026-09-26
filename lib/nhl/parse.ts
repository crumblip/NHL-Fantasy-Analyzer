import type {
  Boxscore,
  PlayerLanding,
  Roster,
  RosterPlayer,
  ScheduleGame,
  ShiftRow,
} from "./types";

export const SHIFT_TYPE = 517;

export function mmssToSec(s: string | null | undefined): number {
  if (!s) return 0;
  const [m, sec] = s.split(":").map(Number);
  return m * 60 + sec;
}

export interface GameRow {
  id: number;
  season: number;
  game_type: number;
  game_date: string;
  start_time_utc: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_score: number | null;
  away_score: number | null;
  game_state: string;
  schedule_state: string;
  last_period_type: string | null;
  neutral_site: number;
}

export function parseScheduleGame(g: ScheduleGame): GameRow {
  return {
    id: g.id,
    season: g.season,
    game_type: g.gameType,
    game_date: g.gameDate,
    start_time_utc: g.startTimeUTC,
    home_team_id: g.homeTeam.id,
    home_abbrev: g.homeTeam.abbrev,
    away_team_id: g.awayTeam.id,
    away_abbrev: g.awayTeam.abbrev,
    home_score: g.homeTeam.score ?? null,
    away_score: g.awayTeam.score ?? null,
    game_state: g.gameState,
    schedule_state: g.gameScheduleState,
    last_period_type: g.gameOutcome?.lastPeriodType ?? null,
    neutral_site: g.neutralSite ? 1 : 0,
  };
}

/** Played to completion, or never going to be (cancelled). */
export function isSettled(g: ScheduleGame): boolean {
  return g.gameState === "OFF" || g.gameScheduleState === "CNCL";
}

export function rosterPlayers(r: Roster): RosterPlayer[] {
  return [...r.forwards, ...r.defensemen, ...r.goalies];
}

export interface PlayerRow {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string | null;
  shoots: string | null;
  birth_date: string | null;
  birth_city: string | null;
  birth_country: string | null;
  height_in: number | null;
  weight_lb: number | null;
  headshot_url: string | null;
  sweater_number: number | null;
  current_team: string | null;
  is_active: number;
  draft_year: number | null;
  draft_team: string | null;
  draft_round: number | null;
  draft_pick_in_round: number | null;
  draft_overall: number | null;
}

export interface SeasonTotalRow {
  player_id: number;
  season: number;
  game_type: number;
  league: string;
  sequence: number;
  team: string | null;
  gp: number | null;
  g: number | null;
  a: number | null;
  pts: number | null;
  pim: number | null;
}

export function parseLanding(l: PlayerLanding): { player: PlayerRow; totals: SeasonTotalRow[] } {
  const first = l.firstName.default;
  const last = l.lastName.default;
  const d = l.draftDetails;
  return {
    player: {
      id: l.playerId,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`,
      position: l.position ?? null,
      shoots: l.shootsCatches ?? null,
      birth_date: l.birthDate ?? null,
      birth_city: l.birthCity?.default ?? null,
      birth_country: l.birthCountry ?? null,
      height_in: l.heightInInches ?? null,
      weight_lb: l.weightInPounds ?? null,
      headshot_url: l.headshot || null,
      sweater_number: l.sweaterNumber ?? null,
      current_team: l.currentTeamAbbrev ?? null,
      is_active: l.isActive ? 1 : 0,
      draft_year: d?.year ?? null,
      draft_team: d?.teamAbbrev ?? null,
      draft_round: d?.round ?? null,
      draft_pick_in_round: d?.pickInRound ?? null,
      draft_overall: d?.overallPick ?? null,
    },
    totals: (l.seasonTotals ?? []).map((s) => ({
      player_id: l.playerId,
      season: s.season,
      game_type: s.gameTypeId,
      league: s.leagueAbbrev,
      sequence: s.sequence,
      team: s.teamName?.default ?? null,
      gp: s.gamesPlayed ?? null,
      g: s.goals ?? null,
      a: s.assists ?? null,
      pts: s.points ?? null,
      pim: s.pim ?? null,
    })),
  };
}

/** Players the boxscore credits with ice time but who have no shift rows at all. */
export function playersMissingShifts(box: Boxscore, shifts: ShiftRow[]): number[] {
  const withShifts = new Set(shifts.filter((s) => s.typeCode === SHIFT_TYPE).map((s) => s.playerId));
  const missing: number[] = [];
  for (const side of ["awayTeam", "homeTeam"] as const) {
    const t = box.playerByGameStats[side];
    for (const p of [...t.forwards, ...t.defense, ...t.goalies]) {
      if (mmssToSec(p.toi) > 0 && !withShifts.has(p.playerId)) missing.push(p.playerId);
    }
  }
  return missing;
}

export function boxscorePlayerCount(box: Boxscore): number {
  let n = 0;
  for (const side of ["awayTeam", "homeTeam"] as const) {
    const t = box.playerByGameStats[side];
    n += t.forwards.length + t.defense.length + t.goalies.length;
  }
  return n;
}
