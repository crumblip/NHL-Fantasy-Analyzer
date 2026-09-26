const WEB = "https://api-web.nhle.com/v1";
const STATS = "https://api.nhle.com/stats/rest/en";

// Every URL here was verified against a live response; see tests/fixtures/ and NOTES.md.
export const endpoints = {
  seasons: () => `${WEB}/season`,
  standingsSeasons: () => `${WEB}/standings-season`,
  scheduleCalendar: (date: string) => `${WEB}/schedule-calendar/${date}`,
  clubScheduleSeason: (team: string, season: number) => `${WEB}/club-schedule-season/${team}/${season}`,
  roster: (team: string, season: number | "current") => `${WEB}/roster/${team}/${season}`,
  playerLanding: (playerId: number) => `${WEB}/player/${playerId}/landing`,
  playerGameLog: (playerId: number, season: number, gameType = 2) =>
    `${WEB}/player/${playerId}/game-log/${season}/${gameType}`,
  playByPlay: (gameId: number) => `${WEB}/gamecenter/${gameId}/play-by-play`,
  boxscore: (gameId: number) => `${WEB}/gamecenter/${gameId}/boxscore`,
  shiftCharts: (gameId: number) => `${STATS}/shiftcharts?cayenneExp=gameId=${gameId}`,
  skaterToiByDate: (date: string, gameType = 2) =>
    `${STATS}/skater/timeonice?isAggregate=false&isGame=true&limit=-1&cayenneExp=${encodeURIComponent(
      `gameDate="${date}" and gameTypeId=${gameType}`
    )}`,
};
