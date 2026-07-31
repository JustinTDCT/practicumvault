import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentStatus, AttemptStatus } from "@prisma/client";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg, asSession } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";
import { abortAttempt, expireAttemptIfNeeded } from "../../src/lib/attempts/service";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { POST as startPOST } from "../../src/app/api/attempts/start/route";

async function createAttempt(options: { expired?: boolean } = {}) {
  const seeded = await seedOrg(`Concurrent${Math.random().toString(36).slice(2, 8)}`);
  const snapshot = buildScenarioSnapshot(seeded.template, seeded.version, seeded.org);
  const attempt = await prisma.attempt.create({
    data: {
      assignmentId: seeded.assignment.id,
      candidateId: seeded.candidate.id,
      scenarioVersionId: seeded.version.id,
      organizationId: seeded.org.id,
      startedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + (options.expired ? -1 : 45) * 60_000),
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

function startRequest(assignmentId: string): NextRequest {
  return new NextRequest("http://localhost/api/attempts/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignmentId }),
  });
}

describe("attempt concurrency controls (integration)", () => {
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

  it("concurrent expiration creates one timed_out event and consistent assignment state", async () => {
    const seeded = await createAttempt({ expired: true });

    await Promise.all([
      expireAttemptIfNeeded({ attemptId: seeded.attempt.id, organizationId: seeded.org.id }),
      expireAttemptIfNeeded({ attemptId: seeded.attempt.id, organizationId: seeded.org.id }),
      expireAttemptIfNeeded({ attemptId: seeded.attempt.id, organizationId: seeded.org.id }),
    ]);

    const attempt = await prisma.attempt.findUniqueOrThrow({
      where: { id: seeded.attempt.id },
      include: { assignment: true },
    });
    expect(attempt.status).toBe(AttemptStatus.TIMED_OUT);
    expect(attempt.assignment.status).toBe(AssignmentStatus.TIMED_OUT);
    expect(await prisma.attemptEvent.count({ where: { attemptId: attempt.id, type: "timed_out" } })).toBe(1);
  });

  it("concurrent abort creates one aborted event and consistent assignment state", async () => {
    const seeded = await createAttempt();

    const results = await Promise.allSettled([
      abortAttempt(seeded.attempt.id, "candidate", {
        organizationId: seeded.org.id,
        candidateId: seeded.candidate.id,
      }),
      abortAttempt(seeded.attempt.id, "candidate", {
        organizationId: seeded.org.id,
        candidateId: seeded.candidate.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const attempt = await prisma.attempt.findUniqueOrThrow({
      where: { id: seeded.attempt.id },
      include: { assignment: true },
    });
    expect(attempt.status).toBe(AttemptStatus.ABORTED);
    expect(attempt.assignment.status).toBe(AssignmentStatus.ABORTED);
    expect(await prisma.attemptEvent.count({ where: { attemptId: attempt.id, type: "aborted" } })).toBe(1);
  });

  it("expire and abort racing leaves exactly one terminal event and matching assignment status", async () => {
    const seeded = await createAttempt({ expired: true });

    await Promise.allSettled([
      expireAttemptIfNeeded({ attemptId: seeded.attempt.id, organizationId: seeded.org.id }),
      abortAttempt(seeded.attempt.id, "candidate", {
        organizationId: seeded.org.id,
        candidateId: seeded.candidate.id,
      }),
    ]);

    const attempt = await prisma.attempt.findUniqueOrThrow({
      where: { id: seeded.attempt.id },
      include: { assignment: true },
    });
    const timedOutEvents = await prisma.attemptEvent.count({
      where: { attemptId: attempt.id, type: "timed_out" },
    });
    const abortedEvents = await prisma.attemptEvent.count({
      where: { attemptId: attempt.id, type: "aborted" },
    });

    expect(timedOutEvents + abortedEvents).toBe(1);
    if (attempt.status === AttemptStatus.TIMED_OUT) {
      expect(attempt.assignment.status).toBe(AssignmentStatus.TIMED_OUT);
      expect(timedOutEvents).toBe(1);
    } else {
      expect(attempt.status).toBe(AttemptStatus.ABORTED);
      expect(attempt.assignment.status).toBe(AssignmentStatus.ABORTED);
      expect(abortedEvents).toBe(1);
    }
  });

  it("concurrent start route calls create only one active attempt", async () => {
    const seeded = await seedOrg("ConcurrentStart");
    vi.mocked(requireAuth).mockResolvedValue(asSession(seeded.candidate));

    const results = await Promise.all([
      startPOST(startRequest(seeded.assignment.id)),
      startPOST(startRequest(seeded.assignment.id)),
    ]);

    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.attempt.count({ where: { assignmentId: seeded.assignment.id } })).toBe(1);
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: seeded.assignment.id } })).toMatchObject({
      status: AssignmentStatus.IN_PROGRESS,
    });
  });
});
