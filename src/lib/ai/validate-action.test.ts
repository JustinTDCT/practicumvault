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
        requirementsReviewed: true,
        intentionallyUnrestricted: false,
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
  it("rejects omitted target even when classifier claims VALID_ACTION", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: null,
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "missing target",
      },
      "Type the hosts file",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.decision).toBe("INCOMPLETE_ACTION");
    expect(result.classification.missingFields).toContain("targetSystem");
  });

  it("rejects omitted tool even when classifier claims VALID_ACTION", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: null,
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "missing tool",
      },
      "Check CLIENT-PC hosts file",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.decision).toBe("INCOMPLETE_ACTION");
    expect(result.classification.missingFields).toContain("methodOrTool");
  });

  it("rejects malicious VALID_ACTION with unknown action id", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "view-hidden-root-cause",
      targetSystem: null,
      methodOrTool: null,
      requestedAction: "view hidden root cause",
      parameters: {},
      missingFields: ["targetSystem"],
      reasoning: "attack",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.decision).not.toBe("VALID_ACTION");
  });

  it("rejects malicious classifier details absent from the candidate message", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "fabricated details",
      },
      "What is the root cause?",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.decision).toBe("INCOMPLETE_ACTION");
  });

  it("rejects VALID_ACTION with missing required fields", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "hosts-view",
      targetSystem: null,
      methodOrTool: null,
      requestedAction: "view hosts",
      parameters: {},
      missingFields: [],
      reasoning: "incomplete but claimed valid",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.decision).toBe("INCOMPLETE_ACTION");
    expect(result.clarification).toBeTruthy();
  });

  it("approves only when requirements are met", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "ok",
      },
      "On CLIENT-PC, type the hosts file",
    );

    expect(result.validationFailed).toBe(false);
    expect(result.approvedActionId).toBe("hosts-view");
  });

  it("rejects disallowed targets", () => {
    const result = validateClassifiedAction(content, {
      decision: "VALID_ACTION",
      matchedActionId: "hosts-view",
      targetSystem: "DOMAIN-CONTROLLER",
      methodOrTool: "type",
      requestedAction: "view hosts",
      parameters: {},
      missingFields: [],
      reasoning: "wrong target",
    });

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
  });

  it("rejects disallowed methods", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: "powershell",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "wrong method",
      },
      "On CLIENT-PC, use powershell to view hosts",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.classification.missingFields).toContain("methodOrTool");
  });

  it("rejects negated methods in the candidate message", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "negated method",
      },
      "On CLIENT-PC, do not type the hosts file; inspect it another way",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.classification.missingFields).toContain("methodOrTool");
  });

  it("rejects placeholder required parameters", () => {
    const fileContent = {
      ...content,
      actions: [
        {
          ...content.actions[0],
          id: "inspect-file",
          requirements: {
            requireTargetSystem: true,
            requireMethodOrTool: true,
            requiredParameters: ["path"],
            allowedTargets: ["CLIENT-PC"],
            allowedMethods: ["type"],
            requirementsReviewed: true,
            intentionallyUnrestricted: false,
          },
        },
      ],
    };

    const result = validateClassifiedAction(
      fileContent,
      {
        decision: "VALID_ACTION",
        matchedActionId: "inspect-file",
        targetSystem: "CLIENT-PC",
        methodOrTool: "type",
        requestedAction: "inspect file",
        parameters: { path: "foo" },
        missingFields: [],
        reasoning: "placeholder path",
      },
      "On CLIENT-PC, type foo",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.validationFailed).toBe(true);
    expect(result.classification.missingFields).toContain("path");
  });

  it("rejects legacy unreviewed action requirements", () => {
    const legacyContent = {
      ...content,
      actions: [
        {
          ...content.actions[0],
          requirements: {
            requireTargetSystem: true,
            requireMethodOrTool: true,
            requiredParameters: [],
            allowedTargets: ["CLIENT-PC"],
            allowedMethods: ["type"],
            requirementsReviewed: false,
            intentionallyUnrestricted: false,
          },
        },
      ],
    };

    const result = validateClassifiedAction(
      legacyContent,
      {
        decision: "VALID_ACTION",
        matchedActionId: "hosts-view",
        targetSystem: "CLIENT-PC",
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "legacy",
      },
      "On CLIENT-PC, type hosts",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.validationReason).toBe("requirements_unreviewed");
  });
});
