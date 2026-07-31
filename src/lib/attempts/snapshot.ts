import { LlmProvider, Organization, ScenarioVersion, ScenarioTemplate } from "@prisma/client";
import {
  ScenarioTemplateContent,
  validateTemplateContent,
} from "@/lib/templates/schema";
import {
  CLASSIFIER_PROMPT_VERSION,
  SCORING_ENGINE_VERSION,
  SCORING_PROMPT_VERSION,
  SIMULATION_PROMPT_VERSION,
} from "@/lib/config/versions";

export interface ScenarioAttemptSnapshot {
  templateId: string;
  scenarioVersionId: string;
  versionDisplay: string;
  templateTitle: string;
  content: ScenarioTemplateContent;
  timeLimitMinutes: number;
  modelProvider: LlmProvider;
  modelName: string;
  simulationPromptVersion: string;
  scoringPromptVersion: string;
  scoringEngineVersion: string;
  classifierPromptVersion: string;
  capturedAt: string;
}

function resolveModelName(org: Organization): string {
  switch (org.llmProvider) {
    case LlmProvider.ANTHROPIC:
      return org.anthropicModel;
    case LlmProvider.OPENAI:
      return org.openaiModel;
    case LlmProvider.LOCAL:
      return org.localLlmModel;
    default:
      return org.openaiModel;
  }
}

export function buildScenarioSnapshot(
  template: ScenarioTemplate,
  version: ScenarioVersion,
  org: Organization,
): ScenarioAttemptSnapshot {
  const content = validateTemplateContent(version.content);
  return {
    templateId: template.id,
    scenarioVersionId: version.id,
    versionDisplay: version.version,
    templateTitle: template.title,
    content,
    timeLimitMinutes: version.timeLimitMinutes,
    modelProvider: org.llmProvider,
    modelName: resolveModelName(org),
    simulationPromptVersion: SIMULATION_PROMPT_VERSION,
    scoringPromptVersion: SCORING_PROMPT_VERSION,
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
    capturedAt: new Date().toISOString(),
  };
}

export function parseScenarioSnapshot(raw: unknown): ScenarioAttemptSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("Attempt is missing scenario snapshot");
  }
  const snap = raw as ScenarioAttemptSnapshot;
  return {
    ...snap,
    content: validateTemplateContent(snap.content),
  };
}

export function getAttemptContent(attempt: {
  scenarioSnapshot: unknown;
  scenarioVersion?: { content: unknown; template?: { title: string } };
}): ScenarioTemplateContent {
  if (attempt.scenarioSnapshot) {
    return parseScenarioSnapshot(attempt.scenarioSnapshot).content;
  }
  if (attempt.scenarioVersion?.content) {
    return validateTemplateContent(attempt.scenarioVersion.content);
  }
  throw new Error("No scenario content available for attempt");
}

export function getAttemptSnapshot(attempt: {
  scenarioSnapshot: unknown;
  scenarioVersion?: ScenarioVersion & { template?: ScenarioTemplate };
  organization?: Organization;
}): ScenarioAttemptSnapshot {
  if (attempt.scenarioSnapshot) {
    return parseScenarioSnapshot(attempt.scenarioSnapshot);
  }
  if (attempt.scenarioVersion && attempt.organization) {
    const template = attempt.scenarioVersion.template;
    if (!template) throw new Error("Template required to build legacy snapshot");
    return buildScenarioSnapshot(template, attempt.scenarioVersion, attempt.organization);
  }
  throw new Error("No scenario snapshot available for attempt");
}
