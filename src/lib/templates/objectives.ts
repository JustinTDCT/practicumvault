import { ObjectiveDefinition, ScenarioTemplateContent } from "@/lib/templates/schema";

/** Normalize legacy `gates` JSON to `objectives` when loading templates. */
export function normalizeTemplateRawContent(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (!obj.objectives && Array.isArray(obj.gates)) {
    obj.objectives = obj.gates;
  }

  delete obj.gates;
  return obj;
}

export function getNextObjectiveId(objectives: ObjectiveDefinition[]): number {
  if (objectives.length === 0) return 1;
  return Math.max(...objectives.map((o) => o.id)) + 1;
}

export function reindexObjectives(objectives: ObjectiveDefinition[]): ObjectiveDefinition[] {
  return objectives.map((o, i) => ({ ...o, id: i + 1 }));
}

export function objectiveCompletionSummary(content: ScenarioTemplateContent): string {
  const n = content.objectives.length;
  return n === 1 ? "1 objective" : `${n} objectives`;
}
