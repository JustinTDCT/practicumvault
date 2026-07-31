import { ObjectiveDefinition, ScenarioTemplateContent } from "@/lib/templates/schema";

function slugFactId(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug ? `fact-${slug}` : `fact-${index + 1}`;
}

/** Coerce legacy string hiddenFacts into structured fact objects. */
export function normalizeHiddenFacts(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry === "string") {
      let id = slugFactId(entry, index);
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      return { id, fact: entry, sources: [], revealWhen: [] };
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const fact =
        typeof obj.fact === "string"
          ? obj.fact
          : typeof obj.text === "string"
            ? obj.text
            : "";
      let id =
        typeof obj.id === "string" && obj.id.trim()
          ? obj.id.trim()
          : slugFactId(fact || `fact-${index + 1}`, index);
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      return {
        id,
        fact,
        sources: Array.isArray(obj.sources)
          ? obj.sources.filter((s): s is string => typeof s === "string")
          : [],
        revealWhen: Array.isArray(obj.revealWhen)
          ? obj.revealWhen.filter((s): s is string => typeof s === "string")
          : [],
      };
    }
    return { id: `fact-${index + 1}`, fact: String(entry ?? ""), sources: [], revealWhen: [] };
  });
}

/** Normalize legacy `gates` JSON to `objectives` when loading templates. */
export function normalizeTemplateRawContent(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (!obj.objectives && Array.isArray(obj.gates)) {
    obj.objectives = obj.gates;
  }

  delete obj.gates;

  if (obj.environment && typeof obj.environment === "object" && !Array.isArray(obj.environment)) {
    const env = { ...(obj.environment as Record<string, unknown>) };
    if ("hiddenFacts" in env) {
      env.hiddenFacts = normalizeHiddenFacts(env.hiddenFacts);
    }
    obj.environment = env;
  }

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
