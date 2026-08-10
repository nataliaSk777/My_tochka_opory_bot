import { getScenario } from "./scenarios.js";
import {
  completeSession,
  deleteSession,
  saveAnswer
} from "./sessionRepository.js";

export function getScenarioStart(scenarioId) {
  const scenario = getScenario(scenarioId);

  if (!scenario || !scenario.steps.length) {
    return null;
  }

  return {
    scenario,
    firstStep: scenario.steps[0]
  };
}

export async function processScenarioAnswer({
  telegramId,
  session,
  answer
}) {
  const scenario = getScenario(session.scenario_id);

  if (!scenario) {
    await deleteSession(telegramId);

    return {
      type: "scenario_missing"
    };
  }

  const currentStep = scenario.steps[session.step_index];

  if (!currentStep) {
    await completeSession(telegramId);

    return {
      type: "completed",
      scenario
    };
  }

  const updatedSession = await saveAnswer({
    telegramId,
    questionId: currentStep.id,
    question: currentStep.question,
    answer
  });

  if (!updatedSession) {
    return {
      type: "save_failed"
    };
  }

  const nextStep = scenario.steps[updatedSession.step_index];

  if (!nextStep) {
    await completeSession(telegramId);

    return {
      type: "completed",
      scenario
    };
  }

  return {
    type: "next_step",
    scenario,
    nextStep,
    session: updatedSession
  };
}
