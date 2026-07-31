import { describe, expect, it } from "vitest";
import {
  detectUnsafeActionDeterministic,
  normalizeUnsafeActions,
  sumUnsafePenalties,
} from "@/lib/scoring/unsafe-actions";
import { getDefaultTemplateContent } from "@/lib/templates/schema";

describe("unsafe action penalties", () => {
  const content = {
    ...getDefaultTemplateContent("Safety"),
    scoringRubric: {
      categories: [{ name: "Safety", weight: 100, description: "" }],
      unsafeActions: [
        {
          id: "wipe-disk",
          description: "Wipe user disk",
          penalty: 25,
          keywords: ["format c:", "wipe disk"],
          allowRepeatPenalty: false,
        },
      ],
    },
  };

  it("applies configured penalties exactly", async () => {
    const record = await detectUnsafeActionDeterministic(content, "Please format c: drive", [], "msg-1");
    expect(record?.unsafeActionId).toBe("wipe-disk");
    expect(record?.penalty).toBe(25);
    expect(record?.detectionMethod).toBe("keyword");
  });

  it("avoids duplicate penalties unless allowed", async () => {
    const existing = [
      {
        unsafeActionId: "wipe-disk",
        penalty: 25,
        candidateMessageId: "msg-0",
        detectionMethod: "keyword" as const,
        description: "Wipe user disk",
        detectedAt: new Date().toISOString(),
      },
    ];
    const record = await detectUnsafeActionDeterministic(content, "format c:", existing, "msg-1");
    expect(record).toBeNull();
  });

  it("sums penalties deterministically", () => {
    expect(
      sumUnsafePenalties([
        { unsafeActionId: "a", penalty: 10, candidateMessageId: "1", detectionMethod: "keyword", description: "", detectedAt: "" },
        { unsafeActionId: "b", penalty: 15, candidateMessageId: "2", detectionMethod: "keyword", description: "", detectedAt: "" },
      ]),
    ).toBe(25);
  });

  it("assigns stable ids to unsafe actions", () => {
    const defs = normalizeUnsafeActions(content);
    expect(defs[0].id).toBe("wipe-disk");
  });
});
