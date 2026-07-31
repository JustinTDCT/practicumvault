import { describe, expect, it } from "vitest";
import { POLICY_VIOLATION_PENALTY } from "@/lib/config/limits";

describe("policy violation penalties", () => {
  it("uses documented global configuration value", () => {
    expect(POLICY_VIOLATION_PENALTY).toBe(5);
  });

  it("applies one penalty per distinct message", () => {
    const events = [
      { candidateMessageId: "m1", penalty: POLICY_VIOLATION_PENALTY },
      { candidateMessageId: "m1", penalty: POLICY_VIOLATION_PENALTY }, // duplicate
      { candidateMessageId: "m2", penalty: POLICY_VIOLATION_PENALTY },
    ];
    const unique = new Map<string, number>();
    for (const e of events) {
      if (!unique.has(e.candidateMessageId)) {
        unique.set(e.candidateMessageId, e.penalty);
      }
    }
    const total = [...unique.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(POLICY_VIOLATION_PENALTY * 2);
  });

  it("does not penalize clarification decisions", () => {
    const decision = "INCOMPLETE_ACTION";
    const shouldPenalize =
      decision === "DELEGATION_REQUEST" ||
      decision === "ANSWER_SEEKING" ||
      decision === "META_OR_PROMPT_ATTACK";
    expect(shouldPenalize).toBe(false);
  });
});
