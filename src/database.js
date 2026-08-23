import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl:
    config.nodeEnv === "production"
      ? {
          rejectUnauthorized: false
        }
      : false
});

pool.on("error", (error) => {
  console.error(
    "Неожиданная ошибка PostgreSQL:",
    error
  );
});

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pending_input TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pending_session_id BIGINT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,

      telegram_id BIGINT NOT NULL
        REFERENCES users(telegram_id)
        ON DELETE CASCADE,

      scenario_id TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'active',

      last_step_index INTEGER NOT NULL DEFAULT 0,
      answered_count INTEGER NOT NULL DEFAULT 0,

      outcome TEXT,

      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      outcome_recorded_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      one_active_session_per_user
    ON sessions (telegram_id)
    WHERE status = 'active';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      sessions_user_index
    ON sessions (telegram_id, started_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      sessions_scenario_index
    ON sessions (scenario_id, started_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS answers (
      id BIGSERIAL PRIMARY KEY,

      session_id BIGINT NOT NULL
        REFERENCES sessions(id)
        ON DELETE CASCADE,

      step_index INTEGER NOT NULL,

      question_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,

      answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      answers_session_index
    ON answers (session_id, step_index);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,

      telegram_id BIGINT NOT NULL
        REFERENCES users(telegram_id)
        ON DELETE CASCADE,

      session_id BIGINT
        REFERENCES sessions(id)
        ON DELETE SET NULL,

      kind TEXT NOT NULL,

      message TEXT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      feedback_created_index
    ON feedback (created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,

      telegram_id BIGINT NOT NULL
        REFERENCES users(telegram_id)
        ON DELETE CASCADE,

      session_id BIGINT
        REFERENCES sessions(id)
        ON DELETE SET NULL,

      scenario_id TEXT,

      event_type TEXT NOT NULL,

      step_index INTEGER,

      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      events_user_index
    ON events (telegram_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      events_type_index
    ON events (event_type, created_at DESC);
  `);

  console.log(
    "База данных готова."
  );
}

export async function closeDatabase() {
  await pool.end();
}
