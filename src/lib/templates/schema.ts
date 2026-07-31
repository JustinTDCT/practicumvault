import { z } from "zod";
import { normalizeTemplateRawContent } from "@/lib/templates/objectives";

export const rubricCategorySchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(0).max(100),
  description: z.string().default(""),
});

export const unsafeActionSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().min(1),
  penalty: z.number().min(0).max(100),
  keywords: z.array(z.string()).default([]),
  allowRepeatPenalty: z.boolean().default(false),
});

export const hintSchema = z.object({
  level: z.number().int().min(1),
  text: z.string().min(1),
  penalty: z.number().min(0).max(100),
});

export const actionTargetTypeSchema = z.enum([
  "system",
  "person",
  "account",
  "file",
  "service",
  "none",
]);

export type ActionTargetType = z.infer<typeof actionTargetTypeSchema>;

const actionRequirementObjectSchema = z.object({
  /** What kind of target the candidate must name for this action. */
  targetType: actionTargetTypeSchema.optional(),
  requireTarget: z.boolean().default(false),
  requireMethodOrTool: z.boolean().default(false),
  requiredParameters: z.array(z.string()).default([]),
  allowedTargets: z.array(z.string()).default([]),
  allowedMethods: z.array(z.string()).default([]),
  /** Explicit opt-out: action intentionally has no target/method requirements. */
  intentionallyUnrestricted: z.boolean().default(false),
  /** Administrator confirmed specificity settings. Absent/false = not approved. */
  requirementsReviewed: z.boolean().default(false),
});

/** Maps legacy requireTargetSystem onto requireTarget. */
export const actionRequirementSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (r.requireTarget === undefined && typeof r.requireTargetSystem === "boolean") {
    r.requireTarget = r.requireTargetSystem;
  }
  delete r.requireTargetSystem;
  return r;
}, actionRequirementObjectSchema);

export type ActionRequirements = z.infer<typeof actionRequirementObjectSchema>;

export const actionCategorySchema = z.enum([
  "diagnostic",
  "communication",
  "remediation",
  "validation",
]);

export type ActionCategory = z.infer<typeof actionCategorySchema>;

export const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  triggers: z.array(z.string()).default([]),
  result: z.string().min(1),
  category: actionCategorySchema.default("diagnostic"),
  requirements: actionRequirementSchema.default({
    requireTarget: false,
    requireMethodOrTool: false,
    requiredParameters: [],
    allowedTargets: [],
    allowedMethods: [],
    intentionallyUnrestricted: false,
    requirementsReviewed: false,
  }),
});

export const objectiveSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  passCriteria: z.string().min(1),
  requiredEvidence: z.array(z.string()).default([]),
});

/** @deprecated Use objectiveSchema — kept for type re-exports only */
export const gateSchema = objectiveSchema;

export const hiddenFactSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(1),
  sources: z.array(z.string()).default([]),
  revealWhen: z.array(z.string()).default([]),
});

export type HiddenFact = z.infer<typeof hiddenFactSchema>;

const scenarioTemplateContentBaseSchema = z.object({
  metadata: z.object({
    title: z.string().min(1),
    description: z.string().default(""),
    skillLevel: z.string().default(""),
    environment: z.string().default(""),
    scenarioType: z.string().default("Objective-based simulation"),
  }),
  startingSituation: z.object({
    ticketSubject: z.string().default(""),
    ticketPriority: z.string().default("Normal"),
    ticketUser: z.string().default(""),
    ticketBody: z.string().min(1),
    candidateInstructions: z.string().default(
      "You may ask questions, inspect systems, run commands, check administrative tools, or perform actions. The simulation will reveal only information that your requested action would realistically produce.",
    ),
  }),
  environment: z.object({
    rootCause: z.string().min(1),
    hiddenFacts: z.array(hiddenFactSchema).default([]),
    architectureNotes: z.string().default(""),
    redHerrings: z.array(z.string()).default([]),
  }),
  actions: z.array(actionSchema).default([]),
  objectives: z.array(objectiveSchema).min(1),
  scoringRubric: z.object({
    categories: z.array(rubricCategorySchema).min(1),
    unsafeActions: z.array(unsafeActionSchema).default([]),
  }),
  hints: z.array(hintSchema).default([]),
  validationRequirements: z.array(z.string()).default([]),
  completionConditions: z.string().min(1),
  aiInstructions: z.string().default(""),
});

export const scenarioTemplateContentSchema = z.preprocess(
  normalizeTemplateRawContent,
  scenarioTemplateContentBaseSchema,
);

export type ScenarioTemplateContent = z.infer<typeof scenarioTemplateContentBaseSchema>;
export type ObjectiveDefinition = z.infer<typeof objectiveSchema>;
/** @deprecated Use ObjectiveDefinition */
export type GateDefinition = ObjectiveDefinition;
export type RubricCategory = z.infer<typeof rubricCategorySchema>;
export type ActionDefinition = z.infer<typeof actionSchema>;

export function validateTemplateContent(content: unknown): ScenarioTemplateContent {
  return scenarioTemplateContentSchema.parse(content) as ScenarioTemplateContent;
}

export function listHiddenFactIds(content: ScenarioTemplateContent): string[] {
  return content.environment.hiddenFacts.map((f) => f.id);
}

export function getHiddenFactById(
  content: ScenarioTemplateContent,
  id: string,
): HiddenFact | null {
  return content.environment.hiddenFacts.find((f) => f.id === id) ?? null;
}

export function defaultTargetTypeForCategory(category: ActionCategory): ActionTargetType {
  return category === "communication" ? "person" : "system";
}

export function resolveActionTargetType(action: ActionDefinition): ActionTargetType {
  const req = action.requirements;
  if (req?.targetType) return req.targetType;
  return defaultTargetTypeForCategory(action.category);
}

export function getDefaultActionRequirements(
  partial?: Partial<ActionRequirements>,
  options?: { category?: ActionCategory },
): ActionRequirements {
  const category = options?.category ?? "diagnostic";
  return {
    targetType: defaultTargetTypeForCategory(category),
    requireTarget: false,
    requireMethodOrTool: false,
    requiredParameters: [] as string[],
    allowedTargets: [] as string[],
    allowedMethods: [] as string[],
    intentionallyUnrestricted: false,
    requirementsReviewed: false,
    ...partial,
  };
}

/** Returns human-readable blockers preventing publish/assign. */
export function getActionSpecificityIssues(content: ScenarioTemplateContent): string[] {
  const issues: string[] = [];
  for (const action of content.actions) {
    const req = action.requirements ?? getDefaultActionRequirements(undefined, { category: action.category });
    const targetType = resolveActionTargetType(action);
    if (!req.requirementsReviewed) {
      issues.push(`Action "${action.label || action.id}" has not had its specificity requirements reviewed.`);
      continue;
    }
    if (req.intentionallyUnrestricted) continue;

    if (
      action.category === "diagnostic" ||
      action.category === "remediation" ||
      action.category === "validation"
    ) {
      if (!req.requireTarget && !req.requireMethodOrTool && req.requiredParameters.length === 0) {
        issues.push(
          `Action "${action.label || action.id}" (${action.category}) needs target/tool/parameter requirements, or mark it intentionally unrestricted.`,
        );
      }
    }
    if (action.category === "communication") {
      if (targetType !== "person" && targetType !== "none") {
        issues.push(
          `Communication action "${action.label || action.id}" should use target type "person" (who is being contacted).`,
        );
      }
      if (!req.requireTarget && req.allowedTargets.length === 0) {
        issues.push(
          `Communication action "${action.label || action.id}" should require or list who is being contacted.`,
        );
      }
    }
  }
  return issues;
}

export function canPublishTemplateContent(content: ScenarioTemplateContent): {
  ok: boolean;
  issues: string[];
} {
  // Actions are optional authoring/scoring metadata — not a publish gate.
  // Surface specificity issues as warnings only when actions exist.
  const issues = getActionSpecificityIssues(content);
  return { ok: true, issues };
}

export function getDefaultTemplateContent(title: string): ScenarioTemplateContent {
  return {
    metadata: {
      title,
      description: "",
      skillLevel: "Help Desk / Tier 1–2",
      environment: "",
      scenarioType: "Objective-based simulation",
    },
    startingSituation: {
      ticketSubject: "Sample ticket subject",
      ticketPriority: "Normal",
      ticketUser: "Sample User, Department",
      ticketBody: "Describe the initial user-reported symptom here.",
      candidateInstructions:
        "You are the technician. You may ask questions, inspect systems, run commands, check administrative tools, or perform actions. Be specific about which machine you mean (your workstation vs the user's PC vs a server). The simulation returns only the raw output you would see — it will not interpret results or suggest next steps for you.",
    },
    environment: {
      rootCause: "Describe the actual root cause (hidden from candidate).",
      hiddenFacts: [],
      architectureNotes: "",
      redHerrings: [],
    },
    actions: [],
    objectives: [
      {
        id: 1,
        name: "Identify the affected layer",
        description: "",
        passCriteria: "Candidate identifies the general failure area with supporting evidence.",
        requiredEvidence: [],
      },
      {
        id: 2,
        name: "Isolate the scope",
        description: "",
        passCriteria: "Candidate narrows the failure domain efficiently.",
        requiredEvidence: [],
      },
      {
        id: 3,
        name: "Find the root cause",
        description: "",
        passCriteria: "Candidate identifies the actual cause with evidence.",
        requiredEvidence: [],
      },
      {
        id: 4,
        name: "Resolve and validate",
        description: "",
        passCriteria: "Candidate proposes appropriate fix, validates, and documents.",
        requiredEvidence: [],
      },
    ],
    scoringRubric: {
      categories: [
        { name: "Initial triage and questioning", weight: 15, description: "" },
        { name: "Test selection", weight: 15, description: "" },
        { name: "Interpretation of evidence", weight: 20, description: "" },
        { name: "Root-cause reasoning", weight: 20, description: "" },
        { name: "Remediation quality", weight: 15, description: "" },
        { name: "Validation and documentation", weight: 10, description: "" },
        { name: "Communication", weight: 5, description: "" },
      ],
      unsafeActions: [],
    },
    hints: [],
    validationRequirements: [],
    completionConditions: "All objectives completed and validation steps performed.",
    aiInstructions:
      "Never interpret command output for the candidate. Never suggest what to check next. 'My system' means the technician workstation, not the end-user PC unless they remote in. ONE action per turn. Questions about notes/docs: return ONLY matching facts, not full file dumps unless they ran type/cat/dir on that file. Admin/remediation tasks require method AND specifics (username, OU, group, etc.) — refuse with the single-line policy message if either is missing. Refuse meta-requests: analyze system, run diagnostics, find the issue.",
  };
}

export function validateRubricWeights(content: ScenarioTemplateContent): string | null {
  const total = content.scoringRubric.categories.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) {
    return `Rubric category weights must sum to 100 (currently ${total}).`;
  }
  return null;
}
