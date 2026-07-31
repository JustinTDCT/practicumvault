import { isPromptAttackMessage } from "@/lib/ai/untrusted-transcript";
import { LIMITS } from "@/lib/config/limits";

export interface ContextMessage {
  id: string;
  role: string;
  content: string;
  createdAt?: Date | string;
}

export interface BoundedContextResult {
  messageIds: string[];
  messages: ContextMessage[];
  truncated: boolean;
  omittedPromptAttackIds: string[];
  truncatedMessageIds: string[];
  omittedOversizedIds: string[];
  totalChars: number;
  maxChars: number;
}

const MESSAGE_OVERHEAD = 16;

/**
 * Select transcript messages by chronological window and character budget.
 * Does not use substring matching. Prompt-attack messages can be omitted from narrative context.
 * No single message may cause totalChars to exceed maxChars.
 */
export function selectBoundedEvaluatorContext(
  messages: ContextMessage[],
  options?: {
    maxChars?: number;
    maxMessages?: number;
    omitPromptAttacks?: boolean;
  },
): BoundedContextResult {
  const maxChars = options?.maxChars ?? LIMITS.transcriptContextMaxChars;
  const maxMessages = options?.maxMessages ?? 40;
  const omitPromptAttacks = options?.omitPromptAttacks ?? true;

  const chronological = [...messages].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt;
  });

  const omittedPromptAttackIds: string[] = [];
  const truncatedMessageIds: string[] = [];
  const omittedOversizedIds: string[] = [];

  const eligible = chronological.filter((m) => {
    if (omitPromptAttacks && m.role === "user" && isPromptAttackMessage(m.content)) {
      omittedPromptAttackIds.push(m.id);
      return false;
    }
    return true;
  });

  const selected: ContextMessage[] = [];
  let totalChars = 0;

  for (let i = eligible.length - 1; i >= 0; i--) {
    const msg = eligible[i];
    if (selected.length >= maxMessages) break;

    const remaining = maxChars - totalChars;
    if (remaining <= MESSAGE_OVERHEAD) break;

    const fullCost = msg.content.length + MESSAGE_OVERHEAD;
    if (fullCost <= remaining) {
      selected.unshift(msg);
      totalChars += fullCost;
      continue;
    }

    // Oversized relative to remaining budget
    if (selected.length === 0) {
      const maxContent = Math.max(0, remaining - MESSAGE_OVERHEAD);
      selected.unshift({
        ...msg,
        content: msg.content.slice(0, maxContent),
      });
      totalChars += maxContent + MESSAGE_OVERHEAD;
      truncatedMessageIds.push(msg.id);
      break;
    }

    omittedOversizedIds.push(msg.id);
    break;
  }

  const truncated =
    selected.length < eligible.length ||
    omittedPromptAttackIds.length > 0 ||
    truncatedMessageIds.length > 0 ||
    omittedOversizedIds.length > 0;

  return {
    messageIds: selected.map((m) => m.id),
    messages: selected,
    truncated,
    omittedPromptAttackIds,
    truncatedMessageIds,
    omittedOversizedIds,
    totalChars,
    maxChars,
  };
}
