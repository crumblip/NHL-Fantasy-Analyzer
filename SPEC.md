# MASTER PROMPT — NHL Fantasy Tool (paste into Claude Code)

You are building an NHL fantasy hockey tool from scratch. The whole philosophy is **opportunity and deployment first**. Ice time, line placement, power-play unit, and who a player is actually on the ice with are treated as leading indicators of fantasy production. The tool should catch a player's value going up *before* the box score shows it.

Read this whole document before writing code. Build in the phases at the bottom, in order. Don't move to the next phase until the current one passes its acceptance checks.

---

## 0. Ground rules for you (Claude Code)

1. **Never invent an API endpoint or field name.** The NHL APIs are unofficial and undocumented.
   - Before writing a parser, fetch one real response, save it to `tests/fixtures/`, and inspect the actual JSON structure.
   - If a field I describe below doesn't exist or is named differently, go by the real data and tell me.
2. **Everything league-specific lives in config, not code.** That means scoring values, league size, roster slots, and grade weights.
3. **Cache every raw API response to disk.** Completed games never change, so fetch each one once. Throttle requests (about 1 per second) and retry with exponential backoff.
4. **Raw → derived → model, as separate layers.** Raw JSON is stored untouched. Derived tables (shifts, events, linemate overlap) are rebuilt from raw. Models read only derived tables.
5. **Write tests for the math.** In particular, shift-overlap time on ice must reconcile with the official boxscore time on ice (see Phase 2).
6. Commit at the end of each phase with a clear message. Keep a `NOTES.md` that logs data quirks you discover.
7. Don't scrape third-party sites (DailyFaceoff, EliteProspects, MoneyPuck, etc.) without asking me first, because of their terms of service. The NHL's own endpoints are the primary source.

---

## 1. Tech stack

Same stack as my `stockwatcher` and `NFLhelper` apps. Everything is TypeScript on Node 22, run locally with `npm run dev` (http://localhost:3001).

- **App:** Next.js 15 (App Router). API routes live under `app/api/`.
- **UI:** Chakra UI v3 + `next-themes` (dark by default), `react-icons`. Theme tokens are in `lib/theme.ts` (`rink.*`). Keep it simple, fast and data-dense.
- **Database:** SQLite via `better-sqlite3` at `data/nhl.db` (`lib/db.ts`).
- **Jobs:** `tsx` scripts in `scripts/`, exposed as npm scripts like `ingest:season`, `ingest:yesterday`, `build:derived`, `run:models`, `rebuild:all`.
- **Raw cache:** `data/cache/` (gitignored).
- **Config:** `config/league.yaml`, `config/model.yaml` (loaded by `lib/config.ts`).

---

## 2. League scoring (config/league.yaml)

```yaml
league:
  teams: 12            # TODO: set real league size
  roster:              # TODO: set real roster slots
    C: 2
    LW: 2
    RW: 2
    D: 4
    UTIL: 1
    G: 2
    BN: 4

scoring:
  skater:
    G: 3.0
    A: 2.0
    PIM: 0.25          # per penalty minute
    PPP: 0.75          # per power-play point, BONUS on top of G/A
    SHP: 1.5           # per short-handed point, BONUS on top of G/A
    HAT: 2.0           # per hat trick (3+ goals in a game)
    SOG: 0.25
    HIT: 0.3
    BLK: 0.45
    DEF: 0.5           # per point scored by a defenseman, BONUS on top of G/A
  goalie:
    W: 3.25
    GA: -0.5
    SV: 0.15
    SO: 4.0
    OTL: 0.5
```

### Scoring semantics (verify these in unit tests)

- PPP, SHP and DEF are **additive bonuses**. They are never replacements for the G/A points.
  - A defenseman's power-play goal = 3 (G) + 0.75 (PPP) + 0.5 (DEF) = **4.25**.
  - A defenseman's short-handed assist = 2 + 1.5 + 0.5 = **4.0**.
  - A forward's even-strength goal = **3.0**.
- DEF applies only to players whose position is D in the league's eligibility. Keep a `position_override` table, because fantasy platforms sometimes list positions differently from the NHL.
- HAT is +2 per game in which the player scores 3 or more goals. For projections, use expected value: `P(goals ≥ 3) × 2`, where P comes from a Poisson distribution using the player's projected goals per game.
- **Peripheral categories matter a lot in this scoring.** A game of 3 shots, 2 hits and 1 block is worth 1.8 points. A defenseman who blocks 2.5 shots a game gets about 1.1 points a game from blocks alone. The model must project SOG, HIT, BLK and PIM as seriously as it projects goals and assists.
- **Goalies:** a 30-save win = 3.25 + 30×0.15 − GA×0.5. Shutouts are high-variance, so project them as a probability.

---

## 3. Data sources

### Base URLs

- Web API: `https://api-web.nhle.com/v1/...`
- Stats API: `https://api.nhle.com/stats/rest/en/...`

### Endpoints to use (inspect real responses first)

- **Teams and rosters:** `/v1/roster/{TEAM}/current` and `/v1/roster/{TEAM}/{season}`.
- **Player landing:** `/v1/player/{playerId}/landing`. This gives:
  - bio, position, shoots, height, weight, birth date, draft info
  - the **headshot URL** (always use this field; never build the URL yourself)
  - `seasonTotals` across *all* leagues, including OHL, WHL, QMJHL, AHL, NCAA, KHL, SHL, Liiga and more. This is the prospect model's training data.
- **Player game log:** `/v1/player/{id}/game-log/{season}/2`.
- **Schedule:** `/v1/schedule/{date}` and `/v1/club-schedule-season/{TEAM}/{season}`.
- **Play-by-play:** `/v1/gamecenter/{gameId}/play-by-play`.
  - Events include goals (scorer and assisters), shots on goal, missed shots, blocked shots (with the blocking player), hits (hitter and hittee), penalties (the player who committed it, plus duration), and faceoffs (winner, loser, zone).
  - Each event has a `situationCode` (a 4-digit string). My understanding is that it encodes away goalie, away skaters, home skaters, and home goalie. **Verify this empirically** against known power-play goals before relying on it.
- **Boxscore:** `/v1/gamecenter/{gameId}/boxscore`. This has the official TOI, PP TOI and SH TOI per player, and it's the ground truth for reconciliation.
- **Shift charts:** `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={gameId}`.
  - It returns one row per shift: playerId, teamId, period, startTime, endTime, duration.
  - Some rows are goal events rather than shifts; check `typeCode` (517 appears to be a normal shift).
  - Drop zero-duration shifts. Log any games where the shift data is missing or incomplete.
- **Stats API skater/goalie reports** (`/skater/summary`, `/skater/timeonice`, `/goalie/summary` and similar): useful as a bulk cross-check.

### Optional later module (ask me before building it)

Sportsbook odds from a provider like The Odds API: team moneylines (for goalie win probability) and player props (shots on goal, points, anytime goal scorer). My NFL tool used props as its primary signal, so I want this eventually as an independent check on the model. Check which markets and plans actually cover NHL props before designing around it.

---

## 4. Database schema (minimum)

- `players`: id, name, position, shoots, birth_date, height, weight, headshot_url, current_team, draft info.
- `player_season_totals`: player_id, season, league, team, GP, G, A, PTS, PIM (from the landing page's seasonTotals, **all leagues**).
- `games`: id, date, season, home team, away team, final score, OT/SO flag.
- `shifts`: game_id, player_id, team_id, period, start_sec, end_sec (game seconds from 0).
- `events`: game_id, period, game_sec, type, situation_code, zone, x, y, and player roles (shooter, scorer, assist1, assist2, hitter, blocker, penalized, goalie, faceoff winner/loser).
- `strength_timeline`: game_id, start_sec, end_sec, home_skaters, away_skaters, home_goalie_in, away_goalie_in.
- `player_game`: a per-player, per-game fact table containing:
  - TOI split by strength (EV / PP / SH)
  - G, A, primary A, SOG, HIT, BLK, PIM, PPP, SHP, faceoffs
  - fantasy points under the league config
- `pair_overlap`: game_id, player_a, player_b, period, strength_state, shared_seconds.
- `line_assignments`: game_id, team_id, unit type (F-line / D-pair / PP unit / PK unit), rank, player_ids, shared_seconds.
- `model_outputs`: player_id, as_of_date, all projections, all grades, alert flags.

---

## 5. Deployment engine (THE CORE — build this best)

### 5.1 Strength timeline

Build each game's strength state from penalties (start time, duration, and early termination on a power-play goal for minors), plus goalie pulls. The pulls can be read from shifts: when the goalie has no active shift, the net is empty.

Cross-check your timeline against `situationCode` on events. Report the % of events where the two agree, and aim for >99%.

### 5.2 Shift overlap

For each game, sweep through time and compute shared on-ice seconds for every pair of teammates, split by period and strength state (5v5, PP, PK, other).

**Acceptance check:** each player's summed TOI by strength must match the boxscore's TOI, PP TOI and SH TOI within ±10 seconds for at least 98% of player-games. Log the outliers.

### 5.3 Line and unit detection (per game)

- **Forward lines:** at 5v5, cluster forwards into trios using shared seconds. Rank the lines by total 5v5 TOI.
- **D pairs:** the same method, in pairs.
- **PP units:** five-man groups ranked by shared PP seconds. PP1 is the top group.
  - Also store each player's **% of the team's total PP seconds**. This matters more than the PP1 label, because many teams split PP time close to evenly.
- **PK units:** the same method. PK time drives blocks and SHP chances, so it's a real fantasy signal in this league.
- **Team top center (1C):** the center with the highest 5v5 TOI over the trailing 10 games, weighted by offensive rating.

### 5.4 Opportunity metrics (per player, rolling windows: last 5, last 10, season)

All metrics are expressed as **shares of the team** (the relative-baseline approach), not absolute minutes:

- `ev_toi_share`: player's 5v5 TOI ÷ team 5v5 TOI.
- `pp_toi_share`: player's PP TOI ÷ team PP TOI.
- `pk_toi_share`.
- `pp1_rate`: % of games the player was on PP1.
- `top_line_rate`: % of games on F1 (forwards) or D1 (defense).
- `with_1c_share`: % of the player's 5v5 TOI spent with the team's 1C (forwards only).
- `linemate_quality`: the average offensive rating of his 5v5 linemates, weighted by shared TOI.
- `oz_fo_share`: % of on-ice faceoffs taken in the offensive zone.

### 5.5 Mid-game promotion detection

For each player and game, compute `with_1c_share` and `with_top_line_share` separately for period 1 and period 3 (and OT).

Flag a **"double-shift / in-game promotion" pattern** when P3 share minus P1 share exceeds a configurable threshold in at least 3 of the last 5 games. Surface it in the UI as a distinct badge. It's often the earliest sign of a real promotion.

### 5.6 Opportunity Delta (pickup alerts)

Compute a weighted z-score change between the last 5 games and the prior 20, using:

- `pp_toi_share` (weighted highest)
- `pp1_rate`
- `ev_toi_share`
- `with_1c_share`
- `top_line_rate`
- `linemate_quality`

Alerts fire when the delta crosses a threshold. Each alert shows which inputs moved and by how much, for example: *"PP share 12% → 41%, moved to PP1, 38% of 5v5 TOI with [1C name]."*

Also produce **downgrade alerts** (lost PP1, demoted) for players who are currently rostered-quality.

---

## 6. Offensive talent model (skaters)

Per player, compute per-60 rates split by strength (5v5 and PP):

- goals, primary assists, secondary assists
- shots on goal, individual shot attempts
- individual expected goals (ixG)

**Build a simple xG model** from play-by-play shots: logistic regression or gradient boosting on distance, angle, shot type, rebound flag (shot within about 3 seconds of a previous shot), rush flag, and strength. Train on 3+ seasons. Report log-loss and a calibration plot in `NOTES.md`.

**Regression to the mean:**

- Shooting %: blend the player's goals-above-xG with his career history, and regress toward the league average for his position based on sample size.
- Assist rates: use on-ice goals for and the player's share of points on those goals (IPP), regressed.
- Secondary assists are noisy, so regress them harder.

**Peripherals** (SOG/60, HIT/60, BLK/60, PIM/60) are sticky player traits. Use a multi-season weighted average (for example 3 : 2 : 1, most recent first) with light regression.
- BLK depends heavily on role, so model it by strength (PK blocks separately).

`offense_rating` = projected per-60 production at 5v5 and PP, independent of role. This measures talent, not opportunity.

---

## 7. Projection

For each player, project the upcoming game and the rest of the season:

```
projected TOI by strength = blend(recent deployment, season deployment), weighted toward recent; the weights live in config
for each stat s:  proj_s = Σ_strength (rate_s_per60[strength] × proj_TOI[strength] / 60)
FP/GP = Σ_s proj_s × scoring[s]
      + PPP bonus    (proj PP points × 0.75)
      + SHP bonus    (proj SH points × 1.5)
      + DEF bonus    (proj points × 0.5, D only)
      + HAT          (P(G ≥ 3 | Poisson(proj_G)) × 2)
```

Adjust for opponent (goals-against strength and shot suppression) and for the schedule (games remaining, back-to-backs). Keep a **season-rest** projection and a **next 7 days** projection, since weekly games-played counts matter for streaming.

Output **floor and ceiling** as well: the 20th and 80th percentiles, from simulation or Poisson-based variance. Peripheral-heavy players have high floors, while goal scorers have high ceilings.

---

## 8. Goalie model

- **Workload / opportunity:**
  - start share over the last 10 games and the season
  - back-to-back patterns (who starts the second game)
  - the team's schedule density
- **Quality:** goals saved above expected (using your xG model applied to shots against), regressed hard. Goalie performance is very noisy.
- **Team context:** the team's expected goals against per 60 and shots against per game (saves are worth 0.15 each, so high shot volume boosts floor), plus the team's win probability. Use a simple team-strength rating now, and swap in moneylines later if the odds module gets built.
- **Projection per start:**
  - `W×3.25 + OTL×0.5 + SV×0.15 − GA×0.5 + P(SO)×4`
  - P(SO) should come from a Poisson model on projected goals against.
- **Weekly value** = projected starts × projected fantasy points per start.

---

## 9. Grades (percentile within position group, displayed as letter grades A+ through F plus the numeric score)

Every skater gets:

1. **Fantasy Grade (headline):** projected FP/GP, adjusted for games remaining. Also report value over replacement: replacement level is the (teams × starting slots)-th best player at each position, using the league config.
2. **Offense Grade:** `offense_rating`, meaning talent independent of role.
3. **Opportunity Grade:** current deployment, meaning the section 5.4 metrics weighted per config. Show a trend arrow from the Opportunity Delta.
4. **Peripheral Grade:** projected SOG + HIT + BLK + PIM fantasy points. This is important in this league.

Goalies get Fantasy, Workload and Quality grades.

The UI should call out **mismatches**:

- High Offense but low Opportunity = "waiting on a promotion."
- High Opportunity but low Offense = "sell-high risk."

---

## 10. Prospect model (my version of PNHLe)

Goal: estimate a prospect's **NHL fantasy upside at his peak**, using the same logic as DobberProspects' PNHLe but built from data and more robust.

1. **Training set:** every player with non-NHL seasons in `player_season_totals`. To avoid survivorship bias, **include drafted players who never became NHL regulars**. Pull them via the NHL draft endpoints, then fetch their landing pages. Note any leagues where coverage is thin.
2. **League translation factors:** estimate these yourself, don't hardcode published ones.
   - Use players who went from league X in season t to the NHL in season t+1 (or within 2 seasons), with minimum-games filters.
   - Fit NHL PPG ~ league PPG by league, with an age term. Where direct league → NHL links are sparse, chain through the AHL (a "network" approach).
   - Report each factor with its sample size and confidence interval.
3. **Age adjustment:** use age as of Sept 15 of the season. Production at 17 or 18 is worth much more than the same production at 20 or 21. Model this explicitly.
4. **Position:** separate models for F and D.
5. **Features:** translated PPG at each age, goal share (G/PTS), year-over-year trajectory, height and weight, draft position (as a prior, not the driver), and games played (sample-size weighting).
6. **Output with comparable players:** find the 25 most similar historical prospects by league-adjusted production, age, position and size. Report:
   - P(becomes NHL regular: 200+ GP)
   - P(peak season of 50+ points), P(peak season of 70+ points)
   - median projected peak fantasy points per game under **this league's scoring**, including the peripherals and the DEF bonus
   - the list of comparable players, with names and outcomes, so I can sanity-check the grade
7. **Prospect Fantasy Grade:** a letter grade from expected peak fantasy value, with a separate "risk" indicator based on how spread out the comparable players' outcomes are.
8. Backtest it by training on draft years up to about 2015 and evaluating on later years. Report rank correlation with actual peak fantasy points.

---

## 11. UI

- **Player card:** headshot, name, team, position, the four grades, projected fantasy points per game (with floor and ceiling), current line, PP unit and % PP share, top linemates with % shared TOI, a sparkline of recent fantasy points, and alert badges.
- **Team view:** forward lines, D pairs, PP1/PP2 and PK units, each showing % shared TOI. Toggle between last game, last 5 and season.
- **Player detail:** trend charts of deployment metrics over time, a period-by-period linemate breakdown (for promotion detection), and the game log with fantasy points.
- **Alerts feed:** pickup and downgrade alerts, sortable by Opportunity Delta size and Fantasy Grade.
- **Rankings table:** every player, filterable by position, team and rostered status (a manual toggle for now), sortable by any grade or projection.
- **Goalie board:** projected starts this week, fantasy points per start, and weekly value.
- **Prospect board:** prospect grades, the probabilities, and comparable players.
- Everything must work well on mobile.

---

## 12. Build phases (do them in order)

**Phase 1 — Ingestion.** Build the rosters, player landing pages (with headshots and all-league season totals), schedule, and play-by-play + shift charts + boxscore for the current season and the 3 prior seasons, with caching. Save fixtures.
✅ Acceptance: every active player has a stored headshot URL; game counts match the schedule.

**Phase 2 — Derived tables.** Build the strength timeline, the per-player per-game fact table, and pair overlap.
✅ Acceptance: TOI by strength reconciles with the boxscore (see 5.2); situationCode agreement is above 99%. Fantasy-point unit tests pass for all the scoring examples in section 2.

**Phase 3 — Deployment engine.** Build line and unit detection, the opportunity metrics, promotion detection, and the Opportunity Delta.
✅ Acceptance: print one team's lines and PP units for a recent game, and I'll spot-check them against the broadcast or news.

**Phase 4 — Talent, projection and grades.** Build the xG model, rates, regression, projections, grades and replacement level.
✅ Acceptance: show the top 30 at each position and the top 20 alerts. Report calibration metrics for the xG model.

**Phase 5 — Goalie model.**

**Phase 6 — Prospect model**, with backtest results.

**Phase 7 — UI.**

**Phase 8 — Nightly job and alert feed.**

**Phase 9 (only after asking me) — Sportsbook odds module.**

Start with Phase 1. First show me the file and folder structure you plan to create, then begin.
