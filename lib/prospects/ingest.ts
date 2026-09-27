import { getDb } from "../db";
import { ingestLandings } from "../ingest";
import { endpoints } from "../nhl/endpoints";
import { DAY, fetchJson } from "../nhl/http";
import type { StatsResponse } from "../nhl/types";

interface DraftRow {
  draftYear: number;
  overallPickNumber: number;
  roundNumber: number;
  pickInRound: number | null;
  playerId: number | null;
  playerName: string | null;
  triCode: string | null;
  position: string | null;
  amateurLeague: string | null;
  amateurClubName: string | null;
  birthDate: string | null;
  height: number | null;
  weight: number | null;
}

interface SummaryRow {
  playerId: number;
  seasonId: number;
  positionCode: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  penaltyMinutes: number;
  ppPoints: number;
  shPoints: number;
  shots: number;
  timeOnIcePerGame: number | null;
}

interface RealtimeRow {
  playerId: number;
  seasonId: number;
  hits: number | null;
  blockedShots: number | null;
}

const thisYear = () => new Date().getUTCFullYear();

export async function ingestDraft(years: number[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO draft_picks (draft_year, overall, round, pick_in_round, player_id, player_name, team,
      position, amateur_league, amateur_club, birth_date, height_in, weight_lb)
    VALUES (@draft_year, @overall, @round, @pick_in_round, @player_id, @player_name, @team,
      @position, @amateur_league, @amateur_club, @birth_date, @height_in, @weight_lb)`);
  let picks = 0;
  for (const year of years) {
    const res = await fetchJson<StatsResponse<DraftRow>>(endpoints.draftPicks(year), {
      maxAgeMs: DAY,
      final: () => year < thisYear(),
    });
    db.transaction(() => {
      for (const d of res.data) {
        upsert.run({
          draft_year: d.draftYear,
          overall: d.overallPickNumber,
          round: d.roundNumber,
          pick_in_round: d.pickInRound,
          player_id: d.playerId,
          player_name: d.playerName,
          team: d.triCode,
          position: d.position,
          amateur_league: d.amateurLeague,
          amateur_club: d.amateurClubName,
          birth_date: d.birthDate,
          height_in: d.height,
          weight_lb: d.weight,
        });
      }
    })();
    picks += res.data.length;
  }
  console.log(`  ${picks} picks across ${years.length} drafts`);
}

export async function ingestNhlSeasons(seasons: number[], currentSeason: number) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO nhl_skater_seasons (player_id, season, position, gp, g, a, pts, pim, ppp, shp, sog, hit, blk, toi_per_game)
    VALUES (@player_id, @season, @position, @gp, @g, @a, @pts, @pim, @ppp, @shp, @sog, @hit, @blk, @toi_per_game)`);
  for (const season of seasons) {
    const opts = season < currentSeason ? {} : { maxAgeMs: DAY };
    const [summary, realtime] = await Promise.all([
      fetchJson<StatsResponse<SummaryRow>>(endpoints.skaterSeasonSummary(season), opts),
      fetchJson<StatsResponse<RealtimeRow>>(endpoints.skaterSeasonRealtime(season), opts),
    ]);
    if (summary.data.length < summary.total) console.warn(`  ! ${season} summary truncated`);
    const rt = new Map(realtime.data.map((r) => [r.playerId, r]));
    db.transaction(() => {
      for (const s of summary.data) {
        const r = rt.get(s.playerId);
        upsert.run({
          player_id: s.playerId,
          season: s.seasonId,
          position: s.positionCode,
          gp: s.gamesPlayed,
          g: s.goals,
          a: s.assists,
          pts: s.points,
          pim: s.penaltyMinutes,
          ppp: s.ppPoints,
          shp: s.shPoints,
          sog: s.shots,
          hit: r?.hits ?? null,
          blk: r?.blockedShots ?? null,
          toi_per_game: s.timeOnIcePerGame,
        });
      }
    })();
  }
  console.log(`  NHL skater seasons: ${seasons[0]} → ${seasons[seasons.length - 1]}`);
}

/** Landing pages for every drafted skater we don't have yet (or whose page is stale). */
export async function ingestDraftedLandings() {
  const db = getDb();
  const ids = (
    db
      .prepare(
        `SELECT DISTINCT d.player_id FROM draft_picks d
         WHERE d.player_id IS NOT NULL AND COALESCE(d.position, '') != 'G'`
      )
      .all() as { player_id: number }[]
  ).map((r) => r.player_id);
  await ingestLandings(ids, "drafted player landings");
}
