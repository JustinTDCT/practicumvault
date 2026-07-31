import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import {
  formatDeterministicDialogue,
  generateValidatedDialogue,
} from "@/lib/ai/format-evidence";

describe("dialogue fact integrity", () => {
  it("returns stored approved dialogue exactly without generation", () => {
    const approved = "Selina: Only my PC has the issue.";
    const result = formatDeterministicDialogue(approved);
    expect(result).toEqual({
      text: approved,
      usedFallback: false,
      reason: null,
      deterministic: true,
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("never returns invented non-prohibited generative facts on the experimental path", async () => {
    const approved = "Selina: Only my PC has the issue.";
    const invented =
      "Selina says Outlook is also failing and the problem began after lunch.";
    vi.mocked(generateText).mockResolvedValue({
      text: invented,
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await generateValidatedDialogue({
      model: { modelId: "test-model" } as never,
      approvedFacts: approved,
      candidateRequest: "Call Selina",
    });

    expect(result.text).toBe(approved);
    expect(result.text).not.toContain("Outlook");
    expect(result.text).not.toContain("after lunch");
    expect(result.usedFallback).toBe(true);
  });
});
