import { generateText, streamText, LanguageModel } from "ai";
import { withReservedModelCall } from "@/lib/ai/provider-calls";
import { IntentClassification, TurnResponseType } from "@/lib/ai/types";
import {
  ANSWER_SEEKING_REFUSAL,
  DELEGATION_REFUSAL,
  PROMPT_ATTACK_REFUSAL,
  deriveClarificationQuestion,
} from "@/lib/ai/classifier";
import { createPolicyViolationStreamResponse } from "@/lib/ai/cheat-detection";
import { ScenarioTemplateContent } from "@/lib/templates/schema";

export function lookupScenarioAction(
  content: ScenarioTemplateContent,
  actionId: string | null,
): { id: string; label: string; result: string; category: string } | null {
  if (!actionId) return null;
  const action = content.actions.find((a) => a.id === actionId);
  return action ?? null;
}

export function resolveResponseType(classification: IntentClassification): TurnResponseType {
  switch (classification.decision) {
    case "VALID_ACTION":
      return "simulation_response";
    case "AMBIGUOUS_ACTION":
    case "INCOMPLETE_ACTION":
      return "simulation_response";
    case "DELEGATION_REQUEST":
      return "delegation_refusal";
    case "ANSWER_SEEKING":
      return "answer_seeking_refusal";
    case "META_OR_PROMPT_ATTACK":
      return "prompt_attack_refusal";
    case "REFERENCE_QUESTION":
      return "reference_answer";
    case "MULTIPLE_ACTIONS":
      return "simulation_response";
    case "UNAVAILABLE_ACTION":
      return "simulation_response";
    default:
      return "simulation_response";
  }
}

export function isPolicyRefusalDecision(decision: IntentClassification["decision"]): boolean {
  return (
    decision === "DELEGATION_REQUEST" ||
    decision === "ANSWER_SEEKING" ||
    decision === "META_OR_PROMPT_ATTACK"
  );
}

export function buildStaticResponse(classification: IntentClassification): string | null {
  switch (classification.decision) {
    case "DELEGATION_REQUEST":
      return DELEGATION_REFUSAL;
    case "ANSWER_SEEKING":
      return ANSWER_SEEKING_REFUSAL;
    case "META_OR_PROMPT_ATTACK":
      return PROMPT_ATTACK_REFUSAL;
    case "AMBIGUOUS_ACTION":
    case "INCOMPLETE_ACTION":
      return deriveClarificationQuestion(classification);
    case "MULTIPLE_ACTIONS":
      return deriveClarificationQuestion(classification);
    case "UNAVAILABLE_ACTION":
      return "That action is not available in this environment.";
    default:
      return null;
  }
}

export function buildFormattingPrompt(
  evidence: string,
  target: string | null,
  actionLabel: string | null,
): string {
  return `Format the following simulation evidence for a technical practicum candidate.

Rules:
- Output ONLY the formatted evidence the candidate would see or hear
- Do NOT add facts, interpretations, suggestions, or next steps
- Do NOT reveal objectives, scoring, or hidden scenario information
- Label the source machine or speaker when relevant
- Use markdown for command output, logs, or dialogue as appropriate

Target: ${target ?? "unspecified"}
Action: ${actionLabel ?? "candidate request"}

Evidence to format (source of truth — do not add to this):
"""
${evidence}
"""`;
}

export function buildReferencePrompt(question: string): string {
  return `Answer this general technical reference question for a practicum candidate.

Rules:
- Provide general technical knowledge only
- Do NOT identify scenario root cause or hidden facts
- Do NOT tell the candidate what to do next
- Do NOT mention which scenario actions would solve an issue

Question: ${question}`;
}

export function buildDialogueFormattingPrompt(
  approvedFacts: string,
  candidateRequest: string,
): string {
  return `Format an end-user dialogue response for a technical simulation.

Rules:
- Use ONLY the approved facts below
- Do NOT invent new technical details
- Do NOT suggest next diagnostic steps
- Format as realistic phone/chat dialogue

Candidate request: ${candidateRequest}

Approved facts:
"""
${approvedFacts}
"""`;
}

export async function formatEvidenceResponse(
  model: LanguageModel,
  evidence: string,
  target: string | null,
  actionLabel: string | null,
): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: buildFormattingPrompt(evidence, target, actionLabel),
  });
  return text.trim();
}

export async function formatReferenceResponse(
  model: LanguageModel,
  question: string,
  attemptId?: string,
): Promise<string> {
  const run = async () => {
    const { text } = await generateText({
      model,
      prompt: buildReferencePrompt(question),
    });
    return text.trim();
  };
  if (!attemptId) return run();
  return withReservedModelCall(attemptId, run);
}

export function streamStaticResponse(text: string): Response {
  return createPolicyViolationStreamResponse(text);
}

export function streamFormattedResponse(
  model: LanguageModel,
  evidence: string,
  target: string | null,
  actionLabel: string | null,
): Response {
  const result = streamText({
    model,
    prompt: buildFormattingPrompt(evidence, target, actionLabel),
  });
  return result.toDataStreamResponse();
}

export function selectEvidenceForAction(
  content: ScenarioTemplateContent,
  actionId: string,
): { evidence: string; evidenceIds: string[] } {
  const action = content.actions.find((a) => a.id === actionId);
  if (!action) {
    return { evidence: "The requested action produced no output.", evidenceIds: [] };
  }
  return { evidence: action.result, evidenceIds: [action.id] };
}

/**
 * Optional authored dialogue/result for a matched action.
 * Never falls back to dumping all hidden facts.
 */
export function getApprovedDialogueFacts(
  content: ScenarioTemplateContent,
  actionId: string | null,
): string {
  if (!actionId) return "";
  const action = content.actions.find((a) => a.id === actionId);
  return action?.result ?? "";
}
