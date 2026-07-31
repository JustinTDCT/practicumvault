import { z } from "zod";

export const classificationDecisionSchema = z.enum([
  "VALID_ACTION",
  "AMBIGUOUS_ACTION",
  "INCOMPLETE_ACTION",
  "DELEGATION_REQUEST",
  "ANSWER_SEEKING",
  "META_OR_PROMPT_ATTACK",
  "REFERENCE_QUESTION",
  "UNAVAILABLE_ACTION",
  "MULTIPLE_ACTIONS",
]);

export type ClassificationDecision = z.infer<typeof classificationDecisionSchema>;

export const intentClassificationSchema = z.object({
  decision: classificationDecisionSchema,
  targetSystem: z.string().nullable(),
  methodOrTool: z.string().nullable(),
  requestedAction: z.string().nullable(),
  parameters: z.record(z.string()).default({}),
  matchedActionId: z.string().nullable(),
  missingFields: z.array(z.string()).default([]),
  reasoning: z.string(),
});

export type IntentClassification = z.infer<typeof intentClassificationSchema>;

export type TurnResponseType =
  | "simulation_evidence"
  | "clarification"
  | "delegation_refusal"
  | "answer_seeking_refusal"
  | "prompt_attack_refusal"
  | "reference_answer"
  | "multiple_actions_clarification"
  | "unavailable_action"
  | "policy_violation";

export interface TurnStructuredRecord {
  candidateMessageId: string;
  classificationDecision: ClassificationDecision;
  targetSystem: string | null;
  methodOrTool: string | null;
  requestedAction: string | null;
  parameters: Record<string, string>;
  matchedActionId: string | null;
  missingFields: string[];
  responseType: TurnResponseType;
  evidenceIds: string[];
  classifierModel: string;
  responderModel: string;
}

export interface UnsafeActionRecord {
  unsafeActionId: string;
  penalty: number;
  candidateMessageId: string;
  detectionMethod: "keyword" | "pattern" | "ai";
  description: string;
  detectedAt: string;
}
