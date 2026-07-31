import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export class OrgAccessError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "OrgAccessError";
  }
}

export async function verifyOrgUser(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
  if (!user) throw new OrgAccessError();
  return user;
}

export async function verifyOrgCandidate(candidateId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: candidateId, organizationId, role: UserRole.CANDIDATE },
  });
  if (!user) throw new OrgAccessError();
  return user;
}

export async function verifyOrgTemplate(templateId: string, organizationId: string) {
  const template = await prisma.scenarioTemplate.findFirst({
    where: { id: templateId, organizationId },
  });
  if (!template) throw new OrgAccessError();
  return template;
}

export async function verifyOrgScenarioVersion(versionId: string, organizationId: string) {
  const version = await prisma.scenarioVersion.findFirst({
    where: { id: versionId, template: { organizationId } },
    include: { template: true },
  });
  if (!version) throw new OrgAccessError();
  return version;
}

export async function verifyOrgAssignment(assignmentId: string, organizationId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, organizationId },
  });
  if (!assignment) throw new OrgAccessError();
  return assignment;
}

export async function verifyOrgAttempt(attemptId: string, organizationId: string) {
  const attempt = await prisma.attempt.findFirst({
    where: { id: attemptId, organizationId },
  });
  if (!attempt) throw new OrgAccessError();
  return attempt;
}

export async function verifyOrgPosition(positionId: string, organizationId: string) {
  const position = await prisma.position.findFirst({
    where: { id: positionId, organizationId },
  });
  if (!position) throw new OrgAccessError();
  return position;
}
