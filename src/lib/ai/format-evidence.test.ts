import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import {
  formatDeterministicEvidence,
  generateValidatedDialogue,
  validateDialogueOutput,
} from "@/lib/ai/format-evidence";

function accumulateStreamText(chunks: string[]): string {
  let buffer = "";
  let text = "";
  for (const chunk of chunks) {
    const combined = buffer + chunk;
    const lines = combined.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("0:")) {
        try {
          text += JSON.parse(line.slice(2));
        } catch {
          // incomplete
        }
      }
    }
  }
  if (buffer.startsWith("0:")) {
    try {
      text += JSON.parse(buffer.slice(2));
    } catch {
      // incomplete
    }
  }
  return text;
}

describe("deterministic evidence formatting", () => {
  it("returns stored evidence without generative modification", () => {
    const evidence = "127.0.0.1 www.coolsite.com";
    const formatted = formatDeterministicEvidence(evidence, "file", "CLIENT-PC");
    expect(formatted).toContain(evidence);
    expect(formatted).not.toContain("you should");
    expect(formatted).not.toContain("root cause");
  });

  it("falls back when dialogue introduces prohibited coaching", () => {
    const approved = "Selina: Only my PC has the issue.";
    const bad = "Selina: The root cause is the hosts file. You should check DNS next.";
    const result = validateDialogueOutput(bad, approved);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(approved);
  });

  it("returns only approved fallback when generated dialogue contains malicious coaching", async () => {
    const approved = "Selina: Only my PC has the issue.";
    vi.mocked(generateText).mockResolvedValue({
      text: "Selina: The root cause is the hosts file. You should check DNS next.",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await generateValidatedDialogue({
      model: { modelId: "test-model" } as never,
      approvedFacts: approved,
      candidateRequest: "Call Selina",
    });

    expect(result).toEqual({
      text: approved,
      usedFallback: true,
      reason: "prohibited_content",
    });
    expect(result.text).not.toContain("root cause");
    expect(result.text).not.toContain("You should");
  });
});

describe("stream chunk reassembly", () => {
  it("reassembles frames split across network chunks", () => {
    const payload = JSON.stringify("Hello world from simulation");
    const frame = `0:${payload}\n`;
    const mid = Math.floor(frame.length / 2);
    const text = accumulateStreamText([frame.slice(0, mid), frame.slice(mid)]);
    expect(text).toBe("Hello world from simulation");
  });

  it("handles multiple frames across chunks", () => {
    const text = accumulateStreamText([
      `0:${JSON.stringify("Part ")}\n0:${JSON.stringify("A")}`,
      `\n0:${JSON.stringify("B")}\n`,
    ]);
    expect(text).toBe("Part AB");
  });
});
