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
  totalChars: number;
  maxChars: number;
}

/**
 * Select transcript messages by chronological window and character budget.
 * Does not use substring matching. Prompt-attack messages can be omitted from narrative context.
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
    const cost = msg.content.length + 16;
    if (selected.length >= maxMessages) break;
    if (totalChars + cost > maxChars && selected.length > 0) break;
    selected.unshift(msg);
    totalChars += cost;
  }

  return {
    messageIds: selected.map((m) => m.id),
    messages: selected,
    truncated: selected.length < eligible.length || omittedPromptAttackIds.length > 0,
    omittedPromptAttackIds,
    totalChars,
    maxChars,
  };
}
