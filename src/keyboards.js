import { Markup } from "telegraf";
import { scenarios } from "./scenarios.js";

const scenarioList = Object.values(scenarios);

export function createMainMenuKeyboard() {
  const buttons = scenarioList.map((scenario) =>
    Markup.button.callback(
      `${scenario.emoji} ${scenario.title}`,
      `scenario:${scenario.id}`
    )
  );

  const rows = [];

  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }

  return Markup.inlineKeyboard(rows);
}

export function createScenarioKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Остановиться здесь",
        "pause_session"
      )
    ],
    [
      Markup.button.callback(
        "Выбрать другое состояние",
        "show_menu"
      )
    ]
  ]);
}

export function createAfterCompletionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Выбрать другое состояние",
        "show_menu"
      )
    ]
  ]);
}
