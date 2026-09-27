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

## Goalie model (Phase 5)

- **Team context** is keyed by franchise, because team IDs change (Utah Hockey Club 59 → Utah Mammoth 68; Arizona 53 → Utah). Rates use the current season at weight 1.0 and the previous one at 0.5, regressed toward league with 20 games:
  - unblocked shots for and against per game
  - xG per shot for and against
  - team finishing (goals ÷ xG on shots at a goalie, regressed with 100 xG)
- **Per start:** both teams get the same model. Expected goals = shot volume (offense × defense) × xG per shot (offense × defense) × the shooting team's finishing − the goalie in net's saves above expected per shot. The opponent's goalie is the start-probability-weighted average of its goalies. Home ice is √(home goals ÷ away goals).
  - An earlier version used raw goals-for vs xG-based goals-against. Goals-for includes empty-net goals, so win odds came out +3 points too high.
- **Scorelines** are two Poissons with the diagonal rescaled so regulation ties hit the real rate (~22.5%; independent Poissons give ~13%). Ties split 50/50 in OT/shootout. A 0-0 shootout win counts as a shutout.
- **Saves** are scaled by the starter's historical share of his team's saves (97.6%; starters get pulled or relieved).
- **Shutouts** are scaled by observed ÷ model rate at league-average scoring. It's ~1.0 historically, since starter shutout rates were 5.4% / 5.7% / 4.2% by season.
- **Quality** = goals saved above expected per unblocked shot faced, weighted 3/3/2/1 by season, regressed toward 0 with a 3,000-shot prior.
- **Start share** = 0.5 × the team's last 10 games + 0.5 × the latest season, normalized across the team's goalies. A goalie who changed teams brings his old team's share and then gets normalized.
  - Back-to-backs, learned from data: the primary goalie starts the second night ×0.54 as often as other nights, backups ×1.83.
- **Weekly value** = Σ over the week's games of P(start) × expected FP. Before the season starts, the "week" is opening week.

**Backtest** (`npm run check:phase5`): projected as of 2025-12-31, scored on the rest of 2025-26.
- Most-likely starter was right 56.8% of the time. The actual starter was in the projected pool 94.6% of the time. Start probabilities are slightly overconfident: predicted 70% → actual 64%.
- Win probability: Brier 0.2465 vs 0.2500 for a constant (1.4% better).
  - As a separate check, the team model alone scored 1.9% better as of 2025-12-31 and 1.5% as of 2024-12-31. A goals-based rating did better in 2024-25 and worse in 2025-26. Single-game NHL prediction tops out at a few percent, so the xG model stays.
- Per start: GA 2.78 predicted vs 2.86 actual, FP 4.22 vs 3.98. Most of the FP gap is that half-season running cold: shutouts fell to 3.8% (history 5.4–5.7%) and saves dropped from 24.5 to 23.9 per start after New Year's.
- Goalies with 15+ later starts (43): the model's FP/start **RMSE is 0.73 vs 0.92** for each goalie's season-to-date average. Correlation with actual is ~0 for the model and 0.18 for season-to-date. With ~25 starts each, results are mostly noise; the model wins on error by not chasing hot and cold runs.

## Prospect model (Phase 6)

**Data** (`npm run ingest:prospects`, ~55 min the first time):
- Every draft pick 2005–2026 (4,765) from the NHL records site, `records.nhl.com/site/api/draft`. The web API's `/v1/draft/picks/{year}/all` has names but **no player IDs**.
- NHL season totals 2005-06 → 2025-26 from the Stats API `skater/summary` (G, A, PPP, SHP, SOG, PIM) plus `skater/realtime` (hits, blocks). One request each per season; hits and blocks start in 2005-06.
- Landing pages for all 4,252 drafted skaters, including the ones who never made the NHL, so comparables include busts (no survivorship bias).

**League translation (NHLe)** is a network fit in `lib/prospects/leagues.ts`:
- Every pair of seasons in the same player's career gives `log PPG(to) − log PPG(from) = log f(from) − log f(to) + growth(age)`, with f(NHL) = 1. Pairs are consecutive seasons, or two leagues in the same season (no growth term).
- Weighted least squares, weight ≈ 1/(1/pts₁ + 1/pts₂). Leagues need 30+ linked seasons. 90% intervals come from 50 bootstrap resamples of players.
- Leagues that rarely send players straight to the NHL are pinned down through the AHL and everything else. For example, USHL (2 direct jumps to the NHL) and J20 Nationell (0) still get tight intervals.
- 165 leagues on data through 2025-26: AHL 0.479, KHL 0.605, SHL 0.503, NL 0.455, Czechia 0.435, Liiga 0.396, DEL 0.361, NCAA 0.268, ECHL 0.234, OHL 0.167, WHL 0.158, USHL 0.155, QMJHL 0.144, J20 Nationell 0.100. Full table: `npm run check:phase6`.
- Junior factors are lower than classic published NHLe (~0.30 for the OHL) **on purpose**. Classic NHLe folds a year of development into the factor. Here development is a separate age term.
- Renamed leagues are merged: Sweden → SHL; SEL, J20 SuperElit and U20 Nationell → J20 Nationell; SM-liiga/Finland → Liiga; NLA/Swiss → NL; Russia → KHL. International tournaments have no factor (they fail the 20-GP minimum) and are ignored.

**Age curve**, the expected log change in translated PPG from one age to the next, fit jointly with the factors. F / D:
- 16→17: +57 / +66%
- 17→18: +40 / +44%
- 18→19: +24 / +31%
- 19→20: +20 / +18%
- 20→21: +15 / +10%
- flat by 24–25

"Peak NHLe" = the season's translated PPG × the growth still ahead to age 25. That's how production at 17 outweighs the same production at 20.

**Comparables:**
- The 25 nearest drafted skaters in the same position group at the same age, using only seasons before they reached 82 NHL games.
- They must be 8+ years past their draft so outcomes have matured (drafts ≤ 2018 as of 2026).
- Features, standardized within group and age: peak NHLe (weight 3), GP-weighted 2-season blend (2), draft slot (1), goal share (0.75), height and weight (0.5 each), year-over-year trajectory (0.5).

**Outcomes:**
- Career NHL GP.
- Peak single-season points.
- Peak fantasy PPG under league.yaml: seasons with 40+ GP; hat tricks estimated from a Poisson on G/GP; DEF bonus for defensemen.
- Grade = percentile of expected peak FP/GP (busts count as 0) across the board. Risk = tercile of the comps' IQR.

**Backtest** (SPEC 10.8): factors fitted on seasons through 2015-16, comparables from drafts ≤ 2015, each 2016–2018 pick predicted from his draft-year season.
- 491 evaluated. 84 had no usable draft-year season (under 15 GP in leagues with a factor).
- Rank correlation with actual peak FP/GP: **model 0.540 vs draft position 0.563 overall; within the first round, model 0.525 vs draft 0.451.** The model beats the draft where fantasy decisions are made; across all rounds the draft's scouting information still edges it.
  - Raising the draft-slot weight to 2 or 3 didn't help (0.535 / 0.538), so it stays a light prior as the SPEC asks.
- P(200+ GP): predicted 28.1% vs actual 22.8%. Some of the gap is censoring (2016–18 draftees are still adding games). Brier 0.120 vs 0.176 for the base rate.

## Web app (Phase 7)

- Next.js App Router. Server components read SQLite through `lib/queries.ts`; pages are client views with Chakra.
- Pages: `/rankings`, `/player/[id]`, `/alerts`, `/goalies`, `/teams`, `/teams/[abbrev]?span=game|5|season`, `/prospects`, plus header search (`/api/search`).
- The rostered filter is a manual star per player saved in `localStorage` (SPEC 11: "a manual toggle for now").
- Charts are hand-built SVG:
  - Fantasy-points bars and the deployment trend lines, both with hover tooltips.
  - Series colors are the reference palette's first three slots, validated for color-blind separation on this app's light (#FFFFFF) and dark (#151A21) card surfaces.
  - The light aqua is under 3:1 contrast, so lines are direct-labeled and there's a legend.
- **Chakra quirk:** Chakra caches compiled styles regardless of prop order. If the server first sees `color="…" fontSize="xs"` and the browser sees `fontSize="xs" color="…"`, the class hashes differ and React logs a hydration mismatch. Write style props in a consistent order (size before color).

## Nightly job and alert feed (Phase 8)

`npm run nightly` (logs to `data/logs/nightly-<date>.log`, records each run in `job_runs`). Steps:
1. **Ingest** the current season. Only new `OFF` games are fetched; schedules and rosters refresh on TTL.
2. **Derived tables** for new games only.
3. **xG:** new shots are scored with the stored model. The model retrains when it's 7+ days old (`jobs.xg_retrain_days`).
4. **Deployment and alerts** for the current season, then new entries appended to the alert feed.
5. **Projections and grades** (skaters and goalies) as of today's local date.
6. **Prospects** weekly (`jobs.prospects_refresh_days`): this year's and last year's drafts, the last two NHL seasons' totals, landing pages of the last 7 drafts' players, then the prospect model.

- Every step runs even if an earlier one failed, and the run is marked `partial`. A lock file (`data/nightly.lock`, stale after 6h or when its process is gone) stops runs overlapping.
- A preseason run takes ~45s. A simulated in-season night (3 games) rebuilt the games, scored 270 new shots and restored exactly the 10 missing feed entries. A second run added nothing (idempotent).
- **Alert feed** (`alert_feed`): an alert enters the feed the first time it fires for a player and type, and again only after 14 days (`jobs.feed_cooldown_days`). That's ~600 entries per season, about 3 a day. It's built deterministically from `opportunity_signal`, so `npm run feed:rebuild` recreates it at any time.
- **Scheduling (Windows):** `powershell -ExecutionPolicy Bypass -File scripts\register-nightly.ps1 -Time 06:30` registers a daily task for the current user. `StartWhenAvailable` catches up if the PC was off or asleep. Remove it with `Unregister-ScheduledTask -TaskName "NHL Fantasy Analyzer nightly" -Confirm:$false`.
- The app header shows when the last run finished and its status. Hover for per-step results. The Alerts page starts with the feed; dates newer than your last visit are marked "New" (per browser).

## Season calendar (as of 2026-09-26)

- 2026-27 is in preseason. Regular season runs 2026-10 → 2027-04-10, so it has no finished regular-season games yet. `npm run ingest:yesterday` picks them up once play starts.
- Ingested seasons: 2023-24, 2024-25, 2025-26 (full), 2026-27 (teams, schedule, rosters).
- **2026-27 is an 84-game season**: 1,344 games scheduled for 32 teams. Only the Phase 1 check assumes 82 per team, and only for completed seasons. Projections count the actual remaining schedule.
