# Data notes

Quirks found in the NHL endpoints, verified against live responses (samples in `tests/fixtures/`).

## Differences from SPEC.md

- **Boxscore has no PP or SH TOI.** `/v1/gamecenter/{id}/boxscore` gives only total `toi` ("MM:SS") per skater, plus `shifts`. The strength split comes from the Stats API instead: `/stats/rest/en/skater/timeonice?isAggregate=false&isGame=true&cayenneExp=gameDate="YYYY-MM-DD" and gameTypeId=2` returns `evTimeOnIce`, `ppTimeOnIce`, `shTimeOnIce`, `timeOnIce` in **seconds**, one row per skater per game. This is the Phase 2 reconciliation target. Goalies aren't in it (use the boxscore goalie `toi`).
- **Team lists per season** come from `/v1/schedule-calendar/{date}` (`teams[]`, tagged with `seasonId`), not standings. It correctly returns ARI for 2023-24 and UTA from 2024-25 on.

## Endpoint behaviour

- `gameState`: `FUT` → `PRE` → `LIVE` → `CRIT` → `FINAL` → `OFF`. Only `OFF` (official) games are fetched and cached forever; `FINAL` data can still be corrected.
- The Stats API caps every response at **10,000 rows** even with `limit=-1` (a full season of per-game skater TOI is ~47k rows). Fetching per game date stays far below the cap.
- `/v1/roster/ARI/20232024` returns empty arrays even though `/v1/roster-season/ARI` lists 20232024. Players are therefore also collected from each game's `rosterSpots` in play-by-play, which covers call-ups too.
- `/v1/roster/{team}/current` headshot URLs point at the upcoming season's folder (`/mugs/nhl/20262027/...`). Always use the landing page `headshot` field.
- `club-schedule-season` includes preseason (`gameType` 1). Only `gameType` 2 is ingested. Global Series games in Europe are regular season with `neutralSite: true`.
- Web API responses have `Cache-Control: max-age=7`, so they're not meant to be hit hard. Requests are throttled to 1/sec **per host** (api-web.nhle.com and api.nhle.com run in parallel).
- Non-existent game IDs return a clean 404.

## Player landing (`seasonTotals`)

- Mixes regular season (`gameTypeId` 2) and playoffs (3). Both are stored, keyed by `game_type`.
- A player traded mid-season has several rows for the same season and league, separated by `sequence`.
- Some leagues (youth and minor, e.g. "QC Int PW") report only `gamesPlayed` and `points`, so G, A and PIM are NULL.
- League abbreviations are inconsistent across levels ("WJC-A", "WJC-20", "U-18", "Champions HL"). Normalise them in Phase 6.

## Shift charts

- `typeCode` 517 = a real shift. `typeCode` 505 = a goal marker (`detailCode` 803, `eventDescription` "EVG"/"PPG"/..., `duration` null). Confirmed.
- An empty `data` array for a finished game isn't cached, so the next run retries it. Games where a boxscore player with TOI has no shift rows are counted in `game_ingest.shift_players_missing`; `npm run check:phase1` lists them.

## Play-by-play

- A 5v5 goal carried `situationCode` "1551", consistent with away goalie / away skaters / home skaters / home goalie. Still to be verified against known PP goals in Phase 2.

## Strength timeline (Phase 2)

Built second by second from penalties (skater counts) and goalie shifts (empty net), in `lib/derive/timeline.ts`. Official EV/PP/SH TOI is **penalty-based**: a 5v5 with a pulled goalie is still EV, and a PP where the short-handed team pulls its goalie is still PP.

Penalty rules the data confirmed (each one has a unit test in `tests/timeline.test.ts`):
- A PP goal ends only the soonest-ending **minor** of the short-handed team, and only if the scoring team really had more skaters. Short-handed goals end nothing.
- A double minor is one event (`MIN`, duration 4). A PP goal in the first half starts the second half.
- **Everything one player gets at one stoppage is served back to back in a single box slot**, majors first (e.g. hooking + roughing = 4v5 for four minutes, not 5v3 for two). A PP goal can't end the major part.
- Coincidental penalties cancel **before** grouping by player. Equal majors cancel, then equal minors. A single minor each at full strength, with nothing else called at that stoppage, is 4-on-4 (and not ended by goals). A fight where each player also gets a minor stays 5-on-5.
- A minor against a major at one stoppage is served in full: 4-on-4 for two minutes, then the power play. The NHL isn't consistent here. Offsetting the minor against the major matched a few games (e.g. 2023020698) but lowered agreement overall (99.74% → 99.24% TOI), so full service is used.
- A team never drops below 3 skaters. A third penalty waits for a free slot and its clock starts then.
- Regular-season OT is 3-on-3, and penalties add skaters to the other team (4v3, 5v3). When an OT penalty expires the player returns (4v3 → 4v4), and teams go back to 3v3 **only at the next whistle**.
- Misconducts (MIS), game misconducts (GAM) and penalty shots (PS) don't change strength. Bench minors (BEN) do, served by `servedByPlayerId`.

Event timing: events that end play (shots, goals, penalties, stoppages) see goalie state from the **previous second** (a goalie returning at the whistle hasn't come back yet). Faceoffs see the current second.

Remaining `situationCode` mismatches (~0.2%):
- The NHL tags the `game-end` event of OT games as "0440", which isn't a real state.
- Penalty shots are "0101" / "1010".
- Some delayed-penalty and goalie-pull seconds are off by a beat.

## Derived results (first 1,410 games of 2023-24, `npm run check:phase2`)

- situationCode agreement: **99.82%** (target > 99%).
- Skater TOI vs official, all of total/EV/PP/SH within ±10s: **99.76%** of player-games (target ≥ 98%). Nearly every outlier is a shift-chart problem for one player (shift totals ≠ official TOI), not the timeline.
- Shift-summed TOI vs boxscore TOI within ±10s: 99.84%.
- Our PP goals vs boxscore `powerPlayGoals`: 99.97% of player-games match.

## Counting stats

- Official G, A, SOG, HIT, BLK, PIM come from the **boxscore**. PP/SH points, primary/secondary assists and faceoffs come from play-by-play plus our strength timeline.
- About 7% of play-by-play `blocked-shot` events have `reason: "teammate-blocked"` (the shooter's own teammate blocked it). They aren't blocks for fantasy; the boxscore already excludes them.
- Shootout (period 5) events are excluded everywhere. Shootout goals don't count as goals and don't break a shutout.
- The boxscore lists the dressed backup goalie with 00:00 TOI and no decision. Only goalies with ice time get a `player_game` row. `decision` is W / L / O (OT loss). A shutout needs a win, 0 GA and one goalie with ice time.

## Deployment engine (Phase 3)

- **Units per game** (`lib/deploy/units.ts`): greedy grouping on pairwise shared seconds. Take the trio/pair/five/four with the most combined shared time, remove its players, repeat.
  - Forward lines: trios at 5v5. D pairs: pairs at 5v5. Both ranked by the members' total 5v5 TOI (SPEC 5.3), so in a game where the stars are rested, L1 can be a depth line.
  - PP units: five-man groups by shared PP seconds. PK units: four-man groups by shared PK seconds. Both ranked by shared time.
  - `shared_seconds` is the mean pairwise overlap, a close estimate of time the whole group was out together.
- **Position** for line detection is the NHL's per-game position from play-by-play roster spots (C/L/R/D).
- **1C and the established top line** are taken from the team's **previous 10 games**, so a mid-game promotion can't redefine them. The first game of a season falls back to that game.
  - SPEC 5.3 asks to weight 1C by offensive rating. That arrives in Phase 4, so 1C is currently pure 5v5 TOI. This picks Draisaitl over McDavid for EDM at the end of 2023-24.
- **Linemate quality** uses an interim offense proxy until Phase 4's `offense_rating`: each linemate's career-to-date points/60 in our data (games before this one only), shrunk toward the F or D average by 300 minutes.
- **oz_fo_share** = on-ice offensive-zone faceoffs ÷ all on-ice faceoffs (O + N + D), at 5v5 only (NHL `situationCode` 1551), from each player's own team's point of view. PP faceoffs are excluded so PP usage isn't double counted.
- **Windows** are the player's own games within a season, not team games, so injuries don't read as demotions. Shares are ratios of sums, so long games weigh more than short ones.
- **Opportunity Delta**: for each input, (last 5 games − prior 20) ÷ the league-wide SD of that change (per season, forwards and D separately), then a weighted mean using `config/model.yaml`.
  - Needs at least 5 prior games, so a call-up gets no delta until his 10th game.
  - Downgrade alerts only fire for "rostered-quality" players: prior-20 FP/GP at or above replacement level at their position. Replacement is the (teams × starting slots)-th best FP/GP that season, min 20 GP.
- **In-game promotion**: a forward's (P3 + OT) share of 5v5 time with the 1C or an established top-line forward, minus his P1 share, above 0.25 in at least 3 of his last 5 games (min 60s of 5v5 in each window).

## Missing shift data: end of 2024-25

- The shift-chart API returns **zero rows** for all 57 games from 2025-04-08 to 2025-04-15 (the last week of 2024-25), still as of 2026-09-26. Play-by-play and boxscores are fine.
- Those games have no derived data (no TOI split, lines or pairs), so 2024-25 has 1,255 of 1,312 games in the derived layer. Empty responses aren't cached, so every ingest retries them.
- The NHL's own HTML time-on-ice reports still exist for them (`https://www.nhl.com/scores/htmlreports/20242025/TH021235.HTM`, TV for the visitors). A fallback parser for those would fill the gap. Not built yet.

## xG model (Phase 4)

Logistic regression (Newton / IRLS in `lib/models/logistic.ts`) on unblocked shots with a goalie in net. Penalty shots and empty-net attempts get their league conversion rates instead (26.9% and 54.7%).

- **Features:** distance (plus squared and log), angle (plus squared), behind-the-net flag, shot type (wrist is the baseline), rebound (a shot attempt by the same team ≤ 3s before), rush (the previous event within 4s was in the shooting team's neutral or defensive zone), rebound × distance, PP and SH.
- **Geometry:** `homeTeamDefendingSide` "right" means the home team attacks the net at x = −89 and the away team the net at x = +89 (confirmed in fixtures). Goals average 24 ft from the net, shots on goal 37 ft. Blocked-shot coordinates are where the block happened.
- **Evaluation:** trained on 2023-24 and 2024-25, scored on held-out 2025-26 (111,066 shots). **Log loss 0.2255 vs 0.2489 for a constant rate (9.4% better). AUC 0.743.**

Calibration by decile of predicted xG (held-out 2025-26), predicted vs observed goal rate:

| decile | predicted | observed |
|---|---|---|
| 1 | 0.6% | 0.5% |
| 2 | 1.6% | 1.5% |
| 3 | 2.5% | 2.0% |
| 4 | 3.6% | 3.0% |
| 5 | 4.8% | 4.0% |
| 6 | 6.1% | 6.2% |
| 7 | 7.8% | 8.3% |
| 8 | 9.9% | 11.4% |
| 9 | 13.4% | 13.8% |
| 10 | 21.8% | 17.6% |

Well calibrated through the middle. It **over-predicts the most dangerous decile** (21.8% vs 17.6%), where tips, rebounds and point-blank chances are mixed together. Candidate fixes: distance splines, and interactions of shot type × distance.

- The rush flag fires on only 2–3.5% of shots. The play-by-play rarely records an event in the 4 seconds before a rush chance (zone entries aren't events), so the feature is weak.
- The final model is refit on all 331,432 shots from the three seasons, and every shot gets an `xg` value.

## Talent, projection, grades (Phase 4)

- **Rates** are per 60 by strength: EV (all equal strength, including 4v4, 3v3 and empty net), PP and SH. The SPEC says 5v5 and PP. EV is used so the rate buckets line up exactly with the official EV/PP/SH TOI they're multiplied by.
- **Season weights** are 3/3/2/1 for the in-progress season, last season, 2 ago and 3 ago. The in-progress season counts like last season, so ten October games don't knock a whole year out of the 3:2:1 window.
- **Goals** = regressed ixG/60 × regressed finishing (G/ixG toward the position average, prior worth 25 xG).
- **Assists** = regressed on-ice GF/60 × the player's share of on-ice goals he assists on. Secondary assists are regressed twice as hard (60-goal prior vs 30).
- **Peripherals** (hits, PIM) use light regression (100-minute prior). Blocks are split into non-PK and PK rates. Teammate-blocked shots are excluded.
- **offense_rating** = points/60 at a reference 85% EV / 15% PP mix.
- **Projected TOI** = 0.6 × last 10 games + 0.4 × the player's latest season, by strength.
- **Opponent adjustment:** regressed goals-against and shots-against per game (current + previous season).
- **Availability** = share of team games played in the latest season, regressed toward 90%.
- **Floor and ceiling** are the 20th and 80th percentiles of 2,000 simulated games. PPP and SHP are drawn from the simulated points, so they can't exceed them.
- **Fantasy Grade** ranks rest-of-season expected FP (FP/GP × expected games). Before the season that's mostly FP/GP × availability, so injury-hit stars (e.g. Matthews) rank a bit below their per-game value. VOR uses the (12 teams × starting slots)-th best FP/GP; UTIL isn't counted yet.
- **1C selection** in the deployment engine now weights 5v5 TOI by the as-of offense proxy (SPEC 5.3).

## Season calendar (as of 2026-09-26)

- 2026-27 is in preseason. Regular season runs 2026-10 → 2027-04-10, so it has no finished regular-season games yet. `npm run ingest:yesterday` picks them up once play starts.
- Ingested seasons: 2023-24, 2024-25, 2025-26 (full), 2026-27 (teams, schedule, rosters).
- **2026-27 is an 84-game season**: 1,344 games scheduled for 32 teams. Only the Phase 1 check assumes 82 per team, and only for completed seasons. Projections count the actual remaining schedule.
