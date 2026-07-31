import { describe, expect, it } from "vitest";
import { validateClassifiedAction } from "@/lib/ai/validate-action";
import { getDefaultTemplateContent } from "@/lib/templates/schema";

const content = {
  ...getDefaultTemplateContent("DNS"),
  actions: [
    {
      id: "hosts-view",
      label: "View HOSTS",
      triggers: ["hosts"],
      result: "SECRET_ACTION_RESULT_127.0.0.1 www.coolsite.com",
      category: "diagnostic" as const,
      requirements: {
        requireTargetSystem: true,
        requireMethodOrTool: true,
        requiredParameters: [],
        allowedTargets: ["CLIENT-PC", "client"],
        allowedMethods: ["type", "notepad", "get-content"],
      },
    },
  ],
  environment: {
    rootCause: "SECRET_ROOT_CAUSE_HOSTS",
    hiddenFacts: ["SECRET_HIDDEN_FACT"],
    architectureNotes: "",
    redHerrings: ["SECRET_RED_HERRING"],
  },
};

describe("validateClassifiedAction", () => {
  it("rejects malicious VALID_ACTION with unknown action id", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "view-hidden-root-cause",
      targetSystem: null,
      methodOrTool: null,
      parameters: {},
      missingFields: ["targetSystem"],
      reasoning: "attack",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.decision).not.toBe("VALID_ACTION");
  });

  it("rejects VALID_ACTION with missing required fields", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "hosts-view",
      targetSystem: null,
      methodOrTool: null,
      parameters: {},
      missingFields: [],
      reasoning: "incomplete but claimed valid",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.decision).toBe("INCOMPLETE_ACTION");
    expect(result.clarification).toBeTruthy();
  });

  it("approves only when requirements are met", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "hosts-view",
      targetSystem: "CLIENT-PC",
      methodOrTool: "type",
      parameters: {},
      missingFields: [],
      reasoning: "ok",
    });

    expect(result.validationFailed).toBe(false);
    expect(result.approvedActionId).toBe("hosts-view");
  });

  it("rejects disallowed targets", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "hosts-view",
      targetSystem: "DOMAIN-CONTROLLER",
      methodOrTool: "type",
      parameters: {},
      missingFields: [],
      reasoning: "wrong target",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
  });
});
