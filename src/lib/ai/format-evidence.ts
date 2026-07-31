/**
 * Deterministic formatting for predefined technical evidence.
 * Stored snapshot text is the source of truth — no generative rewriting.
 */

import { generateText, LanguageModel } from "ai";

export type EvidenceFormat = "command" | "log" | "file" | "console" | "dialogue" | "raw";

export function inferEvidenceFormat(category: string, label: string): EvidenceFormat {
  const text = `${category} ${label}`.toLowerCase();
  if (text.includes("call") || text.includes("ask") || text.includes("dialogue") || category === "communication") {
    return "dialogue";
  }
  if (text.includes("log") || text.includes("event")) return "log";
  if (text.includes("hosts") || text.includes("file") || text.includes("type ")) return "file";
  if (text.includes("ping") || text.includes("nslookup") || text.includes("ipconfig") || text.includes("powershell")) {
    return "command";
  }
  if (category === "diagnostic" || category === "remediation" || category === "validation") {
    return "console";
  }
  return "raw";
}

export function formatCommandEvidence(evidence: string, target: string | null): string {
  const label = target ? `**From ${target}:**` : "**Command output:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatLogEvidence(evidence: string, target: string | null): string {
  const label = target ? `**Event log — ${target}:**` : "**Event log:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatFileEvidence(evidence: string, target: string | null): string {
  const label = target ? `**File contents — ${target}:**` : "**File contents:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatConsoleEvidence(evidence: string, target: string | null): string {
  const label = target ? `**${target}:**` : "**Console:**";
  return `${label}\n\n${evidence.trim()}`;
}

export function formatDeterministicEvidence(
  evidence: string,
  format: EvidenceFormat,
  target: string | null,
): string {
  switch (format) {
    case "command":
      return formatCommandEvidence(evidence, target);
    case "log":
      return formatLogEvidence(evidence, target);
    case "file":
      return formatFileEvidence(evidence, target);
    case "console":
      return formatConsoleEvidence(evidence, target);
    case "dialogue":
    case "raw":
    default:
      return evidence.trim();
  }
}

const PROHIBITED_DIALOGUE_PATTERNS = [
  /\broot\s+cause\b/i,
  /\byou should\b/i,
  /\bnext\s+(you|step|check)\b/i,
  /\btry\s+(running|checking)\b/i,
  /\bobjective\b/i,
  /\brubric\b/i,
  /\bhidden\s+fact\b/i,
  /\bpass\s+criteria\b/i,
  /\bscoring\b/i,
  /\bthis (suggests|indicates|means)\b/i,
  /\blikely caused\b/i,
];

export function validateDialogueOutput(
  text: string,
  approvedFacts: string,
  maxLength = 2000,
): { ok: boolean; text: string; reason: string | null } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, text: approvedFacts.trim(), reason: "empty" };
  }
  if (trimmed.length > maxLength) {
    return { ok: false, text: approvedFacts.trim(), reason: "too_long" };
  }
  for (const pattern of PROHIBITED_DIALOGUE_PATTERNS) {
    if (pattern.test(trimmed) && !pattern.test(approvedFacts)) {
      return { ok: false, text: approvedFacts.trim(), reason: "prohibited_content" };
    }
  }
  return { ok: true, text: trimmed, reason: null };
}

export interface SafeDialogueResult {
  text: string;
  usedFallback: boolean;
  reason: string | null;
  deterministic: boolean;
}

/**
 * Production path: return stored approved dialogue exactly.
 * Never paraphrases or invents facts via a generation model.
 */
export function formatDeterministicDialogue(approvedFacts: string): SafeDialogueResult {
  return {
    text: approvedFacts.trim(),
    usedFallback: false,
    reason: null,
    deterministic: true,
  };
}

/**
 * Experimental only — not used on the candidate runtime path.
 * Regex screening alone cannot prove fact integrity; prefer formatDeterministicDialogue.
 */
export async function generateValidatedDialogue(options: {
  model: LanguageModel;
  approvedFacts: string;
  candidateRequest: string;
  maxLength?: number;
}): Promise<SafeDialogueResult> {
  const approved = options.approvedFacts.trim();
  try {
    const { text } = await generateText({
      model: options.model,
      prompt: `Format an end-user dialogue using ONLY these approved facts.
No suggestions. No next steps. No interpretations. No root-cause conclusions.

Approved facts:
"""
${approved}
"""

Candidate request: ${options.candidateRequest}`,
    });
    const validated = validateDialogueOutput(text, approved, options.maxLength ?? 2000);
    if (!validated.ok) {
      return { text: validated.text, usedFallback: true, reason: validated.reason, deterministic: false };
    }
    // Even when regex passes, generative paraphrase is not production-safe.
    // Fall back to approved facts unless the model returned an exact match.
    if (validated.text.trim() !== approved) {
      return {
        text: approved,
        usedFallback: true,
        reason: "invented_or_paraphrased_facts",
        deterministic: false,
      };
    }
    return { text: validated.text, usedFallback: false, reason: null, deterministic: false };
  } catch {
    return { text: approved, usedFallback: true, reason: "generation_error", deterministic: false };
  }
}
