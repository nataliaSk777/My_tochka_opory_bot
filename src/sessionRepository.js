import { pool } from "./database.js";

export async function saveUser(user) {
  await pool.query(
    `
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        last_name,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW();
    `,
    [
      user.id,
      user.username || null,
      user.first_name || null,
      user.last_name || null
    ]
  );
}

export async function createSession(telegramId, scenarioId) {
  await pool.query(
    `
      INSERT INTO active_sessions (
        telegram_id,
        scenario_id,
        step_index,
        answers,
        started_at,
        updated_at
      )
      VALUES ($1, $2, 0, '[]'::jsonb, NOW(), NOW())
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        scenario_id = EXCLUDED.scenario_id,
        step_index = 0,
        answers = '[]'::jsonb,
        started_at = NOW(),
        updated_at = NOW();
    `,
    [telegramId, scenarioId]
  );
}

export async function getSession(telegramId) {
  const result = await pool.query(
    `
      SELECT
        telegram_id,
        scenario_id,
        step_index,
        answers,
        started_at,
        updated_at
      FROM active_sessions
      WHERE telegram_id = $1;
    `,
    [telegramId]
  );

  return result.rows[0] || null;
}

export async function saveAnswer({
  telegramId,
  questionId,
  question,
  answer
}) {
  const answerObject = {
    questionId,
    question,
    answer,
    answeredAt: new Date().toISOString()
  };

  const result = await pool.query(
    `
      UPDATE active_sessions
      SET
        answers = answers || $2::jsonb,
        step_index = step_index + 1,
        updated_at = NOW()
      WHERE telegram_id = $1
      RETURNING
        telegram_id,
        scenario_id,
        step_index,
        answers,
        started_at,
        updated_at;
    `,
    [telegramId, JSON.stringify([answerObject])]
  );

  return result.rows[0] || null;
}

export async function deleteSession(telegramId) {
  await pool.query(
    `
      DELETE FROM active_sessions
      WHERE telegram_id = $1;
    `,
    [telegramId]
  );
}

async function archiveSession(
  telegramId,
  completionStatus
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `
        SELECT
          telegram_id,
          scenario_id,
          answers,
          started_at
        FROM active_sessions
        WHERE telegram_id = $1
        FOR UPDATE;
      `,
      [telegramId]
    );

    const session = sessionResult.rows[0];

    if (!session) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
        INSERT INTO completed_sessions (
          telegram_id,
          scenario_id,
          answers,
          started_at,
          completed_at,
          completion_status
        )
        VALUES ($1, $2, $3::jsonb, $4, NOW(), $5);
      `,
      [
        session.telegram_id,
        session.scenario_id,
        JSON.stringify(session.answers),
        session.started_at,
        completionStatus
      ]
    );

    await client.query(
      `
        DELETE FROM active_sessions
        WHERE telegram_id = $1;
      `,
      [telegramId]
    );

    await client.query("COMMIT");

    return session;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeSession(telegramId) {
  return archiveSession(
    telegramId,
    "completed"
  );
}

export async function pauseSession(telegramId) {
  return archiveSession(
    telegramId,
    "paused"
  );
}
