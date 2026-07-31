import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentStatus, AttemptStatus } from "@prisma/client";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { GET as sessionsGET } from "../../src/app/api/admin/sessions/route";

async function seedExpiredAttempt(name: string) {
  const seeded = await seedOrg(name);
  const snapshot = buildScenarioSnapshot(seeded.template, seeded.version, seeded.org);
  const attempt = await prisma.attempt.create({
    data: {
      assignmentId: seeded.assignment.id,
      candidateId: seeded.candidate.id,
      scenarioVersionId: seeded.version.id,
      organizationId: seeded.org.id,
      startedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 1_000),
      scenarioSnapshot: snapshot as object,
      status: AttemptStatus.IN_PROGRESS,
    },
  });
  await prisma.assignment.update({
    where: { id: seeded.assignment.id },
    data: { status: AssignmentStatus.IN_PROGRESS },
  });
  return { ...seeded, attempt };
}

describe("admin live-session org isolation (integration)", () => {
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

  it("Org A sessions route reconciles only Org A expired attempts", async () => {
    const orgA = await seedExpiredAttempt("OrgA");
    const orgB = await seedExpiredAttempt("OrgB");

    vi.mocked(requireAuth).mockResolvedValue(asSession(orgA.admin));
    const res = await sessionsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    // Expired Org A attempt should no longer appear as IN_PROGRESS
    expect(body.sessions.every((s: { id: string }) => s.id !== orgA.attempt.id)).toBe(true);

    const attemptA = await prisma.attempt.findUniqueOrThrow({ where: { id: orgA.attempt.id } });
    const assignmentA = await prisma.assignment.findUniqueOrThrow({
      where: { id: orgA.assignment.id },
    });
    expect(attemptA.status).toBe(AttemptStatus.TIMED_OUT);
    expect(assignmentA.status).toBe(AssignmentStatus.TIMED_OUT);
    expect(
      await prisma.attemptEvent.count({
        where: { attemptId: orgA.attempt.id, type: "timed_out" },
      }),
    ).toBe(1);

    const attemptB = await prisma.attempt.findUniqueOrThrow({ where: { id: orgB.attempt.id } });
    const assignmentB = await prisma.assignment.findUniqueOrThrow({
      where: { id: orgB.assignment.id },
    });
    expect(attemptB.status).toBe(AttemptStatus.IN_PROGRESS);
    expect(assignmentB.status).toBe(AssignmentStatus.IN_PROGRESS);
    expect(
      await prisma.attemptEvent.count({
        where: { attemptId: orgB.attempt.id },
      }),
    ).toBe(0);
  });
});
