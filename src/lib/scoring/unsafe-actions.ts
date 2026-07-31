import { ScenarioTemplateContent } from "@/lib/templates/schema";
import { UnsafeActionRecord } from "@/lib/ai/types";
import { generateText } from "ai";
import { LanguageModel } from "ai";
import { z } from "zod";

export interface UnsafeActionDefinition {
  id: string;
  description: string;
  penalty: number;
  keywords: string[];
  allowRepeatPenalty?: boolean;
}

export function normalizeUnsafeActions(
  content: ScenarioTemplateContent,
): UnsafeActionDefinition[] {
  return content.scoringRubric.unsafeActions.map((u, index) => ({
    id: (u as { id?: string }).id ?? `unsafe-${index + 1}`,
    description: u.description,
    penalty: u.penalty,
    keywords: u.keywords ?? [],
    allowRepeatPenalty: (u as { allowRepeatPenalty?: boolean }).allowRepeatPenalty ?? false,
  }));
}

function matchByKeywords(message: string, definitions: UnsafeActionDefinition[]): UnsafeActionDefinition | null {
  const lower = message.toLowerCase();
  for (const def of definitions) {
    if (def.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return def;
    }
  }
  return null;
}

const aiUnsafeSchema = z.object({
  unsafe: z.boolean(),
  unsafeActionId: z.string().nullable(),
});

export async function detectUnsafeActionDeterministic(
  content: ScenarioTemplateContent,
  message: string,
  existingRecords: UnsafeActionRecord[],
  candidateMessageId: string,
  model?: LanguageModel,
): Promise<UnsafeActionRecord | null> {
  const definitions = normalizeUnsafeActions(content);

  const keywordMatch = matchByKeywords(message, definitions);
  if (keywordMatch) {
    if (
      !keywordMatch.allowRepeatPenalty &&
      existingRecords.some((r) => r.unsafeActionId === keywordMatch.id)
    ) {
      return null;
    }
    return {
      unsafeActionId: keywordMatch.id,
      penalty: keywordMatch.penalty,
      candidateMessageId,
      detectionMethod: "keyword",
      description: keywordMatch.description,
      detectedAt: new Date().toISOString(),
    };
  }

  if (!model || definitions.length === 0) return null;

  const { text } = await generateText({
    model,
    prompt: `Determine if this candidate action matches a predefined unsafe action.

Unsafe actions (respond with matching ID or null):
${definitions.map((d) => `- ID: ${d.id} | ${d.description}`).join("\n")}

Candidate action: "${message}"

Respond JSON only: {"unsafe": boolean, "unsafeActionId": string|null}`,
  });

  try {
    const parsed = aiUnsafeSchema.parse(JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()));
    if (!parsed.unsafe || !parsed.unsafeActionId) return null;

    const def = definitions.find((d) => d.id === parsed.unsafeActionId);
    if (!def) return null;

    if (!def.allowRepeatPenalty && existingRecords.some((r) => r.unsafeActionId === def.id)) {
      return null;
    }

    return {
      unsafeActionId: def.id,
      penalty: def.penalty,
      candidateMessageId,
      detectionMethod: "ai",
      description: def.description,
      detectedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function sumUnsafePenalties(records: UnsafeActionRecord[]): number {
  return records.reduce((sum, r) => sum + r.penalty, 0);
}
