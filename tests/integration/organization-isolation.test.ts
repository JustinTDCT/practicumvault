import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptStatus } from "@prisma/client";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";
import { expireAttemptIfNeeded } from "../../src/lib/attempts/service";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { GET as adminAttemptsGET } from "../../src/app/api/admin/attempts/route";
import { GET as attemptGET } from "../../src/app/api/attempts/[id]/route";
import { POST as chatPOST } from "../../src/app/api/attempts/[id]/chat/route";

async function createAttemptForOrgB() {
  const orgB = await seedOrg("OrgB");
  const snapshot = buildScenarioSnapshot(orgB.template, orgB.version, orgB.org);
  const attempt = await prisma.attempt.create({
    data: {
      assignmentId: orgB.assignment.id,
      candidateId: orgB.candidate.id,
      scenarioVersionId: orgB.version.id,
      organizationId: orgB.org.id,
      expiresAt: new Date(Date.now() - 60_000),
      scenarioSnapshot: snapshot as object,
      status: AttemptStatus.IN_PROGRESS,
      messages: {
        create: {
          role: "assistant",
          content: "Started",
          turnId: "opening",
        },
      },
    },
  });
  await prisma.assignment.update({
    where: { id: orgB.assignment.id },
    data: { status: "IN_PROGRESS" },
  });
  return { orgB, attempt };
}

describe("organization isolation (integration)", () => {
  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(requireAuth).mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("admin routes and attempt GET do not expose another organization's attempts", async () => {
    const orgA = await seedOrg("OrgA");
    const { attempt } = await createAttemptForOrgB();
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: AttemptStatus.COMPLETED, completedAt: new Date(), submittedAt: new Date() },
    });

    vi.mocked(requireAuth).mockResolvedValue(asSession(orgA.admin));
    const listRes = await adminAttemptsGET();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.attempts.map((row: { id: string }) => row.id)).not.toContain(attempt.id);

    const getRes = await attemptGET(new NextRequest(`http://localhost/api/attempts/${attempt.id}`), {
      params: Promise.resolve({ id: attempt.id }),
    });
    expect(getRes.status).toBe(404);
  });

  it("scoped expiration cannot mutate another organization's attempt", async () => {
    const orgA = await seedOrg("OrgA");
    const { attempt } = await createAttemptForOrgB();

    const result = await expireAttemptIfNeeded({
      attemptId: attempt.id,
      organizationId: orgA.org.id,
    });
    expect(result).toBeNull();

    const refreshed = await prisma.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { assignment: true },
    });
    expect(refreshed.status).toBe(AttemptStatus.IN_PROGRESS);
    expect(refreshed.assignment.status).toBe("IN_PROGRESS");
    expect(await prisma.attemptEvent.count({ where: { attemptId: attempt.id, type: "timed_out" } })).toBe(0);
  });

  it("candidate GET and chat return 404 across organizations", async () => {
    const orgA = await seedOrg("OrgA");
    const { attempt } = await createAttemptForOrgB();

    vi.mocked(requireAuth).mockResolvedValue(asSession(orgA.candidate));
    const getRes = await attemptGET(new NextRequest(`http://localhost/api/attempts/${attempt.id}`), {
      params: Promise.resolve({ id: attempt.id }),
    });
    expect(getRes.status).toBe(404);

    const chatRes = await chatPOST(
      new NextRequest(`http://localhost/api/attempts/${attempt.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "On CLIENT-PC, type the hosts file", turnId: "cross-org-chat-01" }),
      }),
      { params: Promise.resolve({ id: attempt.id }) },
    );
    expect(chatRes.status).toBe(404);
    expect(await chatRes.text()).toBe("Not found");
  });
});
