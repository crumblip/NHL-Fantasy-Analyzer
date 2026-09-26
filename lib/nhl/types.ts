// Only the fields we read. Shapes taken from real responses in tests/fixtures/.

export interface LocalizedName {
  default: string;
  [lang: string]: string;
}

export interface StandingsSeason {
  id: number;
  standingsStart: string;
  standingsEnd: string;
}

export interface CalendarTeam {
  id: number;
  seasonId: number;
  abbrev: string;
  name: LocalizedName;
  logo: string;
  darkLogo: string;
}

export interface ScheduleTeam {
  id: number;
  abbrev: string;
  score?: number;
}

export interface ScheduleGame {
  id: number;
  season: number;
  gameType: number;
  gameDate: string;
  startTimeUTC: string;
  neutralSite: boolean;
  gameState: string;
  gameScheduleState: string;
  awayTeam: ScheduleTeam;
  homeTeam: ScheduleTeam;
  gameOutcome?: { lastPeriodType: "REG" | "OT" | "SO" };
}

export interface RosterPlayer {
  id: number;
  headshot: string;
  firstName: LocalizedName;
  lastName: LocalizedName;
  sweaterNumber?: number;
  positionCode: string;
  shootsCatches: string;
  heightInInches: number;
  weightInPounds: number;
  birthDate: string;
  birthCountry?: string;
}

export interface Roster {
  forwards: RosterPlayer[];
  defensemen: RosterPlayer[];
  goalies: RosterPlayer[];
}

export interface SeasonTotal {
  season: number;
  gameTypeId: number;
  leagueAbbrev: string;
  sequence: number;
  teamName: LocalizedName;
  gamesPlayed: number;
  goals?: number;
  assists?: number;
  points?: number;
  pim?: number;
}

export interface PlayerLanding {
  playerId: number;
  isActive: boolean;
  currentTeamAbbrev?: string;
  firstName: LocalizedName;
  lastName: LocalizedName;
  sweaterNumber?: number;
  position: string;
  headshot: string;
  heightInInches?: number;
  weightInPounds?: number;
  birthDate?: string;
  birthCity?: LocalizedName;
  birthCountry?: string;
  shootsCatches?: string;
  draftDetails?: {
    year: number;
    teamAbbrev: string;
    round: number;
    pickInRound: number;
    overallPick: number;
  };
  seasonTotals?: SeasonTotal[];
}

export interface RosterSpot {
  teamId: number;
  playerId: number;
  sweaterNumber: number;
  positionCode: string;
}

export interface PbpPlay {
  eventId: number;
  sortOrder: number;
  periodDescriptor: { number: number; periodType: "REG" | "OT" | "SO" };
  timeInPeriod: string;
  situationCode?: string;
  /** The side of the rink (x > 0 = "right") where the home team's own net is. */
  homeTeamDefendingSide?: "left" | "right";
  typeDescKey: string;
  details?: {
    eventOwnerTeamId?: number;
    xCoord?: number;
    yCoord?: number;
    zoneCode?: string;
    shotType?: string;
    shootingPlayerId?: number;
    scoringPlayerId?: number;
    assist1PlayerId?: number;
    assist2PlayerId?: number;
    goalieInNetId?: number;
    hittingPlayerId?: number;
    hitteePlayerId?: number;
    blockingPlayerId?: number;
    reason?: string;
    committedByPlayerId?: number;
    drawnByPlayerId?: number;
    servedByPlayerId?: number;
    typeCode?: string;
    descKey?: string;
    duration?: number;
    winningPlayerId?: number;
    losingPlayerId?: number;
  };
}

export interface PlayByPlay {
  id: number;
  gameState: string;
  homeTeam: { id: number };
  awayTeam: { id: number };
  plays: PbpPlay[];
  rosterSpots: RosterSpot[];
}

export interface BoxscoreSkater {
  playerId: number;
  position: string;
  toi: string;
  goals?: number;
  assists?: number;
  sog?: number;
  hits?: number;
  blockedShots?: number;
  pim?: number;
  powerPlayGoals?: number;
}

export interface BoxscoreGoalie {
  playerId: number;
  position: string;
  toi: string;
  starter?: boolean;
  decision?: "W" | "L" | "O";
  saves?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
}

export interface Boxscore {
  id: number;
  gameState: string;
  playerByGameStats: Record<
    "awayTeam" | "homeTeam",
    { forwards: BoxscoreSkater[]; defense: BoxscoreSkater[]; goalies: BoxscoreGoalie[] }
  >;
}

export interface ShiftRow {
  playerId: number;
  teamId: number;
  typeCode: number;
  period: number;
  startTime: string;
  endTime: string;
  duration: string | null;
}

export interface StatsResponse<T> {
  data: T[];
  total: number;
}

export interface SkaterToiRow {
  gameId: number;
  playerId: number;
  timeOnIce: number;
  evTimeOnIce: number;
  ppTimeOnIce: number;
  shTimeOnIce: number;
}
