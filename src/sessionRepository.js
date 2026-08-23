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

export async function logEvent({
  telegramId,
  sessionId = null,
  scenarioId = null,
  eventType,
  stepIndex = null,
  metadata = {}
}) {
  await pool.query(
    `
      INSERT INTO events (
        telegram_id,
        session_id,
        scenario_id,
        event_type,
        step_index,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb
      );
    `,
    [
      telegramId,
      sessionId,
      scenarioId,
      eventType,
      stepIndex,
      JSON.stringify(metadata)
    ]
  );
}

export async function abandonActiveSession(
  telegramId
) {
  const result = await pool.query(
    `
      UPDATE sessions
      SET
        status = 'abandoned',
        ended_at = NOW()
      WHERE
        telegram_id = $1
        AND status = 'active'
      RETURNING *;
    `,
    [telegramId]
  );

  for (const session of result.rows) {
    await logEvent({
      telegramId,
      sessionId: session.id,
      scenarioId: session.scenario_id,
      eventType: "scenario_abandoned",
      stepIndex:
        session.last_step_index
    });
  }

  return result.rows;
}

export async function createSession(
  telegramId,
  scenarioId
) {
  await abandonActiveSession(
    telegramId
  );

  const result = await pool.query(
    `
      INSERT INTO sessions (
        telegram_id,
        scenario_id,
        status,
        last_step_index,
        answered_count
      )
      VALUES (
        $1,
        $2,
        'active',
        0,
        0
      )
      RETURNING *;
    `,
    [
      telegramId,
      scenarioId
    ]
  );

  const session =
    result.rows[0];

  await logEvent({
    telegramId,
    sessionId: session.id,
    scenarioId,
    eventType: "scenario_started",
    stepIndex: 0
  });

  return session;
}

export async function getActiveSession(
  telegramId
) {
  const result = await pool.query(
    `
      SELECT *
      FROM sessions
      WHERE
        telegram_id = $1
        AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1;
    `,
    [telegramId]
  );

  return result.rows[0] || null;
}

export async function saveAnswer({
  telegramId,
  session,
  stepIndex,
  questionId,
  question,
  answer
}) {
  await pool.query(
    `
      INSERT INTO answers (
        session_id,
        step_index,
        question_id,
        question,
        answer
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5
      );
    `,
    [
      session.id,
      stepIndex,
      questionId,
      question,
      answer
    ]
  );

  const result = await pool.query(
    `
      UPDATE sessions
      SET
        answered_count =
          answered_count + 1,

        last_step_index =
          $2

      WHERE
        id = $1
        AND status = 'active'

      RETURNING *;
    `,
    [
      session.id,
      stepIndex + 1
    ]
  );

  await logEvent({
    telegramId,
    sessionId: session.id,
    scenarioId:
      session.scenario_id,
    eventType:
      "scenario_step_answered",
    stepIndex,
    metadata: {
      questionId
    }
  });

  return result.rows[0] || null;
}

export async function completeSession({
  telegramId,
  sessionId,
  scenarioId
}) {
  const result = await pool.query(
    `
      UPDATE sessions
      SET
        status = 'completed',
        completed_at = NOW(),
        ended_at = NOW()

      WHERE
        id = $1
        AND telegram_id = $2

      RETURNING *;
    `,
    [
      sessionId,
      telegramId
    ]
  );

  const session =
    result.rows[0] || null;

  if (session) {
    await logEvent({
      telegramId,
      sessionId,
      scenarioId,
      eventType:
        "scenario_completed",
      stepIndex:
        session.last_step_index
    });
  }

  return session;
}

export async function cancelActiveSession(
  telegramId
) {
  const result = await pool.query(
    `
      UPDATE sessions
      SET
        status = 'cancelled',
        ended_at = NOW()

      WHERE
        telegram_id = $1
        AND status = 'active'

      RETURNING *;
    `,
    [telegramId]
  );

  for (const session of result.rows) {
    await logEvent({
      telegramId,
      sessionId: session.id,
      scenarioId:
        session.scenario_id,
      eventType:
        "scenario_cancelled",
      stepIndex:
        session.last_step_index
    });
  }

  return result.rows;
}

export async function saveOutcome({
  telegramId,
  sessionId,
  outcome
}) {
  const result = await pool.query(
    `
      UPDATE sessions
      SET
        outcome = $3,
        outcome_recorded_at = NOW()

      WHERE
        id = $1
        AND telegram_id = $2
        AND status = 'completed'

      RETURNING *;
    `,
    [
      sessionId,
      telegramId,
      outcome
    ]
  );

  const session =
    result.rows[0] || null;

  if (!session) {
    return null;
  }

  await logEvent({
    telegramId,
    sessionId,
    scenarioId:
      session.scenario_id,
    eventType:
      `outcome_${outcome}`
  });

  return session;
}

export async function setPendingInput({
  telegramId,
  type,
  sessionId = null
}) {
  await pool.query(
    `
      UPDATE users
      SET
        pending_input = $2,
        pending_session_id = $3,
        updated_at = NOW()

      WHERE telegram_id = $1;
    `,
    [
      telegramId,
      type,
      sessionId
    ]
  );
}

export async function getPendingInput(
  telegramId
) {
  const result = await pool.query(
    `
      SELECT
        pending_input,
        pending_session_id

      FROM users
      WHERE telegram_id = $1;
    `,
    [telegramId]
  );

  const row = result.rows[0];

  if (
    !row ||
    !row.pending_input
  ) {
    return null;
  }

  return {
    type: row.pending_input,
    sessionId:
      row.pending_session_id
  };
}

export async function clearPendingInput(
  telegramId
) {
  await pool.query(
    `
      UPDATE users
      SET
        pending_input = NULL,
        pending_session_id = NULL,
        updated_at = NOW()

      WHERE telegram_id = $1;
    `,
    [telegramId]
  );
}

export async function saveFeedback({
  telegramId,
  sessionId = null,
  kind,
  message
}) {
  const result = await pool.query(
    `
      INSERT INTO feedback (
        telegram_id,
        session_id,
        kind,
        message
      )
      VALUES (
        $1,
        $2,
        $3,
        $4
      )
      RETURNING *;
    `,
    [
      telegramId,
      sessionId,
      kind,
      message
    ]
  );

  let scenarioId = null;

  if (sessionId) {
    const sessionResult =
      await pool.query(
        `
          SELECT scenario_id
          FROM sessions
          WHERE id = $1;
        `,
        [sessionId]
      );

    scenarioId =
      sessionResult.rows[0]
        ?.scenario_id || null;
  }

  await logEvent({
    telegramId,
    sessionId,
    scenarioId,
    eventType:
      kind === "creator"
        ? "creator_feedback_sent"
        : "outcome_feedback_sent"
  });

  return result.rows[0];
}
