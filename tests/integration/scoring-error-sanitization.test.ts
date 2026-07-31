import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/scoring/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scoring/engine")>();
  return {
    ...actual,
    rescoreAttempt: vi.fn(),
    submitAttempt: vi.fn(),
  };
});

import { requireAuth } from "@/lib/auth";
import { rescoreAttempt, submitAttempt } from "@/lib/scoring/engine";
import { PublicScoringError, CANDIDATE_SCORING_FAILURE_MESSAGE } from "../../src/lib/scoring/public-error";
import { PATCH as adminAttemptsPATCH } from "../../src/app/api/admin/attempts/route";
import { POST as chatPOST } from "../../src/app/api/attempts/[id]/chat/route";

describe("scoring error sanitization at route boundaries (integration)", () => {
  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(requireAuth).mockReset();
    vi.mocked(rescoreAttempt).mockReset();
    vi.mocked(submitAttempt).mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("admin rescore response never includes provider secrets", async () => {
    const seeded = await seedOrg("OrgA");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.admin));
    vi.mocked(rescoreAttempt).mockRejectedValue(
      new Error(
        "Provider failed at https://api.openai.com/v1/responses using sk-test-LEAKEDKEY1234567890",
      ),
    );

    const res = await adminAttemptsPATCH(
      new NextRequest("http://localhost/api/admin/attempts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId: "attempt-does-not-matter",
          action: "rescore",
          modelMode: "ORIGINAL_MODEL",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk-test-");
    expect(serialized).not.toContain("api.openai.com");
    expect(body.category).toBe("scoring_error");
    expect(body.retryable).toBe(true);
  });

  it("candidate complete returns generic scoring failure without secrets", async () => {
    const seeded = await seedOrg("OrgA");
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
      },
    });

    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));
    vi.mocked(submitAttempt).mockRejectedValue(
      new PublicScoringError({
        publicMessage: CANDIDATE_SCORING_FAILURE_MESSAGE,
        category: "scoring_error",
        retryable: true,
        cause: new Error("sk-test-SECRET https://api.openai.com/v1/chat"),
      }),
    );

    const res = await chatPOST(
      new NextRequest(`http://localhost/api/attempts/${attempt.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      }),
      { params: Promise.resolve({ id: attempt.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(body.error).toBe(CANDIDATE_SCORING_FAILURE_MESSAGE);
    expect(serialized).not.toContain("sk-test-");
    expect(serialized).not.toContain("api.openai.com");
  });
});
