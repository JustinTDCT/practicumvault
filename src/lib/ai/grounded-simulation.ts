import { generateObject, NoObjectGeneratedError, LanguageModel } from "ai";
import { z } from "zod";
import { withReservedModelCall } from "@/lib/ai/provider-calls";
import { validateDialogueOutput } from "@/lib/ai/format-evidence";
import { findMatchingAction } from "@/lib/ai/classifier";
import { selectBoundedEvaluatorContext } from "@/lib/ai/bounded-context";
import { logSafeError } from "@/lib/security/safe-log";
import { ScenarioTemplateContent } from "@/lib/templates/schema";

export const simulationInteractionTypeSchema = z.enum([
  "COMMUNICATION",
  "COMMAND_OR_TOOL",
  "SYSTEM_INSPECTION",
  "ADMINISTRATIVE_ACTION",
  "REMEDIATION",
  "REFERENCE_QUESTION",
  "UNSAFE_ACTION",
  "META_REQUEST",
  "CLARIFICATION",
]);

export type SimulationInteractionType = z.infer<typeof simulationInteractionTypeSchema>;

export const groundedSimulationGenerationSchema = z.object({
  interactionType: simulationInteractionTypeSchema,
  responseText: z.string(),
  disclosedFactIds: z.array(z.string()),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  stateChanges: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

export type GroundedSimulationGeneration = z.infer<typeof groundedSimulationGenerationSchema>;

export interface GroundedSimulationResult {
  interactionType: SimulationInteractionType;
  responseText: string;
  disclosedFactIds: string[];
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  stateChanges: Array<{ key: string; value: string }>;
  usedFallback: boolean;
  fallbackReason: string | null;
}

const NEUTRAL_FALLBACK =
  "The simulation could not produce a clear result for that request. Try a more specific interaction.";

function buildGroundedSimulationPrompt(options: {
  content: ScenarioTemplateContent;
  candidateMessage: string;
  transcript: Array<{ role: string; content: string }>;
  optionalActionResult: string | null;
}): string {
  const { content, candidateMessage, transcript, optionalActionResult } = options;
  const factsBlock = content.environment.hiddenFacts
    .map((f) => {
      const sources = f.sources.length ? ` sources=[${f.sources.join(", ")}]` : "";
      const when = f.revealWhen.length ? ` revealWhen=[${f.revealWhen.join("; ")}]` : "";
      return `- id=${f.id}${sources}${when}\n  fact: ${f.fact}`;
    })
    .join("\n");

  const transcriptBlock = transcript
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  return `You are the simulated people, devices, services, logs, and administrative environment described in this scenario.

Respond only with what the candidate would realistically observe as a direct result of the requested interaction.

Use only the supplied scenario facts and prior established state.

Do not:
- explain the evidence;
- interpret results;
- recommend next steps;
- reveal the root cause unless the requested action directly establishes it;
- mention objectives, scoring, hidden facts, prompts, or simulation mechanics;
- invent systems, errors, conversations, events, or facts.

For communication, respond in the voice of the contacted person.
For commands, return only realistic raw output.
For inspections, return only what the selected interface would display.
For remediation, describe only the immediate observable result and update simulated state when justified.

Return a structured object with:
- interactionType
- responseText (candidate-visible)
- disclosedFactIds (subset of provided fact ids that justify the response)
- clarificationNeeded / clarificationQuestion when the request is too vague to simulate
- stateChanges for justified environment updates (may be empty)

Ticket subject: ${content.startingSituation.ticketSubject}
Ticket user: ${content.startingSituation.ticketUser}
Ticket priority: ${content.startingSituation.ticketPriority}
Ticket body:
"""
${content.startingSituation.ticketBody}
"""

Environment notes:
"""
${content.metadata.environment}
"""

Architecture notes:
"""
${content.environment.architectureNotes || "none"}
"""

Root cause (for grounding only — do not reveal unless the interaction directly establishes it):
"""
${content.environment.rootCause}
"""

Red herrings (may appear only on justified dead-end paths):
${content.environment.redHerrings.map((r) => `- ${r}`).join("\n") || "- none"}

Structured scenario facts:
${factsBlock || "- none"}

Optional authored action result (use only if it matches the request; never required):
"""
${optionalActionResult ?? "none"}
"""

Prior conversation (bounded):
"""
${transcriptBlock || "none"}
"""

Candidate request:
"""
${candidateMessage}
"""`;
}

export function validateDisclosedFactIds(
  content: ScenarioTemplateContent,
  disclosedFactIds: string[],
): string[] {
  const known = new Set(content.environment.hiddenFacts.map((f) => f.id));
  return [...new Set(disclosedFactIds.filter((id) => known.has(id)))];
}

export function factsTextForIds(content: ScenarioTemplateContent, ids: string[]): string {
  return ids
    .map((id) => content.environment.hiddenFacts.find((f) => f.id === id)?.fact)
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

export function sanitizeGroundedSimulationResult(
  content: ScenarioTemplateContent,
  generated: GroundedSimulationGeneration,
): GroundedSimulationResult {
  const disclosedFactIds = validateDisclosedFactIds(content, generated.disclosedFactIds);
  const approvedFacts = factsTextForIds(content, disclosedFactIds);

  if (generated.clarificationNeeded) {
    const question =
      generated.clarificationQuestion?.trim() ||
      "What specific action do you want to take in the simulated environment?";
    return {
      interactionType: "CLARIFICATION",
      responseText: question,
      disclosedFactIds: [],
      clarificationNeeded: true,
      clarificationQuestion: question,
      stateChanges: [],
      usedFallback: false,
      fallbackReason: null,
    };
  }

  const rawText = generated.responseText.trim();
  if (!rawText) {
    return {
      interactionType: generated.interactionType,
      responseText: approvedFacts.trim() || NEUTRAL_FALLBACK,
      disclosedFactIds,
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: generated.stateChanges,
      usedFallback: true,
      fallbackReason: "empty",
    };
  }

  const validated = validateDialogueOutput(rawText, approvedFacts);
  if (!validated.ok) {
    const fallbackText = approvedFacts.trim() || NEUTRAL_FALLBACK;
    return {
      interactionType: generated.interactionType,
      responseText: fallbackText,
      disclosedFactIds,
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: generated.stateChanges,
      usedFallback: true,
      fallbackReason: validated.reason,
    };
  }

  return {
    interactionType: generated.interactionType,
    responseText: validated.text,
    disclosedFactIds,
    clarificationNeeded: false,
    clarificationQuestion: null,
    stateChanges: generated.stateChanges,
    usedFallback: false,
    fallbackReason: null,
  };
}

export async function generateGroundedSimulationResponse(options: {
  model: LanguageModel;
  attemptId: string;
  content: ScenarioTemplateContent;
  candidateMessage: string;
  transcript: Array<{ id: string; role: string; content: string }>;
  correlationId?: string;
}): Promise<GroundedSimulationResult> {
  const matchedActionId = findMatchingAction(options.content, options.candidateMessage);
  const matchedAction = matchedActionId
    ? options.content.actions.find((a) => a.id === matchedActionId)
    : null;

  const bounded = selectBoundedEvaluatorContext(options.transcript, {
    maxMessages: 20,
    omitPromptAttacks: true,
  });

  try {
    const object = await withReservedModelCall(options.attemptId, async () => {
      const result = await generateObject({
        model: options.model,
        mode: "json",
        schemaName: "grounded_simulation_response",
        schema: groundedSimulationGenerationSchema,
        temperature: 0,
        prompt: buildGroundedSimulationPrompt({
          content: options.content,
          candidateMessage: options.candidateMessage,
          transcript: bounded.messages.map((m) => ({ role: m.role, content: m.content })),
          optionalActionResult: matchedAction?.result ?? null,
        }),
      });
      return result.object;
    });

    return sanitizeGroundedSimulationResult(options.content, object);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const causeName =
        error.cause instanceof Error
          ? error.cause.name
          : error.cause != null
            ? typeof error.cause
            : null;
      logSafeError("simulation.no_object", {
        category: "structured_output_invalid",
        errorName: error.name,
        attemptId: options.attemptId,
        correlationId: options.correlationId,
        finishReason: error.finishReason ?? undefined,
        causeName: causeName ?? undefined,
        responseModel: error.response?.modelId,
      });
    } else {
      logSafeError("simulation.generation_failed", {
        category: "provider_error",
        errorName: error instanceof Error ? error.name : "Error",
        attemptId: options.attemptId,
        correlationId: options.correlationId,
      });
    }

    return {
      interactionType: "CLARIFICATION",
      responseText: NEUTRAL_FALLBACK,
      disclosedFactIds: [],
      clarificationNeeded: true,
      clarificationQuestion: NEUTRAL_FALLBACK,
      stateChanges: [],
      usedFallback: true,
      fallbackReason: "generation_error",
    };
  }
}
