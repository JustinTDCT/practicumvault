import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, requireTestDatabase, resetTestDatabase, seedOrg } from "./helpers";
import { buildScenarioSnapshot } from "../../src/lib/attempts/snapshot";
import { AttemptStatus } from "@prisma/client";
import { assertNoCandidateLeakage } from "../../src/lib/dto/candidate";

const SECRETS = [
  "SECRET_ROOT_CAUSE_OrgA",
  "SECRET_HIDDEN_FACT_OrgA",
  "SECRET_ACTION_RESULT_OrgA",
  "SECRET_OBJECTIVE_NAME_OrgA",
  "SECRET_PASS_CRITERIA_OrgA",
  "SECRET_RUBRIC_CATEGORY_OrgA",
  "SECRET_HINT_TEXT_OrgA",
  "SECRET_AI_INSTRUCTIONS_OrgA",
];

describe("candidate data leakage (integration)", () => {
  beforeAll(() => {
    requireTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("dashboard select shape does not load scenario content", async () => {
    const seeded = await seedOrg("OrgA");
    const rows = await prisma.assignment.findMany({
      where: { candidateId: seeded.candidate.id },
      select: {
        id: true,
        status: true,
        scenarioVersion: {
          select: {
            version: true,
            timeLimitMinutes: true,
            template: { select: { title: true } },
          },
        },
      },
    });

    const response = {
      assignments: rows.map((a) => ({
        id: a.id,
        status: a.status,
        canStart: true,
        scenario: {
          title: a.scenarioVersion.template.title,
          displayedVersion: a.scenarioVersion.version,
          timeLimitMinutes: a.scenarioVersion.timeLimitMinutes,
        },
      })),
    };

    const serialized = JSON.stringify(response);
    expect(() => assertNoCandidateLeakage(serialized, SECRETS)).not.toThrow();
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("start response DTO excludes snapshot and secrets", async () => {
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
      select: { id: true, status: true, startedAt: true, expiresAt: true },
    });

    const response = {
      attempt: {
        id: attempt.id,
        status: "IN_PROGRESS" as const,
        startedAt: attempt.startedAt.toISOString(),
        expiresAt: attempt.expiresAt.toISOString(),
      },
    };

    const serialized = JSON.stringify(response);
    expect(() => assertNoCandidateLeakage(serialized, SECRETS)).not.toThrow();
    expect(serialized).not.toContain("scenarioSnapshot");
    expect(serialized).not.toContain(snapshot.content.environment.rootCause);
  });

  it("concurrent starts create only one attempt", async () => {
    const seeded = await seedOrg("OrgA");
    const snapshot = buildScenarioSnapshot(seeded.template, seeded.version, seeded.org);

    const startOnce = async () => {
      return prisma.$transaction(async (tx) => {
        const claimed = await tx.assignment.updateMany({
          where: {
            id: seeded.assignment.id,
            status: "PENDING",
          },
          data: { status: "IN_PROGRESS" },
        });
        if (claimed.count !== 1) {
          throw new Error("ASSIGNMENT_NOT_STARTABLE");
        }
        return tx.attempt.create({
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
      });
    };

    const results = await Promise.allSettled([startOnce(), startOnce()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const attempts = await prisma.attempt.count({
      where: { candidateId: seeded.candidate.id, status: AttemptStatus.IN_PROGRESS },
    });
    expect(attempts).toBe(1);
  });

  it("rejects cross-organization attempt access", async () => {
    const orgA = await seedOrg("OrgA");
    const orgB = await seedOrg("OrgB");
    const snapshot = buildScenarioSnapshot(orgA.template, orgA.version, orgA.org);
    const attempt = await prisma.attempt.create({
      data: {
        assignmentId: orgA.assignment.id,
        candidateId: orgA.candidate.id,
        scenarioVersionId: orgA.version.id,
        organizationId: orgA.org.id,
        expiresAt: new Date(Date.now() + 45 * 60_000),
        scenarioSnapshot: snapshot as object,
        status: AttemptStatus.COMPLETED,
        submittedAt: new Date(),
      },
    });

    const cross = await prisma.attempt.findFirst({
      where: { id: attempt.id, organizationId: orgB.org.id },
    });
    expect(cross).toBeNull();
  });
});
