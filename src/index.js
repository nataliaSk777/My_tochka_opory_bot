import http from "node:http";
import { Telegraf } from "telegraf";

import { config } from "./config.js";
import {
  closeDatabase,
  initializeDatabase,
  pool
} from "./database.js";
import {
  createAfterCompletionKeyboard,
  createCancelKeyboard,
  createMainMenuKeyboard
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
  completeSession,
  createSession,
  deleteSession,
  getSession,
  saveAnswer,
  saveUser
} from "./sessionRepository.js";

const bot = new Telegraf(config.botToken);

function getFirstName(ctx) {
  return ctx.from?.first_name?.trim() || "друг";
}

async function registerUser(ctx) {
  if (!ctx.from) {
    return;
  }

  await saveUser(ctx.from);
}

async function sendMainMenu(ctx, introductoryText = null) {
  const text =
    introductoryText ||
    [
      "Что тебе сейчас нужно?",
      "",
      "Выбери состояние. Бот будет задавать вопросы по одному и не станет принимать решение за тебя."
    ].join("\n");

  await ctx.reply(text, createMainMenuKeyboard());
}

async function startScenario(ctx, scenarioId) {
  const scenario = getScenario(scenarioId);

  if (!scenario || !ctx.from) {
    await ctx.reply("Этот сценарий пока недоступен.");
    return;
  }

  await createSession(ctx.from.id, scenario.id);

  const firstStep = scenario.steps[0];

  await ctx.reply(
    [
      `${scenario.emoji} ${scenario.title}`,
      "",
      scenario.introduction,
      "",
      `Первый вопрос:`,
      firstStep.question
    ].join("\n"),
    createCancelKeyboard()
  );
}

async function continueScenario(ctx, session, userAnswer) {
  const scenario = getScenario(session.scenario_id);

  if (!scenario) {
    await deleteSession(ctx.from.id);

    await ctx.reply(
      "Сценарий не найден. Я завершил незаконченный разговор, чтобы данные не смешались."
    );

    await sendMainMenu(ctx);
    return;
  }

  const currentStep = scenario.steps[session.step_index];

  if (!currentStep) {
    await completeSession(ctx.from.id);

    await ctx.reply(
      scenario.completion,
      createAfterCompletionKeyboard()
    );

    return;
  }

  const updatedSession = await saveAnswer({
    telegramId: ctx.from.id,
    questionId: currentStep.id,
    question: currentStep.question,
    answer: userAnswer
  });

  if (!updatedSession) {
    await ctx.reply(
      "Не удалось сохранить ответ. Пожалуйста, выбери состояние заново."
    );

    await sendMainMenu(ctx);
    return;
  }

  const nextStep = scenario.steps[updatedSession.step_index];

  if (!nextStep) {
    await completeSession(ctx.from.id);

    await ctx.reply(
      [
        "Спасибо. Я сохранил твои ответы.",
        "",
        scenario.completion
      ].join("\n"),
      createAfterCompletionKeyboard()
    );

    return;
  }

  await ctx.reply(nextStep.question, createCancelKeyboard());
}

bot.start(async (ctx) => {
  await registerUser(ctx);

  await ctx.reply(
    [
      `Привет, ${getFirstName(ctx)}.`,
      "",
      "Я — «Точка опоры».",
      "",
      "Я не принимаю решения за тебя и не выношу оценок. Я задаю вопросы, которые помогают услышать себя, немного прояснить ситуацию и найти ближайшую опору.",
      "",
      "Это не медицинская или экстренная помощь. При непосредственной опасности нужно обращаться к людям и службам, которые могут помочь в реальности."
    ].join("\n")
  );

  await sendMainMenu(ctx);
});

bot.command("menu", async (ctx) => {
  await registerUser(ctx);
  await sendMainMenu(ctx);
});

bot.command("cancel", async (ctx) => {
  await registerUser(ctx);
  await deleteSession(ctx.from.id);

  await ctx.reply("Разговор завершён. Твои границы важнее сценария.");

  await sendMainMenu(ctx);
});

bot.command("ping", async (ctx) => {
  await registerUser(ctx);

  const databaseCheck = await pool.query(
    "SELECT NOW() AS current_time;"
  );

  const databaseTime = databaseCheck.rows[0].current_time;

  await ctx.reply(
    [
      "Бот работает.",
      "Соединение с PostgreSQL работает.",
      `Время базы данных: ${databaseTime.toISOString()}`
    ].join("\n")
  );
});

bot.command("scenarios", async (ctx) => {
  const list = scenarioList
    .map((scenario) => `${scenario.emoji} ${scenario.title}`)
    .join("\n");

  await ctx.reply(`Сейчас доступны:\n\n${list}`);
});

bot.action(/^scenario:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await registerUser(ctx);

  const scenarioId = ctx.match[1];

  await startScenario(ctx, scenarioId);
});

bot.action("cancel_session", async (ctx) => {
  await ctx.answerCbQuery();
  await registerUser(ctx);
  await deleteSession(ctx.from.id);

  await ctx.reply(
    "Разговор завершён. Необязательно заканчивать внутреннюю работу за один раз."
  );

  await sendMainMenu(ctx);
});

bot.action("show_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await registerUser(ctx);
  await sendMainMenu(ctx);
});

bot.on("text", async (ctx) => {
  await registerUser(ctx);

  const text = ctx.message.text.trim();

  if (!text) {
    return;
  }

  if (text.startsWith("/")) {
    return;
  }

  if (detectImmediateRisk(text)) {
    await deleteSession(ctx.from.id);
    await ctx.reply(immediateRiskMessage);
    return;
  }

  const session = await getSession(ctx.from.id);

  if (!session) {
    await ctx.reply(
      "Сначала выбери состояние, с которым хочешь поработать."
    );

    await sendMainMenu(ctx);
    return;
  }

  await continueScenario(ctx, session, text);
});

bot.catch(async (error, ctx) => {
  console.error(
    `Ошибка при обработке Telegram update ${ctx.update.update_id}:`,
    error
  );

  try {
    await ctx.reply(
      "Произошла техническая ошибка. Твой последний ответ мог не сохраниться. Отправь /menu, чтобы вернуться в главное меню."
    );
  } catch (replyError) {
    console.error(
      "Не удалось отправить сообщение об ошибке:",
      replyError
    );
  }
});

function startHealthServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });

      response.end(
        JSON.stringify({
          status: "ok",
          service: "tochka-opory-bot",
          timestamp: new Date().toISOString()
        })
      );

      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    response.end("Точка опоры работает.");
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(
      `Служебный HTTP-сервер запущен на порту ${config.port}.`
    );
  });

  return server;
}

async function shutdown(signal, healthServer) {
  console.log(`Получен сигнал ${signal}. Завершаю работу.`);

  try {
    bot.stop(signal);

    await new Promise((resolve) => {
      healthServer.close(() => resolve());
    });

    await closeDatabase();

    console.log("Работа завершена корректно.");
    process.exit(0);
  } catch (error) {
    console.error("Ошибка при завершении работы:", error);
    process.exit(1);
  }
}

async function main() {
  await initializeDatabase();

  const healthServer = startHealthServer();

  await bot.telegram.setMyCommands([
    {
      command: "start",
      description: "Открыть бота"
    },
    {
      command: "menu",
      description: "Выбрать состояние"
    },
    {
      command: "cancel",
      description: "Завершить текущий разговор"
    },
    {
      command: "scenarios",
      description: "Посмотреть доступные сценарии"
    },
    {
      command: "ping",
      description: "Проверить работу бота"
    }
  ]);

  await bot.launch({
    dropPendingUpdates: false
  });

  console.log("Telegram-бот запущен.");

  process.once("SIGINT", () => {
    void shutdown("SIGINT", healthServer);
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", healthServer);
  });
}

main().catch((error) => {
  console.error("Бот не смог запуститься:", error);
  process.exit(1);
});
