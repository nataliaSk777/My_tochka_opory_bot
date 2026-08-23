import http from "node:http";
import { Telegraf } from "telegraf";

import { config } from "./config.js";

import {
  closeDatabase,
  initializeDatabase,
  pool
} from "./database.js";

import {
  createAfterFeedbackKeyboard,
  createCancelKeyboard,
  createFeedbackSkipKeyboard,
  createMainMenuKeyboard,
  createOutcomeKeyboard
} from "./keyboards.js";

import {
  detectImmediateRisk,
  immediateRiskMessage
} from "./safety.js";

import {
  getScenario,
  scenarioList
} from "./scenarios.js";

import {
  cancelActiveSession,
  clearPendingInput,
  completeSession,
  createSession,
  getActiveSession,
  getPendingInput,
  logEvent,
  saveAnswer,
  saveFeedback,
  saveOutcome,
  saveUser,
  setPendingInput
} from "./sessionRepository.js";

const bot =
  new Telegraf(
    config.botToken
  );

function getFirstName(ctx) {
  return (
    ctx.from?.first_name?.trim() ||
    "друг"
  );
}

async function registerUser(ctx) {
  if (!ctx.from) {
    return;
  }

  await saveUser(ctx.from);
}

async function sendMainMenu(
  ctx,
  introductoryText = null
) {
  const text =
    introductoryText ||
    [
      "Что тебе сейчас нужно?",
      "",
      "Выбери состояние. Я буду задавать вопросы по одному — без оценок и готовых решений."
    ].join("\n");

  await ctx.reply(
    text,
    createMainMenuKeyboard()
  );
}

async function startScenario(
  ctx,
  scenarioId
) {
  const scenario =
    getScenario(scenarioId);

  if (
    !scenario ||
    !ctx.from
  ) {
    await ctx.reply(
      "Этот сценарий пока недоступен."
    );

    return;
  }

  if (!scenario.steps.length) {
    await ctx.reply(
      "В этом сценарии пока нет вопросов."
    );

    return;
  }

  await clearPendingInput(
    ctx.from.id
  );

  const session =
    await createSession(
      ctx.from.id,
      scenario.id
    );

  const firstStep =
    scenario.steps[0];

  await ctx.reply(
    [
      `${scenario.emoji} ${scenario.title}`,
      "",
      scenario.introduction,
      "",
      firstStep.question
    ].join("\n"),
    createCancelKeyboard()
  );

  return session;
}

async function finishScenario(
  ctx,
  session,
  scenario
) {
  const completedSession =
    await completeSession({
      telegramId:
        ctx.from.id,

      sessionId:
        session.id,

      scenarioId:
        scenario.id
    });

  if (!completedSession) {
    await ctx.reply(
      "Не удалось завершить сценарий. Отправь /menu, чтобы вернуться в главное меню."
    );

    return;
  }

  await ctx.reply(
    scenario.completion
  );

  await ctx.reply(
    "Сейчас тебе стало легче или яснее?",
    createOutcomeKeyboard(
      completedSession.id
    )
  );
}

async function continueScenario(
  ctx,
  session,
  userAnswer
) {
  const scenario =
    getScenario(
      session.scenario_id
    );

  if (!scenario) {
    await cancelActiveSession(
      ctx.from.id
    );

    await ctx.reply(
      "Этот сценарий больше недоступен."
    );

    await sendMainMenu(ctx);

    return;
  }

  const currentStep =
    scenario.steps[
      session.last_step_index
    ];

  if (!currentStep) {
    await finishScenario(
      ctx,
      session,
      scenario
    );

    return;
  }

  const updatedSession =
    await saveAnswer({
      telegramId:
        ctx.from.id,

      session,

      stepIndex:
        session.last_step_index,

      questionId:
        currentStep.id,

      question:
        currentStep.question,

      answer:
        userAnswer
    });

  if (!updatedSession) {
    await ctx.reply(
      "Не удалось сохранить ответ. Отправь /menu и попробуй снова."
    );

    return;
  }

  const nextStep =
    scenario.steps[
      updatedSession.last_step_index
    ];

  if (!nextStep) {
    await finishScenario(
      ctx,
      updatedSession,
      scenario
    );

    return;
  }

  await ctx.reply(
    nextStep.question,
    createCancelKeyboard()
  );
}

function shouldAskForDetails(
  outcome,
  sessionId
) {
  if (outcome === "no") {
    return true;
  }

  return (
    Number(sessionId) % 4 === 0
  );
}

bot.start(async (ctx) => {
  await registerUser(ctx);

  await clearPendingInput(
    ctx.from.id
  );

  await ctx.reply(
    [
      `Привет, ${getFirstName(ctx)}.`,
      "",
      "Я — «Точка опоры».",
      "",
      "Я задаю вопросы, которые помогают услышать себя, немного прояснить происходящее и найти ближайшую опору.",
      "",
      "Я не принимаю решения за тебя и не оцениваю твои ответы.",
      "",
      "Ответы и данные о прохождении могут сохраняться, чтобы бот мог продолжать разговор и чтобы мы могли улучшать его сценарии.",
      "",
      "«Точка опоры» не заменяет медицинскую, психологическую или экстренную помощь."
    ].join("\n")
  );

  await sendMainMenu(ctx);
});

bot.command(
  "menu",
  async (ctx) => {
    await registerUser(ctx);

    await clearPendingInput(
      ctx.from.id
    );

    await sendMainMenu(ctx);
  }
);

bot.command(
  "cancel",
  async (ctx) => {
    await registerUser(ctx);

    await clearPendingInput(
      ctx.from.id
    );

    await cancelActiveSession(
      ctx.from.id
    );

    await ctx.reply(
      "Разговор завершён. Можно вернуться к нему позже."
    );

    await sendMainMenu(ctx);
  }
);

bot.command(
  "ping",
  async (ctx) => {
    await registerUser(ctx);

    const databaseCheck =
      await pool.query(
        "SELECT NOW() AS current_time;"
      );

    const databaseTime =
      databaseCheck.rows[0]
        .current_time;

    await ctx.reply(
      [
        "Бот работает.",
        "Соединение с PostgreSQL работает.",
        `Время базы данных: ${databaseTime.toISOString()}`
      ].join("\n")
    );
  }
);

bot.command(
  "scenarios",
  async (ctx) => {
    const list =
      scenarioList
        .map(
          (scenario) =>
            `${scenario.emoji} ${scenario.title}`
        )
        .join("\n");

    await ctx.reply(
      `Сейчас доступны:\n\n${list}`
    );
  }
);

bot.action(
  /^scenario:(.+)$/,
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    const scenarioId =
      ctx.match[1];

    await startScenario(
      ctx,
      scenarioId
    );
  }
);

bot.action(
  "cancel_session",
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    await clearPendingInput(
      ctx.from.id
    );

    await cancelActiveSession(
      ctx.from.id
    );

    await ctx.reply(
      "Разговор завершён. Необязательно заканчивать внутреннюю работу за один раз."
    );

    await sendMainMenu(ctx);
  }
);

bot.action(
  "show_menu",
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    await clearPendingInput(
      ctx.from.id
    );

    await cancelActiveSession(
      ctx.from.id
    );

    await sendMainMenu(ctx);
  }
);

bot.action(
  "creator_feedback",
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    const activeSession =
      await getActiveSession(
        ctx.from.id
      );

    await setPendingInput({
      telegramId:
        ctx.from.id,

      type:
        "creator_feedback",

      sessionId:
        activeSession?.id || null
    });

    await logEvent({
      telegramId:
        ctx.from.id,

      sessionId:
        activeSession?.id || null,

      scenarioId:
        activeSession
          ?.scenario_id || null,

      eventType:
        "creator_feedback_opened",

      stepIndex:
        activeSession
          ?.last_step_index || null
    });

    await ctx.reply(
      [
        "Напиши как есть.",
        "",
        "Что понравилось, что раздражает, где было непонятно, чего тебе не хватило или какую ситуацию хотелось бы здесь увидеть.",
        "",
        "Следующее сообщение я сохраню как обратную связь создателю."
      ].join("\n")
    );
  }
);

bot.action(
  /^outcome:(noticeably|slightly|no):(\d+)$/,
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    const outcome =
      ctx.match[1];

    const sessionId =
      Number(ctx.match[2]);

    const session =
      await saveOutcome({
        telegramId:
          ctx.from.id,

        sessionId,

        outcome
      });

    if (!session) {
      await ctx.reply(
        "Не удалось сохранить ответ."
      );

      return;
    }

    if (
      shouldAskForDetails(
        outcome,
        sessionId
      )
    ) {
      await setPendingInput({
        telegramId:
          ctx.from.id,

        type:
          "outcome_feedback",

        sessionId
      });

      await ctx.reply(
        "Что именно тебе сейчас помогло — или чего не хватило?",
        createFeedbackSkipKeyboard()
      );

      return;
    }

    await clearPendingInput(
      ctx.from.id
    );

    await ctx.reply(
      "Спасибо. Это помогает нам понимать, что в «Точке опоры» действительно работает.",
      createAfterFeedbackKeyboard()
    );
  }
);

bot.action(
  "skip_feedback",
  async (ctx) => {
    await ctx.answerCbQuery();

    await registerUser(ctx);

    await clearPendingInput(
      ctx.from.id
    );

    await ctx.reply(
      "Спасибо.",
      createAfterFeedbackKeyboard()
    );
  }
);

bot.on(
  "text",
  async (ctx) => {
    await registerUser(ctx);

    const text =
      ctx.message.text.trim();

    if (!text) {
      return;
    }

    if (
      text.startsWith("/")
    ) {
      return;
    }

    if (
      detectImmediateRisk(text)
    ) {
      await clearPendingInput(
        ctx.from.id
      );

      await cancelActiveSession(
        ctx.from.id
      );

      await ctx.reply(
        immediateRiskMessage
      );

      return;
    }

    const pendingInput =
      await getPendingInput(
        ctx.from.id
      );

    if (
      pendingInput?.type ===
      "creator_feedback"
    ) {
      await saveFeedback({
        telegramId:
          ctx.from.id,

        sessionId:
          pendingInput.sessionId,

        kind:
          "creator",

        message:
          text
      });

      await clearPendingInput(
        ctx.from.id
      );

      await ctx.reply(
        "Спасибо. Сообщение сохранено — именно такие наблюдения особенно помогают улучшать бота.",
        createAfterFeedbackKeyboard()
      );

      return;
    }

    if (
      pendingInput?.type ===
      "outcome_feedback"
    ) {
      await saveFeedback({
        telegramId:
          ctx.from.id,

        sessionId:
          pendingInput.sessionId,

        kind:
          "outcome",

        message:
          text
      });

      await clearPendingInput(
        ctx.from.id
      );

      await ctx.reply(
        "Спасибо. Это очень полезная обратная связь.",
        createAfterFeedbackKeyboard()
      );

      return;
    }

    const session =
      await getActiveSession(
        ctx.from.id
      );

    if (!session) {
      await ctx.reply(
        "Сначала выбери состояние, с которым хочешь поработать."
      );

      await sendMainMenu(ctx);

      return;
    }

    await continueScenario(
      ctx,
      session,
      text
    );
  }
);

bot.catch(
  async (error, ctx) => {
    console.error(
      `Ошибка Telegram update ${ctx.update.update_id}:`,
      error
    );

    try {
      await ctx.reply(
        "Произошла техническая ошибка. Отправь /menu, чтобы вернуться в главное меню."
      );
    } catch (replyError) {
      console.error(
        "Не удалось отправить сообщение об ошибке:",
        replyError
      );
    }
  }
);

function startHealthServer() {
  const server =
    http.createServer(
      (
        request,
        response
      ) => {
        if (
          request.url ===
          "/health"
        ) {
          response.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          response.end(
            JSON.stringify({
              status: "ok",
              service:
                "tochka-opory-bot",
              timestamp:
                new Date()
                  .toISOString()
            })
          );

          return;
        }

        response.writeHead(
          200,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        response.end(
          "Точка опоры работает."
        );
      }
    );

  server.listen(
    config.port,
    "0.0.0.0",
    () => {
      console.log(
        `HTTP-сервер запущен на порту ${config.port}.`
      );
    }
  );

  return server;
}

async function shutdown(
  signal,
  healthServer
) {
  console.log(
    `Получен сигнал ${signal}. Завершаю работу.`
  );

  try {
    bot.stop(signal);

    await new Promise(
      (resolve) => {
        healthServer.close(
          () => resolve()
        );
      }
    );

    await closeDatabase();

    console.log(
      "Работа завершена корректно."
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "Ошибка при завершении работы:",
      error
    );

    process.exit(1);
  }
}

async function main() {
  await initializeDatabase();

  const healthServer =
    startHealthServer();

  await bot.telegram.setMyCommands([
    {
      command: "start",
      description: "Открыть бота"
    },
    {
      command: "menu",
      description:
        "Выбрать состояние"
    },
    {
      command: "cancel",
      description:
        "Завершить текущий разговор"
    },
    {
      command: "scenarios",
      description:
        "Посмотреть доступные сценарии"
    },
    {
      command: "ping",
      description:
        "Проверить работу бота"
    }
  ]);

  await bot.launch({
    dropPendingUpdates: false
  });

  console.log(
    "Telegram-бот запущен."
  );

  process.once(
    "SIGINT",
    () => {
      void shutdown(
        "SIGINT",
        healthServer
      );
    }
  );

  process.once(
    "SIGTERM",
    () => {
      void shutdown(
        "SIGTERM",
        healthServer
      );
    }
  );
}

main().catch(
  (error) => {
    console.error(
      "Бот не смог запуститься:",
      error
    );

    process.exit(1);
  }
);
