import { IntentClassification, ClassificationDecision } from "@/lib/ai/types";
import {
  ActionDefinition,
  ActionTargetType,
  ScenarioTemplateContent,
  getDefaultActionRequirements,
  resolveActionTargetType,
} from "@/lib/templates/schema";
import { deriveClarificationQuestion } from "@/lib/ai/classifier";

export interface ValidatedActionDecision {
  decision: ClassificationDecision;
  classification: IntentClassification;
  approvedActionId: string | null;
  validationFailed: boolean;
  validationReason: string | null;
  clarification: string | null;
}

const PLACEHOLDER_VALUES = new Set([
  "",
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "unknown",
  "something",
  "anything",
  "whatever",
  "tbd",
  "xxx",
  "foo",
  "bar",
  "test",
]);

const METHOD_ALIASES: Record<string, string[]> = {
  type: ["type", "get-content", "cat", "notepad"],
  "get-content": ["get-content", "type", "cat"],
  notepad: ["notepad", "type", "get-content"],
  ping: ["ping"],
  nslookup: ["nslookup"],
  ipconfig: ["ipconfig"],
  powershell: ["powershell", "pwsh"],
  rdp: ["rdp", "remote desktop", "mstsc", "remote"],
  call: ["call", "phone", "ask", "talk"],
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(message: string): string[] {
  return normalize(message)
    .split(/[^a-z0-9._\\/-]+/)
    .filter(Boolean);
}

function isMeaningfulValue(value: string | null | undefined): boolean {
  const n = normalize(value);
  if (n.length < 2) return false;
  return !PLACEHOLDER_VALUES.has(n);
}

function messageContainsValue(message: string, value: string): boolean {
  const msg = normalize(message);
  const v = normalize(value);
  if (!v || !msg) return false;
  // Exact token/phrase match — not permissive substring of unrelated words
  if (msg.includes(v)) {
    const idx = msg.indexOf(v);
    const before = idx === 0 ? " " : msg[idx - 1];
    const after = idx + v.length >= msg.length ? " " : msg[idx + v.length];
    const boundary = /[\s"'`.,;:!?()[\]{}<>/\\-]/.test(before) || before === " ";
    const boundaryEnd = /[\s"'`.,;:!?()[\]{}<>/\\-]/.test(after) || after === " ";
    if (boundary && boundaryEnd) return true;
  }
  const tokens = new Set(tokenize(message));
  return tokens.has(v) || v.split(" ").every((part) => tokens.has(part));
}

function matchesAllowed(value: string, allowed: string[], aliases?: Record<string, string[]>): boolean {
  const n = normalize(value);
  for (const entry of allowed) {
    const a = normalize(entry);
    if (n === a) return true;
    if (aliases) {
      const expanded = aliases[a] ?? [a];
      if (expanded.some((alias) => n === normalize(alias))) return true;
    }
  }
  return false;
}

function hasNegatedMethod(message: string, method: string): boolean {
  const msg = normalize(message);
  const m = normalize(method);
  return (
    new RegExp(`\\b(don'?t|do not|without|not)\\b[^.?]{0,40}\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
      msg,
    )
  );
}

function hasMultipleUnrelatedActions(message: string): boolean {
  const connectors = /\b(?:and then|then also|also run|after that|next run|;)\b/i;
  const commandLike = (
    message.match(/\b(ping|nslookup|ipconfig|tracert|type|get-content|get-aduser|rdp|remote)\b/gi) ?? []
  ).length;
  return connectors.test(message) && commandLike >= 2;
}

function requirementsFor(action: ActionDefinition) {
  return action.requirements ?? getDefaultActionRequirements(undefined, { category: action.category });
}

function clarificationFor(
  classification: IntentClassification,
  candidateMessage: string,
  action?: ActionDefinition | null,
): string {
  const targetType: ActionTargetType | null = action
    ? resolveActionTargetType(action)
    : classification.targetType;
  return deriveClarificationQuestion(classification, { targetType, candidateMessage });
}

function resolveAction(
  content: ScenarioTemplateContent,
  classification: IntentClassification,
): ActionDefinition | null {
  if (!classification.matchedActionId) return null;
  return content.actions.find((a) => a.id === classification.matchedActionId) ?? null;
}

/**
 * Server-side gate: AI classification is advisory only.
 * Evidence may be selected only when this returns an approved action ID.
 */
export function validateClassifiedAction(
  content: ScenarioTemplateContent,
  classification: IntentClassification,
  candidateMessage = "",
): ValidatedActionDecision {
  const base = { classification, clarification: null as string | null };
  const hintedAction = resolveAction(content, classification);

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
          ? clarificationFor(classification, candidateMessage, hintedAction)
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
      clarification: clarificationFor(classification, candidateMessage, hintedAction),
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

  const requirements = requirementsFor(action);
  const targetType = resolveActionTargetType(action);

  // Legacy / unreviewed actions cannot unlock evidence via classifier alone
  if (!requirements.requirementsReviewed) {
    return {
      ...base,
      decision: "UNAVAILABLE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "requirements_unreviewed",
      clarification: clarificationFor(
        {
          ...classification,
          decision: "INCOMPLETE_ACTION",
          missingFields: ["methodOrTool"],
          targetType,
        },
        candidateMessage,
        action,
      ),
    };
  }

  const missing: string[] = [];

  if (!requirements.intentionallyUnrestricted) {
    if (requirements.requireTarget && targetType !== "none") {
      if (!isMeaningfulValue(classification.target)) {
        missing.push("target");
      } else if (candidateMessage && !messageContainsValue(candidateMessage, classification.target!)) {
        missing.push("target");
      }
    }

    if (requirements.requireMethodOrTool) {
      if (!isMeaningfulValue(classification.methodOrTool)) {
        missing.push("methodOrTool");
      } else if (
        candidateMessage &&
        !messageContainsValue(candidateMessage, classification.methodOrTool!)
      ) {
        missing.push("methodOrTool");
      } else if (
        classification.methodOrTool &&
        hasNegatedMethod(candidateMessage, classification.methodOrTool)
      ) {
        missing.push("methodOrTool");
      }
    }

    for (const param of requirements.requiredParameters) {
      const value = classification.parameters[param];
      if (!isMeaningfulValue(value)) {
        missing.push(param);
      } else if (candidateMessage && !messageContainsValue(candidateMessage, value)) {
        missing.push(param);
      }
    }

    if (requirements.allowedTargets.length > 0) {
      if (!classification.target || !matchesAllowed(classification.target, requirements.allowedTargets)) {
        missing.push("target");
      }
    }

    if (requirements.allowedMethods.length > 0) {
      if (
        !classification.methodOrTool ||
        !matchesAllowed(classification.methodOrTool, requirements.allowedMethods, METHOD_ALIASES)
      ) {
        missing.push("methodOrTool");
      }
    }
  }

  if (missing.length > 0) {
    const adjusted: IntentClassification = {
      ...classification,
      decision: "INCOMPLETE_ACTION",
      targetType,
      missingFields: [...new Set(missing)],
      matchedActionId: null,
    };
    return {
      classification: adjusted,
      decision: "INCOMPLETE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "requirements_not_met",
      clarification: clarificationFor(adjusted, candidateMessage, action),
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
