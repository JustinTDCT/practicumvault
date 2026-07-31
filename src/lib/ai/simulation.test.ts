import { describe, expect, it } from "vitest";
import {
  buildStaticResponse,
  selectEvidenceForAction,
} from "@/lib/ai/simulation";
import { getDefaultTemplateContent } from "@/lib/templates/schema";

const content = {
  ...getDefaultTemplateContent("DNS scenario"),
  actions: [
    {
      id: "hosts-view",
      label: "View HOSTS file",
      triggers: ["hosts file", "drivers\\etc\\hosts"],
      result: "127.0.0.1 www.coolsite.com",
      category: "diagnostic" as const,
    },
    {
      id: "user-call",
      label: "Call user",
      triggers: ["call the user", "call selina"],
      result: "Selina: Only my PC has the issue.",
      category: "communication" as const,
    },
  ],
  environment: {
    rootCause: "HOSTS override",
    hiddenFacts: ["DNS server is 10.0.0.1"],
    architectureNotes: "",
    redHerrings: [],
  },
};

describe("simulation behavior", () => {
  it("reveals only configured evidence for valid actions", () => {
    const selected = selectEvidenceForAction(content, "hosts-view");
    expect(selected.evidence).toBe("127.0.0.1 www.coolsite.com");
    expect(selected.evidenceIds).toEqual(["hosts-view"]);
    expect(selected.evidence).not.toContain("DNS server is 10.0.0.1");
  });

  it("returns no evidence for invalid incomplete actions", () => {
    const response = buildStaticResponse({
      decision: "INCOMPLETE_ACTION",
      targetType: null,
      target: null,
      methodOrTool: null,
      requestedAction: "check dns",
      parameters: {},
      matchedActionId: null,
      missingFields: ["methodOrTool"],
      reasoning: "test",
    });
    expect(response).toBeTruthy();
    expect(response).not.toContain("127.0.0.1");
    expect(response).not.toMatch(/try|next|should/i);
  });

  it("returns neutral clarification without suggestions", () => {
    const response = buildStaticResponse({
      decision: "AMBIGUOUS_ACTION",
      targetType: null,
      target: null,
      methodOrTool: null,
      requestedAction: "check logs",
      parameters: {},
      matchedActionId: null,
      missingFields: ["log"],
      reasoning: "test",
    });
    expect(response).toBe("Which log do you want to inspect?");
  });

  it("returns delegation refusal without next steps", () => {
    const response = buildStaticResponse({
      decision: "DELEGATION_REQUEST",
      targetType: null,
      target: null,
      methodOrTool: null,
      requestedAction: "find root cause",
      parameters: {},
      matchedActionId: null,
      missingFields: [],
      reasoning: "test",
    });
    expect(response).not.toMatch(/try|next|ping|hosts/i);
  });

  it("uses approved dialogue facts only from selected action", () => {
    const selected = selectEvidenceForAction(content, "user-call");
    expect(selected.evidence).toContain("Selina");
    expect(selected.evidence).not.toContain("HOSTS override");
  });
});
