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
  templateSlug: string;
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
    templateSlug: template.slug,
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
  if (!snap.templateTitle || !snap.scenarioVersionId) {
    throw new Error("Attempt snapshot is incomplete or invalid");
  }
  return {
    ...snap,
    templateSlug: snap.templateSlug || "",
    content: validateTemplateContent(snap.content),
  };
}

export function getAttemptContent(attempt: {
  scenarioSnapshot: unknown;
}): ScenarioTemplateContent {
  if (!attempt.scenarioSnapshot) {
    throw new Error("Attempt snapshot required — run snapshot backfill");
  }
  return parseScenarioSnapshot(attempt.scenarioSnapshot).content;
}

export function getAttemptSnapshot(attempt: {
  scenarioSnapshot: unknown;
}): ScenarioAttemptSnapshot {
  if (!attempt.scenarioSnapshot) {
    throw new Error("Attempt snapshot required — run snapshot backfill");
  }
  return parseScenarioSnapshot(attempt.scenarioSnapshot);
}

export class SnapshotIntegrityError extends Error {
  constructor(message = "Historical scenario snapshot is missing or invalid. Run snapshot backfill.") {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

export function requireAttemptSnapshot(attempt: { scenarioSnapshot: unknown }): ScenarioAttemptSnapshot {
  try {
    return getAttemptSnapshot(attempt);
  } catch (err) {
    throw new SnapshotIntegrityError(err instanceof Error ? err.message : undefined);
  }
}
