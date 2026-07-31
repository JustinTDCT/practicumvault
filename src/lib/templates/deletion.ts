import { prisma } from "@/lib/db";
import { AssignmentStatus, AttemptStatus } from "@prisma/client";

export type TemplateDeletionStatus = {
  canDelete: boolean;
  reason: string | null;
  completedAttempts: number;
  activeAssignments: number;
};

export async function getTemplateDeletionStatus(
  templateId: string,
  organizationId: string,
): Promise<TemplateDeletionStatus | null> {
  const template = await prisma.scenarioTemplate.findUnique({
    where: { id: templateId, organizationId },
    include: { versions: { select: { id: true } } },
  });

  if (!template) return null;

  const versionIds = template.versions.map((v) => v.id);
  if (versionIds.length === 0) {
    return { canDelete: true, reason: null, completedAttempts: 0, activeAssignments: 0 };
  }

  const [completedAttempts, activeAssignments] = await Promise.all([
    prisma.attempt.count({
      where: {
        scenarioVersionId: { in: versionIds },
        status: AttemptStatus.COMPLETED,
      },
    }),
    prisma.assignment.count({
      where: {
        scenarioVersionId: { in: versionIds },
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_PROGRESS] },
      },
    }),
  ]);

  if (completedAttempts > 0) {
    return {
      canDelete: false,
      reason: "This template has submitted assessments on file (reporting history).",
      completedAttempts,
      activeAssignments,
    };
  }

  if (activeAssignments > 0) {
    return {
      canDelete: false,
      reason: "This template has an active assignment (pending or in progress).",
      completedAttempts,
      activeAssignments,
    };
  }

  return {
    canDelete: true,
    reason: null,
    completedAttempts,
    activeAssignments,
  };
}

export async function deleteTemplateCascade(templateId: string, organizationId: string) {
  const status = await getTemplateDeletionStatus(templateId, organizationId);
  if (!status) {
    throw new Error("Template not found");
  }
  if (!status.canDelete) {
    throw new Error(status.reason ?? "Template cannot be deleted");
  }

  const template = await prisma.scenarioTemplate.findUnique({
    where: { id: templateId, organizationId },
    include: { versions: { select: { id: true } } },
  });
  if (!template) throw new Error("Template not found");

  const versionIds = template.versions.map((v) => v.id);
  const attempts = await prisma.attempt.findMany({
    where: { scenarioVersionId: { in: versionIds } },
    select: { id: true },
  });
  const attemptIds = attempts.map((a) => a.id);

  if (attemptIds.length > 0) {
    await prisma.attemptMessage.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.attemptEvent.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
  }

  await prisma.assignment.deleteMany({
    where: { scenarioVersionId: { in: versionIds } },
  });

  await prisma.scenarioTemplate.delete({ where: { id: templateId } });
}
