import { Markup } from "telegraf";
import { scenarioList } from "./scenarios.js";

export function createMainMenuKeyboard() {
  const scenarioButtons =
    scenarioList.map((scenario) =>
      Markup.button.callback(
        `${scenario.emoji} ${scenario.title}`,
        `scenario:${scenario.id}`
      )
    );

  const rows = [];

  for (
    let index = 0;
    index < scenarioButtons.length;
    index += 2
  ) {
    rows.push(
      scenarioButtons.slice(
        index,
        index + 2
      )
    );
  }

  rows.push([
    Markup.button.callback(
      "💬 Сказать создателю",
      "creator_feedback"
    )
  ]);

  return Markup.inlineKeyboard(rows);
}

export function createCancelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Остановиться здесь",
        "cancel_session"
      )
    ],
    [
      Markup.button.callback(
        "Выбрать другое состояние",
        "show_menu"
      )
    ],
    [
      Markup.button.callback(
        "💬 Сказать создателю",
        "creator_feedback"
      )
    ]
  ]);
}

export function createOutcomeKeyboard(
  sessionId
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Да, заметно",
        `outcome:noticeably:${sessionId}`
      )
    ],
    [
      Markup.button.callback(
        "Немного",
        `outcome:slightly:${sessionId}`
      )
    ],
    [
      Markup.button.callback(
        "Нет",
        `outcome:no:${sessionId}`
      )
    ]
  ]);
}

export function createFeedbackSkipKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Пропустить",
        "skip_feedback"
      )
    ]
  ]);
}

export function createAfterFeedbackKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Выбрать другое состояние",
        "show_menu"
      )
    ],
    [
      Markup.button.callback(
        "💬 Сказать создателю",
        "creator_feedback"
      )
    ]
  ]);
}
