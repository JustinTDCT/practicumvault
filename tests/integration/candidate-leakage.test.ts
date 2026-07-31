import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession, SECRETS_FOR } from "./helpers";
import { assertNoCandidateLeakage } from "../../src/lib/dto/candidate";
import { IntentClassification } from "../../src/lib/ai/types";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({
  getLanguageModelForAttempt: vi.fn(() => ({
    model: { modelId: "test-model" },
    provider: "LOCAL",
    modelName: "test-model",
    mode: "ORIGINAL_MODEL",
  })),
  formatModelLabel: vi.fn(() => "Local (OpenAI-compatible)/test-model"),
}));

vi.mock("@/lib/ai/classifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/classifier")>();
  return {
    ...actual,
    classifyCandidateIntent: vi.fn(),
  };
});

vi.mock("@/lib/ai/grounded-simulation", () => ({
  generateGroundedSimulationResponse: vi.fn(),
}));

vi.mock("@/lib/scoring/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scoring/engine")>();
  return {
    ...actual,
    evaluateCurrentObjective: vi.fn(),
  };
});

import { requireAuth } from "@/lib/auth";
import { classifyCandidateIntent } from "@/lib/ai/classifier";
import { generateGroundedSimulationResponse } from "@/lib/ai/grounded-simulation";
import { evaluateCurrentObjective } from "@/lib/scoring/engine";
import { GET as dashboardGET } from "../../src/app/api/candidate/dashboard/route";
import { POST as startPOST } from "../../src/app/api/attempts/start/route";
import { GET as attemptGET } from "../../src/app/api/attempts/[id]/route";
import { POST as chatPOST } from "../../src/app/api/attempts/[id]/chat/route";

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function startAttempt(assignmentId: string): Promise<string> {
  const res = await startPOST(jsonRequest("http://localhost/api/attempts/start", { assignmentId }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.attempt.id;
}

function streamText(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.startsWith("0:"))
    .map((line) => JSON.parse(line.slice(2)) as string)
    .join("");
}

async function chat(attemptId: string, body: unknown): Promise<Response> {
  return chatPOST(jsonRequest(`http://localhost/api/attempts/${attemptId}/chat`, body), {
    params: Promise.resolve({ id: attemptId }),
  });
}

function validHostsClassification(overrides: Partial<IntentClassification> = {}): IntentClassification {
  return {
    decision: "VALID_ACTION",
    targetType: null,
    matchedActionId: "hosts-view",
    target: "CLIENT-PC",
    methodOrTool: "type",
    requestedAction: "view hosts",
    parameters: {},
    missingFields: [],
    reasoning: "valid action",
    ...overrides,
  };
}

function assertNoSecrets(value: unknown, secrets = SECRETS_FOR("OrgA")) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  expect(() => assertNoCandidateLeakage(serialized, secrets)).not.toThrow();
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe("candidate data leakage route coverage (integration)", () => {
  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(requireAuth).mockReset();
    vi.mocked(classifyCandidateIntent).mockReset();
    vi.mocked(generateGroundedSimulationResponse).mockReset();
    vi.mocked(evaluateCurrentObjective).mockReset();
    vi.mocked(evaluateCurrentObjective).mockResolvedValue([]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("candidate dashboard response excludes scenario content and snapshot secrets", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));

    const res = await dashboardGET();
    expect(res.status).toBe(200);
    assertNoSecrets(await res.json());
  });

  it("start response excludes snapshot and seeded secrets", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));

    const res = await startPOST(jsonRequest("http://localhost/api/attempts/start", {
      assignmentId: seeded.assignment.id,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("scenarioSnapshot");
    assertNoSecrets(body);
  });

  it("candidate attempt GET returns only candidate-visible attempt data", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await attemptGET(new NextRequest(`http://localhost/api/attempts/${attemptId}`), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("scenarioSnapshot");
    assertNoSecrets(body);
  });

  it("objective check response does not expose objective or scoring secrets", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await chat(attemptId, { action: "evaluate_objective" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ evaluated: true });
    assertNoSecrets(body);
  });

  it("grounded clarification path does not echo classifier reasoning or hidden facts", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockResolvedValue({
      decision: "INCOMPLETE_ACTION",
      targetType: null,
      matchedActionId: "hosts-view",
      target: null,
      methodOrTool: null,
      requestedAction: "check hosts",
      parameters: {},
      missingFields: ["target"],
      reasoning: "SECRET_ROOT_CAUSE_OrgA SECRET_AI_INSTRUCTIONS_OrgA",
    });
    vi.mocked(generateGroundedSimulationResponse).mockResolvedValue({
      interactionType: "CLARIFICATION",
      responseText: "Which system do you want to run that on?",
      disclosedFactIds: [],
      clarificationNeeded: true,
      clarificationQuestion: "Which system do you want to run that on?",
      stateChanges: [],
      usedFallback: false,
      fallbackReason: null,
    });
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await chat(attemptId, {
      message: "Check hosts",
      turnId: "clarify-turn-0001",
    });
    expect(res.status).toBe(200);
    const text = streamText(await res.text());
    expect(text).toContain("Which system");
    assertNoSecrets(text);
  });

  it("grounded simulation can respond without a predefined action match", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockResolvedValue({
      decision: "VALID_ACTION",
      targetType: "person",
      matchedActionId: null,
      target: "client",
      methodOrTool: "call",
      requestedAction: "ask for summary",
      parameters: {},
      missingFields: [],
      reasoning: "natural language communication",
    });
    vi.mocked(generateGroundedSimulationResponse).mockResolvedValue({
      interactionType: "COMMUNICATION",
      responseText:
        "Selina: I can get to other websites, but this particular site says the page cannot be reached.",
      disclosedFactIds: [`fact-secret-hidden-orga`],
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: [],
      usedFallback: false,
      fallbackReason: null,
    });
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await chat(attemptId, {
      message: "Call the client and ask for a summary in her own words.",
      turnId: "call-client-turn-0001",
    });
    expect(res.status).toBe(200);
    const text = streamText(await res.text());
    expect(text).toContain("Selina:");
    expect(text).not.toBe("That action is not available in this environment.");
    assertNoSecrets(text);
    expect(generateGroundedSimulationResponse).toHaveBeenCalled();
  });

  it("grounded simulation reveals only disclosed facts, not root cause", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockResolvedValue(validHostsClassification());
    vi.mocked(generateGroundedSimulationResponse).mockResolvedValue({
      interactionType: "COMMAND_OR_TOOL",
      responseText: "SECRET_ACTION_RESULT_OrgA",
      disclosedFactIds: [],
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: [],
      usedFallback: false,
      fallbackReason: null,
    });
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await chat(attemptId, {
      message: "On CLIENT-PC, type the hosts file",
      turnId: "hosts-turn-0001",
    });
    expect(res.status).toBe(200);
    const text = streamText(await res.text());
    expect(text).toContain("SECRET_ACTION_RESULT_OrgA");
    assertNoSecrets(text);
  });

  it("dialogue simulation returns grounded response and does not invent extra facts", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockResolvedValue(
      validHostsClassification({
        matchedActionId: "call-user",
        target: "Selina",
        methodOrTool: "call",
        requestedAction: "call user",
        targetType: "person",
      }),
    );
    vi.mocked(generateGroundedSimulationResponse).mockResolvedValue({
      interactionType: "COMMUNICATION",
      responseText: "APPROVED_DIALOGUE_FACT_OrgA: Selina says only her PC is affected.",
      disclosedFactIds: [],
      clarificationNeeded: false,
      clarificationQuestion: null,
      stateChanges: [],
      usedFallback: false,
      fallbackReason: null,
    });
    const attemptId = await startAttempt(seeded.assignment.id);

    const res = await chat(attemptId, {
      message: "Call Selina",
      turnId: "dialogue-turn-0001",
    });
    expect(res.status).toBe(200);
    const text = streamText(await res.text());
    expect(text).toBe("APPROVED_DIALOGUE_FACT_OrgA: Selina says only her PC is affected.");
    expect(text).not.toContain("Outlook is also failing");
    expect(text).not.toContain("after lunch");
    assertNoSecrets(text);

    const events = await prisma.attemptEvent.findMany({
      where: { attemptId, type: "turn_classified" },
    });
    expect(
      events.some((e) => (e.payload as { responseType?: string })?.responseType === "simulation_response"),
    ).toBe(true);
  });

  it("returns 404 for candidate GET and chat against another organization's attempt", async () => {
    const orgA = await seedOrg("OrgA");
    const orgB = await seedOrg("OrgB");
    vi.mocked(requireAuth).mockResolvedValue(asSession(orgA.candidate));
    const attemptId = await startAttempt(orgA.assignment.id);

    vi.mocked(requireAuth).mockResolvedValue(asSession(orgB.candidate));
    const getRes = await attemptGET(new NextRequest(`http://localhost/api/attempts/${attemptId}`), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(getRes.status).toBe(404);

    const chatRes = await chat(attemptId, {
      message: "On CLIENT-PC, type the hosts file",
      turnId: "cross-org-turn-01",
    });
    expect(chatRes.status).toBe(404);
    expect(await chatRes.text()).toBe("Not found");
  });

  it("allows admins to see attempt metadata without candidate-only hidden scenario content", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    const attemptId = await startAttempt(seeded.assignment.id);

    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.admin));
    const res = await attemptGET(new NextRequest(`http://localhost/api/attempts/${attemptId}`), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt.scenarioTitle).toBe("OrgA Scenario");
    expect(body.attempt.candidateName).toBe(`${"OrgA"} Candidate`);
    const serialized = JSON.stringify(body);
    for (const secret of SECRETS_FOR("OrgA")) {
      expect(serialized).not.toContain(secret);
    }
    expect(asSession(seeded.admin).role).toBe(UserRole.ADMIN);
  });
});
