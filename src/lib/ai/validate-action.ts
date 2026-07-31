import { IntentClassification, ClassificationDecision } from "@/lib/ai/types";
import { deriveClarificationQuestion, findMatchingAction } from "@/lib/ai/classifier";
import {
  ActionDefinition,
  ActionTargetType,
  ScenarioTemplateContent,
  getDefaultActionRequirements,
  resolveActionTargetType,
} from "@/lib/templates/schema";

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
};

const COMMUNICATION_METHOD_VARIANTS: Record<string, string[]> = {
  call: ["call", "phone", "telephone", "ring"],
  email: ["email", "e-mail"],
  message: ["chat", "message", "teams", "slack"],
  contact: ["ask", "talk", "speak", "contact"],
};

export function inferCommunicationMethod(message: string): string | null {
  if (/\b(call|phone|telephone|ring)\b/i.test(message)) {
    return "call";
  }
  if (/\b(email|e-mail)\b/i.test(message)) {
    return "email";
  }
  if (/\b(chat|message|teams|slack)\b/i.test(message)) {
    return "message";
  }
  if (/\b(ask|talk|speak|contact)\b/i.test(message)) {
    return "contact";
  }
  return null;
}

export function canonicalMethod(value: string): string {
  const normalized = value.trim().toLowerCase();
  for (const [canonical, variants] of Object.entries(COMMUNICATION_METHOD_VARIANTS)) {
    if (variants.includes(normalized)) return canonical;
  }
  return normalized;
}

export function matchesAllowedMethod(actual: string, allowed: string[]): boolean {
  const canonicalActual = canonicalMethod(actual);
  return allowed.some((entry) => canonicalMethod(entry) === canonicalActual);
}

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

function methodPresentInMessage(message: string, method: string): boolean {
  const canonical = canonicalMethod(method);
  const variants = COMMUNICATION_METHOD_VARIANTS[canonical] ?? [canonical];
  return variants.some((variant) => messageContainsValue(message, variant));
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
  const variants = COMMUNICATION_METHOD_VARIANTS[canonicalMethod(method)] ?? [normalize(method)];
  return variants.some((m) =>
    new RegExp(
      `\\b(don'?t|do not|without|not)\\b[^.?]{0,40}\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(msg),
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

function normalizeMissingFieldName(field: string): string | null {
  const n = field.trim().toLowerCase();
  if (!n) return null;
  if (
    n === "target" ||
    n === "targetsystem" ||
    n.includes("target") ||
    n === "who" ||
    n === "person" ||
    n === "contact"
  ) {
    return "target";
  }
  if (n === "methodortool" || n.includes("method") || n.includes("tool") || n === "how") {
    return "methodOrTool";
  }
  if (n === "objectorparameters" || n === "object" || n === "parameters") return "objectOrParameters";
  if (n === "log" || n === "setting" || n === "requestedaction") {
    return n === "requestedaction" ? "requestedAction" : n;
  }
  // Drop model-invented noise that is not part of the validation contract.
  return null;
}

function normalizeMissingFields(
  fields: string[],
  classification: IntentClassification,
): string[] {
  const normalized = fields
    .map(normalizeMissingFieldName)
    .filter((field): field is string => field != null);

  return [...new Set(normalized)].filter((field) => {
    if (field === "target" && isMeaningfulValue(classification.target)) return false;
    if (field === "methodOrTool" && isMeaningfulValue(classification.methodOrTool)) return false;
    if (field === "requestedAction" && isMeaningfulValue(classification.requestedAction)) return false;
    return true;
  });
}

function inferTargetFromAllowed(message: string, allowedTargets: string[]): string | null {
  for (const allowed of allowedTargets) {
    if (messageContainsValue(message, allowed)) return allowed;
  }
  return null;
}

/**
 * Deterministic communication enrichment before the server-side gate.
 * Does not trust the model to notice an obvious contact verb.
 */
export function enrichClassificationForValidation(
  content: ScenarioTemplateContent,
  classification: IntentClassification,
  candidateMessage: string,
): { classification: IntentClassification; action: ActionDefinition | null } {
  const enriched: IntentClassification = {
    ...classification,
    missingFields: [...classification.missingFields],
  };

  let action = resolveAction(content, enriched);
  if (!action && candidateMessage) {
    const matchedId = findMatchingAction(content, candidateMessage);
    if (matchedId) {
      enriched.matchedActionId = matchedId;
      action = content.actions.find((a) => a.id === matchedId) ?? null;
    }
  }

  const isCommunication =
    action?.category === "communication" || enriched.targetType === "person";

  if (isCommunication && candidateMessage) {
    if (!isMeaningfulValue(enriched.methodOrTool)) {
      const inferredMethod = inferCommunicationMethod(candidateMessage);
      if (inferredMethod) {
        enriched.methodOrTool = inferredMethod;
      }
    } else {
      enriched.methodOrTool = canonicalMethod(enriched.methodOrTool!);
    }

    if (!isMeaningfulValue(enriched.target) && action) {
      const inferredTarget = inferTargetFromAllowed(
        candidateMessage,
        requirementsFor(action).allowedTargets,
      );
      if (inferredTarget) {
        enriched.target = inferredTarget;
      }
    }

    if (!enriched.targetType) {
      enriched.targetType = action ? resolveActionTargetType(action) : "person";
    }
  }

  enriched.missingFields = normalizeMissingFields(enriched.missingFields, enriched);

  if (
    enriched.decision !== "VALID_ACTION" &&
    action?.category === "communication" &&
    enriched.matchedActionId &&
    enriched.missingFields.length === 0 &&
    isMeaningfulValue(enriched.methodOrTool) &&
    (!requirementsFor(action).requireTarget || isMeaningfulValue(enriched.target))
  ) {
    enriched.decision = "VALID_ACTION";
  }

  return { classification: enriched, action };
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
  const { classification: enriched, action: hintedAction } = enrichClassificationForValidation(
    content,
    classification,
    candidateMessage,
  );
  const base = { classification: enriched, clarification: null as string | null };

  if (enriched.decision !== "VALID_ACTION") {
    return {
      ...base,
      decision: enriched.decision,
      approvedActionId: null,
      validationFailed: false,
      validationReason: null,
      clarification:
        enriched.decision === "AMBIGUOUS_ACTION" ||
        enriched.decision === "INCOMPLETE_ACTION" ||
        enriched.decision === "MULTIPLE_ACTIONS"
          ? clarificationFor(enriched, candidateMessage, hintedAction)
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

  if (enriched.missingFields.length > 0) {
    return {
      ...base,
      decision: "INCOMPLETE_ACTION",
      approvedActionId: null,
      validationFailed: true,
      validationReason: "missing_fields",
      clarification: clarificationFor(enriched, candidateMessage, hintedAction),
    };
  }

  const actionId = enriched.matchedActionId;
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
  const isCommunication = action.category === "communication";

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
          ...enriched,
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
      if (!isMeaningfulValue(enriched.target)) {
        missing.push("target");
      } else if (candidateMessage && !messageContainsValue(candidateMessage, enriched.target!)) {
        missing.push("target");
      }
    }

    if (requirements.requireMethodOrTool) {
      if (!isMeaningfulValue(enriched.methodOrTool)) {
        missing.push("methodOrTool");
      } else if (candidateMessage) {
        const present = isCommunication
          ? methodPresentInMessage(candidateMessage, enriched.methodOrTool!)
          : messageContainsValue(candidateMessage, enriched.methodOrTool!);
        if (!present) {
          missing.push("methodOrTool");
        } else if (hasNegatedMethod(candidateMessage, enriched.methodOrTool!)) {
          missing.push("methodOrTool");
        }
      }
    }

    for (const param of requirements.requiredParameters) {
      const value = enriched.parameters[param];
      if (!isMeaningfulValue(value)) {
        missing.push(param);
      } else if (candidateMessage && !messageContainsValue(candidateMessage, value)) {
        missing.push(param);
      }
    }

    if (requirements.allowedTargets.length > 0) {
      if (!enriched.target || !matchesAllowed(enriched.target, requirements.allowedTargets)) {
        missing.push("target");
      }
    }

    if (requirements.allowedMethods.length > 0) {
      if (
        !enriched.methodOrTool ||
        !(isCommunication
          ? matchesAllowedMethod(enriched.methodOrTool, requirements.allowedMethods)
          : matchesAllowed(enriched.methodOrTool, requirements.allowedMethods, METHOD_ALIASES))
      ) {
        missing.push("methodOrTool");
      }
    }
  }

  if (missing.length > 0) {
    const adjusted: IntentClassification = {
      ...enriched,
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
    classification: enriched,
    decision: "VALID_ACTION",
    approvedActionId: action.id,
    validationFailed: false,
    validationReason: null,
    clarification: null,
  };
}
