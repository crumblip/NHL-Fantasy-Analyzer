import type Database from "better-sqlite3";

function addColumns(db: Database.Database, table: string, columns: Record<string, string>) {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function migrate(db: Database.Database) {
  migrateTables(db);
  // Phase 4 additions to derived tables created in Phase 2.
  addColumns(db, "events", {
    shooter_team_id: "INTEGER",
    shot_distance: "REAL",
    shot_angle: "REAL",
    is_rebound: "INTEGER",
    is_rush: "INTEGER",
    empty_net: "INTEGER",
    xg: "REAL",
  });
  addColumns(db, "player_game", {
    gf_ev: "INTEGER NOT NULL DEFAULT 0",
    gf_pp: "INTEGER NOT NULL DEFAULT 0",
    gf_sh: "INTEGER NOT NULL DEFAULT 0",
  });
}

function migrateTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      abbrev TEXT NOT NULL,
      name TEXT NOT NULL,
      logo TEXT,
      dark_logo TEXT
    );

    CREATE TABLE IF NOT EXISTS team_seasons (
      season INTEGER NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      abbrev TEXT NOT NULL,
      PRIMARY KEY (season, team_id)
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY,
      season INTEGER NOT NULL,
      game_type INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      start_time_utc TEXT,
      home_team_id INTEGER NOT NULL,
      home_abbrev TEXT NOT NULL,
      away_team_id INTEGER NOT NULL,
      away_abbrev TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      game_state TEXT NOT NULL,
      schedule_state TEXT,
      last_period_type TEXT,
      neutral_site INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS games_season_date ON games(season, game_date);

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      position TEXT,
      shoots TEXT,
      birth_date TEXT,
      birth_city TEXT,
      birth_country TEXT,
      height_in INTEGER,
      weight_lb INTEGER,
      headshot_url TEXT,
      sweater_number INTEGER,
      current_team TEXT,
      is_active INTEGER,
      draft_year INTEGER,
      draft_team TEXT,
      draft_round INTEGER,
      draft_pick_in_round INTEGER,
      draft_overall INTEGER,
      landing_fetched_at TEXT
    );

    -- One row per player/season/league/game type/stint; sequence separates mid-season moves.
    -- G, A and PIM are NULL for leagues that only report GP and PTS.
    CREATE TABLE IF NOT EXISTS player_season_totals (
      player_id INTEGER NOT NULL REFERENCES players(id),
      season INTEGER NOT NULL,
      game_type INTEGER NOT NULL,
      league TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      team TEXT,
      gp INTEGER,
      g INTEGER,
      a INTEGER,
      pts INTEGER,
      pim INTEGER,
      PRIMARY KEY (player_id, season, game_type, league, sequence)
    );

    CREATE TABLE IF NOT EXISTS roster_entries (
      season INTEGER NOT NULL,
      team_abbrev TEXT NOT NULL,
      player_id INTEGER NOT NULL,
      PRIMARY KEY (season, team_abbrev, player_id)
    );

    CREATE TABLE IF NOT EXISTS game_rosters (
      game_id INTEGER NOT NULL REFERENCES games(id),
      player_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      position_code TEXT,
      sweater_number INTEGER,
      PRIMARY KEY (game_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS game_rosters_player ON game_rosters(player_id);

    -- Derived layer (Phase 2). Rebuilt from the raw cache by npm run build:derived.
    -- Game seconds run continuously from 0: period p starts at (p - 1) * 1200. Shootouts are excluded.
    CREATE TABLE IF NOT EXISTS shifts (
      game_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      period INTEGER NOT NULL,
      start_sec INTEGER NOT NULL,
      end_sec INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shifts_game ON shifts(game_id);

    -- situation_code is the NHL's; derived_situation_code is ours from the strength timeline.
    CREATE TABLE IF NOT EXISTS events (
      game_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      sort_order INTEGER,
      period INTEGER NOT NULL,
      game_sec INTEGER NOT NULL,
      type TEXT NOT NULL,
      event_team_id INTEGER,
      situation_code TEXT,
      derived_situation_code TEXT,
      strength TEXT,
      zone TEXT,
      x INTEGER,
      y INTEGER,
      shot_type TEXT,
      shooter_id INTEGER,
      scorer_id INTEGER,
      assist1_id INTEGER,
      assist2_id INTEGER,
      goalie_id INTEGER,
      hitter_id INTEGER,
      hittee_id INTEGER,
      blocker_id INTEGER,
      block_reason TEXT,
      penalized_id INTEGER,
      drawn_by_id INTEGER,
      served_by_id INTEGER,
      penalty_type TEXT,
      penalty_desc TEXT,
      penalty_minutes INTEGER,
      faceoff_winner_id INTEGER,
      faceoff_loser_id INTEGER,
      PRIMARY KEY (game_id, event_id)
    );

    -- Skater counts come from penalties only (no extra attacker); goalie flags from goalie shifts.
    CREATE TABLE IF NOT EXISTS strength_timeline (
      game_id INTEGER NOT NULL,
      start_sec INTEGER NOT NULL,
      end_sec INTEGER NOT NULL,
      home_skaters INTEGER NOT NULL,
      away_skaters INTEGER NOT NULL,
      home_goalie_in INTEGER NOT NULL,
      away_goalie_in INTEGER NOT NULL,
      PRIMARY KEY (game_id, start_sec)
    );

    CREATE TABLE IF NOT EXISTS player_game (
      game_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      season INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      position TEXT,
      is_goalie INTEGER NOT NULL,
      toi INTEGER,
      toi_ev INTEGER,
      toi_pp INTEGER,
      toi_sh INTEGER,
      toi_5v5 INTEGER,
      boxscore_toi INTEGER,
      official_toi INTEGER,
      official_ev INTEGER,
      official_pp INTEGER,
      official_sh INTEGER,
      g INTEGER NOT NULL DEFAULT 0,
      a INTEGER NOT NULL DEFAULT 0,
      a1 INTEGER NOT NULL DEFAULT 0,
      a2 INTEGER NOT NULL DEFAULT 0,
      sog INTEGER NOT NULL DEFAULT 0,
      hit INTEGER NOT NULL DEFAULT 0,
      blk INTEGER NOT NULL DEFAULT 0,
      pim INTEGER NOT NULL DEFAULT 0,
      ppg INTEGER NOT NULL DEFAULT 0,
      ppa INTEGER NOT NULL DEFAULT 0,
      shg INTEGER NOT NULL DEFAULT 0,
      sha INTEGER NOT NULL DEFAULT 0,
      ppp INTEGER NOT NULL DEFAULT 0,
      shp INTEGER NOT NULL DEFAULT 0,
      boxscore_ppg INTEGER,
      fow INTEGER NOT NULL DEFAULT 0,
      fol INTEGER NOT NULL DEFAULT 0,
      gs INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 0,
      l INTEGER NOT NULL DEFAULT 0,
      otl INTEGER NOT NULL DEFAULT 0,
      sa INTEGER NOT NULL DEFAULT 0,
      sv INTEGER NOT NULL DEFAULT 0,
      ga INTEGER NOT NULL DEFAULT 0,
      so INTEGER NOT NULL DEFAULT 0,
      fantasy_points REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (game_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS player_game_player ON player_game(player_id, game_date);

    -- player_a < player_b. strength_state is from the pair's team's perspective: 5v5, PP, PK, other.
    CREATE TABLE IF NOT EXISTS pair_overlap (
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      player_a INTEGER NOT NULL,
      player_b INTEGER NOT NULL,
      period INTEGER NOT NULL,
      strength_state TEXT NOT NULL,
      shared_seconds INTEGER NOT NULL,
      PRIMARY KEY (game_id, player_a, player_b, period, strength_state)
    );

    -- Period 4 = overtime.
    CREATE TABLE IF NOT EXISTS player_period (
      game_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      period INTEGER NOT NULL,
      toi_5v5 INTEGER NOT NULL,
      toi_pp INTEGER NOT NULL,
      toi_sh INTEGER NOT NULL,
      PRIMARY KEY (game_id, player_id, period)
    );

    -- Seconds the team spent in each state (denominators for the team-share metrics).
    CREATE TABLE IF NOT EXISTS team_game (
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      opponent_id INTEGER NOT NULL,
      season INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      is_home INTEGER NOT NULL,
      secs_5v5 INTEGER NOT NULL,
      secs_ev INTEGER NOT NULL,
      secs_pp INTEGER NOT NULL,
      secs_pk INTEGER NOT NULL,
      PRIMARY KEY (game_id, team_id)
    );

    -- Deployment layer (Phase 3). Rebuilt by npm run build:deployment.
    CREATE TABLE IF NOT EXISTS line_assignments (
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      unit_type TEXT NOT NULL,          -- F (forward line), D (pair), PP, PK
      rank INTEGER NOT NULL,
      player_ids TEXT NOT NULL,         -- JSON array
      shared_seconds INTEGER NOT NULL,  -- mean pairwise shared time in that state
      PRIMARY KEY (game_id, team_id, unit_type, rank)
    );

    -- Per player-game deployment facts; rolling metrics are ratios of sums over these rows.
    CREATE TABLE IF NOT EXISTS player_deployment (
      game_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      season INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      position TEXT NOT NULL,           -- NHL game position: C, L, R, D
      toi_5v5 INTEGER NOT NULL,
      toi_pp INTEGER NOT NULL,
      toi_pk INTEGER NOT NULL,
      team_5v5 INTEGER NOT NULL,
      team_pp INTEGER NOT NULL,
      team_pk INTEGER NOT NULL,
      f_line INTEGER,
      d_pair INTEGER,
      pp_unit INTEGER,
      pk_unit INTEGER,
      team_1c INTEGER,                  -- the team's 1C going into this game
      with_1c INTEGER,                  -- 5v5 seconds with the 1C (forwards other than the 1C)
      p1_5v5 INTEGER,
      late_5v5 INTEGER,                 -- period 3 + OT
      p1_with_1c INTEGER,
      late_with_1c INTEGER,
      p1_with_top INTEGER,              -- most 5v5 seconds with any established top-line forward
      late_with_top INTEGER,
      promo_game INTEGER,               -- late share minus P1 share above the promotion threshold
      fo_oz INTEGER NOT NULL DEFAULT 0, -- on-ice 5v5 faceoffs by zone, from this player's team's view
      fo_nz INTEGER NOT NULL DEFAULT 0,
      fo_dz INTEGER NOT NULL DEFAULT 0,
      lmq_num REAL NOT NULL DEFAULT 0,  -- sum of shared 5v5 seconds x linemate offense rating
      lmq_den REAL NOT NULL DEFAULT 0,
      fantasy_points REAL NOT NULL,
      PRIMARY KEY (game_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS player_deployment_player ON player_deployment(player_id, game_date);

    -- Rolling opportunity metrics as of each player-game (SPEC 5.4). span: L5, L10, SEASON.
    CREATE TABLE IF NOT EXISTS player_opportunity (
      player_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      span TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      season INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      games INTEGER NOT NULL,
      ev_toi_share REAL,
      pp_toi_share REAL,
      pk_toi_share REAL,
      pp1_rate REAL,
      top_line_rate REAL,
      with_1c_share REAL,
      linemate_quality REAL,
      oz_fo_share REAL,
      PRIMARY KEY (player_id, game_id, span)
    );

    -- Opportunity Delta, promotion badge and alerts as of each player-game (SPEC 5.5, 5.6).
    CREATE TABLE IF NOT EXISTS opportunity_signal (
      player_id INTEGER NOT NULL,
      game_id INTEGER NOT NULL,
      as_of_date TEXT NOT NULL,
      season INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      position TEXT NOT NULL,
      opportunity_delta REAL,
      inputs TEXT,                      -- JSON: per input {prior, recent, z}
      promotion_games INTEGER NOT NULL DEFAULT 0,
      promotion_flag INTEGER NOT NULL DEFAULT 0,
      rostered_quality INTEGER NOT NULL DEFAULT 0,
      alert TEXT,                       -- pickup | downgrade
      alert_text TEXT,
      PRIMARY KEY (player_id, game_id)
    );
    CREATE INDEX IF NOT EXISTS opportunity_signal_date ON opportunity_signal(as_of_date);

    -- Projections, grades and alert flags per skater as of a date (SPEC 4, 7, 9).
    CREATE TABLE IF NOT EXISTS model_outputs (
      player_id INTEGER NOT NULL,
      as_of_date TEXT NOT NULL,
      season INTEGER NOT NULL,
      team_id INTEGER,
      position TEXT NOT NULL,           -- fantasy position: C, LW, RW, D
      new_team INTEGER NOT NULL DEFAULT 0,
      gp_window INTEGER NOT NULL,
      proj_toi_ev REAL, proj_toi_pp REAL, proj_toi_sh REAL,   -- seconds per game
      proj_g REAL, proj_a REAL, proj_ppp REAL, proj_shp REAL,
      proj_sog REAL, proj_hit REAL, proj_blk REAL, proj_pim REAL,
      proj_fp_gp REAL NOT NULL,         -- opponent-adjusted average over remaining games
      floor_fp REAL, ceiling_fp REAL,   -- 20th / 80th percentile of one game
      next_game_id INTEGER, next_game_fp REAL,
      next7_games INTEGER, next7_fp REAL,
      games_remaining INTEGER, availability REAL, expected_games REAL, rest_fp REAL,
      replacement_fp_gp REAL, vor REAL,
      offense_rating REAL, ev_p60 REAL, pp_p60 REAL,
      peripheral_fp_gp REAL,
      opportunity_score REAL, opportunity_delta REAL, trend TEXT,
      fantasy_pctl REAL, fantasy_grade TEXT,
      offense_pctl REAL, offense_grade TEXT,
      opportunity_pctl REAL, opportunity_grade TEXT,
      peripheral_pctl REAL, peripheral_grade TEXT,
      mismatch TEXT,
      alert TEXT, alert_text TEXT, promotion_flag INTEGER NOT NULL DEFAULT 0,
      detail TEXT,                      -- JSON: per-60 rates and inputs
      PRIMARY KEY (player_id, as_of_date)
    );

    -- Goalie projections and grades as of a date (SPEC 8, 9). Per-start values are averages over the
    -- goalie's remaining games weighted by his start probability in each.
    CREATE TABLE IF NOT EXISTS goalie_outputs (
      player_id INTEGER NOT NULL,
      as_of_date TEXT NOT NULL,
      season INTEGER NOT NULL,
      team_id INTEGER,
      gp_window INTEGER NOT NULL,
      start_share_l10 REAL, start_share_season REAL, proj_start_share REAL,
      gsax_raw REAL,                    -- goals saved above expected, current + last season
      gsax_per_shot REAL,               -- weighted and regressed toward 0
      p_win REAL, p_otl REAL, p_so REAL, proj_ga REAL, proj_sv REAL,
      fp_per_start REAL, floor_fp REAL, ceiling_fp REAL,
      next_game_id INTEGER, next_game_p_start REAL, next_game_fp REAL,
      week_start TEXT, week_end TEXT, week_games INTEGER, week_starts REAL, week_fp REAL,
      games_remaining INTEGER, rest_starts REAL, rest_fp REAL,
      fantasy_pctl REAL, fantasy_grade TEXT,
      workload_pctl REAL, workload_grade TEXT,
      quality_pctl REAL, quality_grade TEXT,
      PRIMARY KEY (player_id, as_of_date)
    );

    -- Fitted model parameters and their evaluation (Phase 4+).
    CREATE TABLE IF NOT EXISTS model_params (
      name TEXT PRIMARY KEY,
      params TEXT NOT NULL,
      metrics TEXT,
      trained_at TEXT NOT NULL
    );

    -- Fantasy platforms sometimes list positions differently from the NHL (matters for the DEF bonus).
    CREATE TABLE IF NOT EXISTS position_override (
      player_id INTEGER PRIMARY KEY,
      position TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS game_ingest (
      game_id INTEGER PRIMARY KEY REFERENCES games(id),
      pbp_events INTEGER,
      boxscore_players INTEGER,
      shift_rows INTEGER,
      shift_players_missing INTEGER,
      toi_rows INTEGER,
      error TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}
