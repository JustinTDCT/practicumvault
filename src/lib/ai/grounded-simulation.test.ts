import { describe, expect, it } from "vitest";
import {
  factsTextForIds,
  sanitizeGroundedSimulationResult,
  validateDisclosedFactIds,
} from "@/lib/ai/grounded-simulation";
import { getDefaultTemplateContent, validateTemplateContent } from "@/lib/templates/schema";

const content = validateTemplateContent({
  ...getDefaultTemplateContent("Call scenario"),
  actions: [],
  environment: {
    rootCause: "SECRET_ROOT_CAUSE",
    architectureNotes: "",
    redHerrings: [],
    hiddenFacts: [
      {
        id: "fact-user-other-sites-work",
        fact: "The user can access other websites.",
        sources: ["user"],
        revealWhen: ["Candidate asks whether other websites work"],
      },
      {
        id: "fact-started-this-morning",
        fact: "The problem began this morning.",
        sources: ["user"],
        revealWhen: ["Candidate asks when the issue began"],
      },
    ],
  },
});

describe("grounded simulation fact validation", () => {
  it("coerces legacy string hiddenFacts", () => {
    const parsed = validateTemplateContent({
      ...getDefaultTemplateContent("Legacy"),
      environment: {
        rootCause: "cause",
        architectureNotes: "",
        redHerrings: [],
        hiddenFacts: ["Other websites work", "Started this morning"],
      },
    });
    expect(parsed.environment.hiddenFacts).toHaveLength(2);
    expect(parsed.environment.hiddenFacts[0]?.fact).toBe("Other websites work");
    expect(parsed.environment.hiddenFacts[0]?.id).toMatch(/^fact-/);
  });

  it("drops unknown disclosed fact ids", () => {
    expect(
      validateDisclosedFactIds(content, [
        "fact-user-other-sites-work",
        "fact-invented",
        "fact-started-this-morning",
      ]),
    ).toEqual(["fact-user-other-sites-work", "fact-started-this-morning"]);
  });

  it("falls back when response contains tutoring language", () => {
    const result = sanitizeGroundedSimulationResult(content, {
      interactionType: "COMMUNICATION",
      responseText: "You should check DNS next. This suggests a HOSTS issue.",
      disclosedFactIds: ["fact-user-other-sites-work"],
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: [],
    });
    expect(result.usedFallback).toBe(true);
    expect(result.responseText).toBe("The user can access other websites.");
    expect(result.responseText).not.toMatch(/you should|suggests/i);
  });

  it("returns clarification when requested", () => {
    const result = sanitizeGroundedSimulationResult(content, {
      interactionType: "CLARIFICATION",
      responseText: "",
      disclosedFactIds: ["fact-user-other-sites-work"],
      clarificationNeeded: true,
      clarificationQuestion: "Who do you want to contact?",
      stateChanges: [],
    });
    expect(result.clarificationNeeded).toBe(true);
    expect(result.responseText).toBe("Who do you want to contact?");
    expect(result.disclosedFactIds).toEqual([]);
  });

  it("keeps a grounded communication response for call-the-client phrasing", () => {
    const result = sanitizeGroundedSimulationResult(content, {
      interactionType: "COMMUNICATION",
      responseText:
        "Selina: I can get to other websites, but this particular site says the page cannot be reached. It started this morning.",
      disclosedFactIds: ["fact-user-other-sites-work", "fact-started-this-morning"],
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: [],
    });
    expect(result.usedFallback).toBe(false);
    expect(result.responseText).toContain("Selina:");
    expect(result.disclosedFactIds).toEqual([
      "fact-user-other-sites-work",
      "fact-started-this-morning",
    ]);
    expect(factsTextForIds(content, result.disclosedFactIds)).toContain("other websites");
  });
});
