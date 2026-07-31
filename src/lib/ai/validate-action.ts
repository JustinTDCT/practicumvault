import { IntentClassification, ClassificationDecision } from "@/lib/ai/types";
import { ScenarioTemplateContent } from "@/lib/templates/schema";
import { deriveClarificationQuestion } from "@/lib/ai/classifier";

export interface ValidatedActionDecision {
  decision: ClassificationDecision;
  classification: IntentClassification;
  approvedActionId: string | null;
  validationFailed: boolean;
  validationReason: string | null;
  clarification: string | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function hasMultipleUnrelatedActions(message: string): boolean {
  const connectors = /\b(?:and then|then also|also run|after that|next run|;)\b/i;
  const commandLike = (message.match(/\b(ping|nslookup|ipconfig|tracert|type|get-content|get-aduser|rdp|remote)\b/gi) ?? []).length;
  return connectors.test(message) && commandLike >= 2;
}

/**
 * Server-side gate: AI classification is advisory only.
 * Evidence may be selected only when this returns an approved action ID.
 */
export function validateClassifiedAction(
  content: ScenarioTemplateContent,
  classification: IntentClassification,
  candidateMessage?: string,
): ValidatedActionDecision {
  const base = { classification, clarification: null as string | null };

  if (classification.decision !== "VALID_ACTION") {
    return {
      ...base,
      decision: classification.decision,
      approvedActionId: null,
      validationFailed: false,
      validationReason: null,
      clarification:
        classification.decision === "AMBIGUOUS_ACTION" ||
        classification.decision === "INCOMPLETE_ACTION" ||
        classification.decision === "MULTIPLE_ACTIONS"
          ? deriveClarificationQuestion(classification)
          : null,
    };
  }

  if (candidateMessage && hasMultipleUnrelatedActions(candidateMessage)) {
    return {
      ...base,
      decision: "MULTIPLE_ACTIONS",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "multiple_unrelated_actions",
      clarification: "Which action do you want to perform first?",
    };
  }

  if (classification.missingFields.length > 0) {
    return {
      ...base,
      decision: "INCOMPLETE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "missing_fields",
      clarification: deriveClarificationQuestion(classification),
    };
  }

  const actionId = classification.matchedActionId;
  if (!actionId) {
    return {
      ...base,
      decision: "UNAVAILABLE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "no_matched_action",
      clarification: null,
    };
  }

  const action = content.actions.find((a) => a.id === actionId);
  if (!action) {
    return {
      ...base,
      decision: "UNAVAILABLE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "unknown_action_id",
      clarification: null,
    };
  }

  const requirements = action.requirements ?? {
    requireTargetSystem: false,
    requireMethodOrTool: false,
    requiredParameters: [],
    allowedTargets: [],
    allowedMethods: [],
  };

  const missing: string[] = [];

  if (requirements.requireTargetSystem && !classification.targetSystem) {
    missing.push("targetSystem");
  }
  if (requirements.requireMethodOrTool && !classification.methodOrTool) {
    missing.push("methodOrTool");
  }
  for (const param of requirements.requiredParameters) {
    if (!classification.parameters[param]) {
      missing.push(param);
    }
  }

  if (requirements.allowedTargets.length > 0 && classification.targetSystem) {
    const target = normalize(classification.targetSystem);
    const allowed = requirements.allowedTargets.some((t) => target.includes(normalize(t)));
    if (!allowed) {
      missing.push("targetSystem");
    }
  }

  if (requirements.allowedMethods.length > 0 && classification.methodOrTool) {
    const method = normalize(classification.methodOrTool);
    const allowed = requirements.allowedMethods.some((m) => method.includes(normalize(m)));
    if (!allowed) {
      missing.push("methodOrTool");
    }
  }

  if (missing.length > 0) {
    const adjusted: IntentClassification = {
      ...classification,
      decision: "INCOMPLETE_ACTION",
      missingFields: missing,
      matchedActionId: null,
    };
    return {
      classification: adjusted,
      decision: "INCOMPLETE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "requirements_not_met",
      clarification: deriveClarificationQuestion(adjusted),
    };
  }

  return {
    ...base,
    decision: "VALID_ACTION",
    approvedActionId: action.id,
    validationFailed: false,
    validationReason: null,
    clarification: null,
  };
}
