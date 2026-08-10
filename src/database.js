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
  console.error("Неожиданная ошибка PostgreSQL:", error);
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
    CREATE TABLE IF NOT EXISTS active_sessions (
      telegram_id BIGINT PRIMARY KEY
        REFERENCES users(telegram_id)
        ON DELETE CASCADE,
      scenario_id TEXT NOT NULL,
      step_index INTEGER NOT NULL DEFAULT 0,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS completed_sessions (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT
        REFERENCES users(telegram_id)
        ON DELETE SET NULL,
      scenario_id TEXT NOT NULL,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completion_status TEXT NOT NULL DEFAULT 'completed'
    );
  `);

  /*
   * CREATE TABLE IF NOT EXISTS не добавляет новые колонки
   * в уже существующую таблицу.
   *
   * Поэтому эта команда безопасно обновит базу,
   * которая уже работает на Railway.
   */
  await pool.query(`
    ALTER TABLE completed_sessions
    ADD COLUMN IF NOT EXISTS completion_status TEXT;
  `);

  /*
   * Старые записи считаем полностью завершёнными.
   */
  await pool.query(`
    UPDATE completed_sessions
    SET completion_status = 'completed'
    WHERE completion_status IS NULL;
  `);

  await pool.query(`
    ALTER TABLE completed_sessions
    ALTER COLUMN completion_status
    SET DEFAULT 'completed';
  `);

  await pool.query(`
    ALTER TABLE completed_sessions
    ALTER COLUMN completion_status
    SET NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS completed_sessions_telegram_id_idx
    ON completed_sessions (telegram_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS completed_sessions_scenario_id_idx
    ON completed_sessions (scenario_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS completed_sessions_status_idx
    ON completed_sessions (completion_status);
  `);

  console.log("База данных готова.");
}

export async function closeDatabase() {
  await pool.end();
}
