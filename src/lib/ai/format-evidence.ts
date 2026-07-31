/**
 * Deterministic formatting for predefined technical evidence.
 * Stored snapshot text is the source of truth — no generative rewriting.
 */

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

export function formatCommandEvidence(evidence: string, targetSystem: string | null): string {
  const label = targetSystem ? `**From ${targetSystem}:**` : "**Command output:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatLogEvidence(evidence: string, targetSystem: string | null): string {
  const label = targetSystem ? `**Event log — ${targetSystem}:**` : "**Event log:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatFileEvidence(evidence: string, targetSystem: string | null): string {
  const label = targetSystem ? `**File contents — ${targetSystem}:**` : "**File contents:**";
  const body = evidence.trim().startsWith("```") ? evidence.trim() : `\`\`\`\n${evidence.trim()}\n\`\`\``;
  return `${label}\n\n${body}`;
}

export function formatConsoleEvidence(evidence: string, targetSystem: string | null): string {
  const label = targetSystem ? `**${targetSystem}:**` : "**Console:**";
  return `${label}\n\n${evidence.trim()}`;
}

export function formatDeterministicEvidence(
  evidence: string,
  format: EvidenceFormat,
  targetSystem: string | null,
): string {
  switch (format) {
    case "command":
      return formatCommandEvidence(evidence, targetSystem);
    case "log":
      return formatLogEvidence(evidence, targetSystem);
    case "file":
      return formatFileEvidence(evidence, targetSystem);
    case "console":
      return formatConsoleEvidence(evidence, targetSystem);
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
];

export function validateDialogueOutput(
  text: string,
  approvedFacts: string,
  maxLength = 2000,
): { ok: boolean; text: string } {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return { ok: false, text: approvedFacts };
  }
  for (const pattern of PROHIBITED_DIALOGUE_PATTERNS) {
    if (pattern.test(trimmed) && !pattern.test(approvedFacts)) {
      return { ok: false, text: approvedFacts };
    }
  }
  return { ok: true, text: trimmed };
}
