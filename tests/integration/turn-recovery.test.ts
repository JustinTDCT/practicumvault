import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptStatus } from "@prisma/client";
import { LIMITS } from "../../src/lib/config/limits";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/scoring/unsafe-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scoring/unsafe-actions")>();
  return {
    ...actual,
    detectUnsafeActionDeterministic: vi.fn(),
  };
});

vi.mock("@/lib/ai/classifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/classifier")>();
  return {
    ...actual,
    classifyCandidateIntent: vi.fn(),
  };
});

vi.mock("@/lib/ai/simulation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/simulation")>();
  return {
    ...actual,
    formatReferenceResponse: vi.fn(),
  };
});

import { requireAuth } from "@/lib/auth";
import { detectUnsafeActionDeterministic } from "@/lib/scoring/unsafe-actions";
import { classifyCandidateIntent } from "@/lib/ai/classifier";
import { formatReferenceResponse } from "@/lib/ai/simulation";
import { ModelCallLimitError } from "../../src/lib/ai/provider-calls";
import { POST as chatPOST } from "../../src/app/api/attempts/[id]/chat/route";

const NEUTRAL =
  "The simulation could not process that action. Submit the specific action again.";

function streamText(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.startsWith("0:"))
    .map((line) => JSON.parse(line.slice(2)) as string)
    .join("");
}

async function createAttempt() {
  const seeded = await seedOrg(`Turn${Math.random().toString(36).slice(2, 8)}`);
  const snapshot = buildScenarioSnapshot(seeded.template, seeded.version, seeded.org);
  const attempt = await prisma.attempt.create({
    data: {
      assignmentId: seeded.assignment.id,
      candidateId: seeded.candidate.id,
      scenarioVersionId: seeded.version.id,
      organizationId: seeded.org.id,
      expiresAt: new Date(Date.now() + 45 * 60_000),
      scenarioSnapshot: snapshot as object,
      status: AttemptStatus.IN_PROGRESS,
      modelCallsCount: 0,
    },
  });
  return { ...seeded, attempt };
}

async function chat(attemptId: string, body: unknown) {
  return chatPOST(
    new NextRequest(`http://localhost/api/attempts/${attemptId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: attemptId }) },
  );
}

describe("failed turn recovery (integration)", () => {
  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(requireAuth).mockReset();
    vi.mocked(detectUnsafeActionDeterministic).mockReset();
    vi.mocked(classifyCandidateIntent).mockReset();
    vi.mocked(formatReferenceResponse).mockReset();
    vi.mocked(detectUnsafeActionDeterministic).mockResolvedValue(null);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns a neutral assistant response when modelCallsCount is already at the limit", async () => {
    const seeded = await createAttempt();
    await prisma.attempt.update({
      where: { id: seeded.attempt.id },
      data: { modelCallsCount: LIMITS.modelCallsPerAttempt },
    });
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockImplementation(async () => {
      throw new ModelCallLimitError();
    });

    const res = await chat(seeded.attempt.id, {
      message: "Look at the green icon near the clock tray on that desktop please",
      turnId: "limit-turn-0001",
    });
    expect(res.status).toBe(200);
    expect(streamText(await res.text())).toBe(NEUTRAL);

    const assistants = await prisma.attemptMessage.findMany({
      where: { attemptId: seeded.attempt.id, turnId: "limit-turn-0001", role: "assistant" },
    });
    expect(assistants).toHaveLength(1);
    expect(
      await prisma.attemptEvent.count({
        where: { attemptId: seeded.attempt.id, type: "turn_processing_failed" },
      }),
    ).toBe(1);
  });

  it("recovers from unsafe-action provider failure", async () => {
    const seeded = await createAttempt();
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(detectUnsafeActionDeterministic).mockRejectedValue(
      new Error("provider boom sk-test-LEAK https://api.openai.com/v1/x"),
    );

    const res = await chat(seeded.attempt.id, {
      message: "run something",
      turnId: "unsafe-fail-0001",
    });
    const text = streamText(await res.text());
    expect(text).toBe(NEUTRAL);
    expect(text).not.toContain("sk-test-");
  });

  it("recovers from classifier provider failure", async () => {
    const seeded = await createAttempt();
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockRejectedValue(
      new Error("classifier failed key=sk-test-CLASS endpoint=https://api.openai.com/v1/chat"),
    );

    const res = await chat(seeded.attempt.id, {
      message: "vague action request without regex match xyz",
      turnId: "class-fail-0001",
    });
    expect(streamText(await res.text())).toBe(NEUTRAL);
  });

  it("recovers from reference-answer provider failure", async () => {
    const seeded = await createAttempt();
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockResolvedValue({
      decision: "REFERENCE_QUESTION",
      targetSystem: null,
      methodOrTool: null,
      requestedAction: "What does Event ID 4776 mean?",
      parameters: {},
      matchedActionId: null,
      missingFields: [],
      reasoning: "reference",
    });
    vi.mocked(formatReferenceResponse).mockRejectedValue(
      new Error("reference fail sk-test-REF https://api.openai.com/v1/ref"),
    );

    const res = await chat(seeded.attempt.id, {
      message: "What does Event ID 4776 mean?",
      turnId: "ref-fail-0001",
    });
    expect(streamText(await res.text())).toBe(NEUTRAL);
  });

  it("retrying the same failed turn ID returns the persisted neutral response", async () => {
    const seeded = await createAttempt();
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockRejectedValue(new Error("temporary provider outage"));

    const first = await chat(seeded.attempt.id, {
      message: "vague action request without regex match abc",
      turnId: "retry-turn-0001",
    });
    expect(streamText(await first.text())).toBe(NEUTRAL);

    vi.mocked(classifyCandidateIntent).mockRejectedValue(new Error("should not be called again"));
    const second = await chat(seeded.attempt.id, {
      message: "vague action request without regex match abc",
      turnId: "retry-turn-0001",
    });
    expect(streamText(await second.text())).toBe(NEUTRAL);
    expect(second.status).toBe(200);

    const users = await prisma.attemptMessage.count({
      where: { attemptId: seeded.attempt.id, turnId: "retry-turn-0001", role: "user" },
    });
    const assistants = await prisma.attemptMessage.count({
      where: { attemptId: seeded.attempt.id, turnId: "retry-turn-0001", role: "assistant" },
    });
    expect(users).toBe(1);
    expect(assistants).toBe(1);
  });

  it("never leaves an orphan user-only turn after provider failure", async () => {
    const seeded = await createAttempt();
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(classifyCandidateIntent).mockRejectedValue(new Error("outage"));

    await chat(seeded.attempt.id, {
      message: "another vague request that needs AI classification zz",
      turnId: "orphan-turn-0001",
    });

    const user = await prisma.attemptMessage.findFirst({
      where: { attemptId: seeded.attempt.id, turnId: "orphan-turn-0001", role: "user" },
    });
    const assistant = await prisma.attemptMessage.findFirst({
      where: { attemptId: seeded.attempt.id, turnId: "orphan-turn-0001", role: "assistant" },
    });
    expect(user).toBeTruthy();
    expect(assistant?.content).toBe(NEUTRAL);
  });
});
