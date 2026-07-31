import { describe, expect, it } from "vitest";
import {
  canonicalMethod,
  enrichClassificationForValidation,
  inferCommunicationMethod,
  matchesAllowedMethod,
  validateClassifiedAction,
} from "@/lib/ai/validate-action";
import { getDefaultTemplateContent, validateTemplateContent } from "@/lib/templates/schema";

function callUserContent() {
  return {
    ...getDefaultTemplateContent("DNS"),
    actions: [
      {
        id: "call-user",
        label: "Call user",
        triggers: ["call", "ask", "client"],
        result: "Selina summarizes the issue in her own words.",
        category: "communication" as const,
        requirements: {
          targetType: "person" as const,
          requireTarget: true,
          requireMethodOrTool: true,
          requiredParameters: [],
          allowedTargets: ["Selina Kyle", "Selina", "client", "user", "ticket user"],
          allowedMethods: ["call", "phone", "ask", "talk"],
          requirementsReviewed: true,
          intentionallyUnrestricted: false,
        },
      },
    ],
  };
}

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
        requireTarget: true,
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
    hiddenFacts: [
      {
        id: "fact-secret-hidden",
        fact: "SECRET_HIDDEN_FACT",
        sources: [],
        revealWhen: [],
      },
    ],
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: null,
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
    expect(result.classification.missingFields).toContain("target");
  });

  it("rejects omitted tool even when classifier claims VALID_ACTION", () => {
    const result = validateClassifiedAction(
      content,
      {
        decision: "VALID_ACTION",
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
      targetType: null,
      matchedActionId: "view-hidden-root-cause",
      target: null,
      methodOrTool: null,
      requestedAction: "view hidden root cause",
      parameters: {},
      missingFields: ["target"],
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
      targetType: null,
      matchedActionId: "hosts-view",
      target: null,
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
      targetType: null,
      matchedActionId: "hosts-view",
      target: "DOMAIN-CONTROLLER",
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
            requireTarget: true,
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
        targetType: null,
        matchedActionId: "inspect-file",
        target: "CLIENT-PC",
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

  it("asks who to contact for communication actions missing a person target", () => {
    const callContent = callUserContent();

    const result = validateClassifiedAction(
      callContent,
      {
        decision: "VALID_ACTION",
        targetType: "person",
        matchedActionId: "call-user",
        target: null,
        methodOrTool: "ask",
        requestedAction: "ask for summary",
        parameters: {},
        missingFields: [],
        reasoning: "missing person",
      },
      "ask for summary in her own words",
    );

    expect(result.approvedActionId).toBeNull();
    expect(result.decision).toBe("INCOMPLETE_ACTION");
    expect(result.classification.missingFields).toContain("target");
    expect(result.clarification).toBe("Who do you want to contact?");
  });

  it("approves communication actions when person and method are present", () => {
    const result = validateClassifiedAction(
      callUserContent(),
      {
        decision: "VALID_ACTION",
        targetType: "person",
        matchedActionId: "call-user",
        target: "Selina Kyle",
        methodOrTool: "call",
        requestedAction: "call and ask for summary",
        parameters: {},
        missingFields: [],
        reasoning: "ok",
      },
      "Call Selina Kyle and ask her to summarize the issue in her own words.",
    );

    expect(result.validationFailed).toBe(false);
    expect(result.approvedActionId).toBe("call-user");
  });

  it("deterministically accepts Call the client and ask for a summary in her own words", () => {
    const message = "Call the client and ask for a summary in her own words.";
    const result = validateClassifiedAction(
      callUserContent(),
      {
        decision: "INCOMPLETE_ACTION",
        targetType: "person",
        matchedActionId: null,
        target: "client",
        methodOrTool: null,
        requestedAction: "ask for summary",
        parameters: {},
        missingFields: ["methodOrTool", "target details"],
        reasoning: "model missed the obvious call verb",
      },
      message,
    );

    expect(inferCommunicationMethod(message)).toBe("call");
    expect(result.validationFailed).toBe(false);
    expect(result.decision).toBe("VALID_ACTION");
    expect(result.approvedActionId).toBe("call-user");
    expect(result.classification.methodOrTool).toBe("call");
    expect(result.classification.target).toBe("client");
    expect(result.classification.missingFields).toEqual([]);
    expect(result.clarification).toBeNull();
  });

  it("does not ask which command or tool when call is already present", () => {
    const message = "call the client and ask for summary in her own words";
    const enriched = enrichClassificationForValidation(
      callUserContent(),
      {
        decision: "INCOMPLETE_ACTION",
        targetType: "person",
        matchedActionId: "call-user",
        target: "client",
        methodOrTool: "call",
        requestedAction: "ask for summary",
        parameters: { summary: "in her own words" },
        missingFields: ["target details"],
        reasoning: "model noise",
      },
      message,
    );

    expect(enriched.classification.missingFields).toEqual([]);
    expect(enriched.classification.methodOrTool).toBe("call");
    expect(enriched.classification.decision).toBe("VALID_ACTION");

    const result = validateClassifiedAction(
      callUserContent(),
      {
        decision: "INCOMPLETE_ACTION",
        targetType: "person",
        matchedActionId: "call-user",
        target: "client",
        methodOrTool: "call",
        requestedAction: "ask for summary",
        parameters: {},
        missingFields: ["target details"],
        reasoning: "model noise",
      },
      message,
    );
    expect(result.approvedActionId).toBe("call-user");
    expect(result.clarification).not.toBe("Which command or tool are you using?");
    expect(result.clarification).not.toBe("How do you want to contact them?");
  });

  it("matches communication methods symmetrically via canonical forms", () => {
    expect(canonicalMethod("phone")).toBe("call");
    expect(canonicalMethod("ask")).toBe("contact");
    expect(matchesAllowedMethod("phone", ["call"])).toBe(true);
    expect(matchesAllowedMethod("call", ["phone", "ask"])).toBe(true);
    expect(matchesAllowedMethod("ask", ["call", "talk"])).toBe(true);
  });

  it("maps legacy requireTargetSystem onto requireTarget", () => {
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
            requirementsReviewed: true,
            intentionallyUnrestricted: false,
          } as never,
        },
      ],
    };
    const parsed = validateTemplateContent(legacyContent);
    const result = validateClassifiedAction(
      parsed,
      {
        decision: "VALID_ACTION",
        targetType: "system",
        matchedActionId: "hosts-view",
        target: null,
        methodOrTool: "type",
        requestedAction: "view hosts",
        parameters: {},
        missingFields: [],
        reasoning: "legacy",
      },
      "Type the hosts file",
    );
    expect(result.classification.missingFields).toContain("target");
  });

  it("rejects legacy unreviewed action requirements", () => {
    const legacyContent = {
      ...content,
      actions: [
        {
          ...content.actions[0],
          requirements: {
            requireTarget: true,
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
        targetType: null,
        matchedActionId: "hosts-view",
        target: "CLIENT-PC",
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
