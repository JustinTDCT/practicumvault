import { ScenarioTemplateContent } from "@/lib/templates/schema";

export function validateCategoryScores(
  content: ScenarioTemplateContent,
  categoryScores: Array<{ name: string; score: number; notes: string }>,
): Array<{ name: string; score: number; notes: string }> {
  const requiredNames = content.scoringRubric.categories.map((c) => c.name);
  const provided = new Map(categoryScores.map((c) => [c.name, c]));

  for (const name of requiredNames) {
    if (!provided.has(name)) {
      throw new Error(`Missing rubric category: ${name}`);
    }
  }

  if (provided.size !== requiredNames.length) {
    throw new Error("Category scores must match configured rubric exactly once");
  }

  return requiredNames.map((name) => {
    const cs = provided.get(name)!;
    const score = Math.max(0, Math.min(100, Math.round(cs.score)));
    return { name, score, notes: cs.notes };
  });
}

export function computeWeightedScore(
  content: ScenarioTemplateContent,
  categoryScores: Array<{ name: string; score: number }>,
): number {
  return Math.round(
    categoryScores.reduce((sum, cs) => {
      const rubric = content.scoringRubric.categories.find((c) => c.name === cs.name);
      const weight = rubric?.weight ?? 0;
      return sum + cs.score * (weight / 100);
    }, 0),
  );
}

export function clampFinalScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
