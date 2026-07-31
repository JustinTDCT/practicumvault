import { describe, expect, it } from "vitest";
import {
  clampFinalScore,
  computeWeightedScore,
  validateCategoryScores,
} from "@/lib/scoring/validate-score";
import { getDefaultTemplateContent } from "@/lib/templates/schema";

describe("score validation", () => {
  const content = {
    ...getDefaultTemplateContent("Score test"),
    scoringRubric: {
      categories: [
        { name: "Diagnostics", weight: 60, description: "" },
        { name: "Communication", weight: 40, description: "" },
      ],
      unsafeActions: [],
    },
  };

  it("requires all rubric categories exactly once", () => {
    expect(() =>
      validateCategoryScores(content, [{ name: "Diagnostics", score: 80, notes: "" }]),
    ).toThrow(/Missing rubric category/);
  });

  it("clamps category scores between 0 and 100", () => {
    const validated = validateCategoryScores(content, [
      { name: "Diagnostics", score: 150, notes: "" },
      { name: "Communication", score: -5, notes: "" },
    ]);
    expect(validated[0].score).toBe(100);
    expect(validated[1].score).toBe(0);
  });

  it("applies weights server-side", () => {
    const score = computeWeightedScore(content, [
      { name: "Diagnostics", score: 80 },
      { name: "Communication", score: 60 },
    ]);
    expect(score).toBe(Math.round(80 * 0.6 + 60 * 0.4));
  });

  it("clamps final score", () => {
    expect(clampFinalScore(120)).toBe(100);
    expect(clampFinalScore(-10)).toBe(0);
  });
});
