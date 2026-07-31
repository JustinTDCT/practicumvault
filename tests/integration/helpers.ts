import { PrismaClient, UserRole, TemplateStatus, LlmProvider } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { getDefaultTemplateContent } from "../../src/lib/templates/schema";

export const prisma = new PrismaClient();

export function requireTestDatabase(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_TEST or DATABASE_URL required for integration tests");
  }
  return url;
}

export async function resetTestDatabase() {
  await prisma.attemptEvent.deleteMany();
  await prisma.attemptMessage.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.scenarioVersion.deleteMany();
  await prisma.scenarioTemplate.deleteMany();
  await prisma.user.deleteMany();
  await prisma.position.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.organization.deleteMany();
}

export async function seedOrg(name: string) {
  const org = await prisma.organization.create({
    data: {
      name,
      setupComplete: true,
      llmProvider: LlmProvider.LOCAL,
      localLlmModel: "test-model",
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: `${name.toLowerCase().replace(/\s+/g, "")}-admin@test.local`,
      fullName: `${name} Admin`,
      passwordHash: await hashPassword("password123"),
      role: UserRole.ADMIN,
      isPrimaryAdmin: true,
      organizationId: org.id,
    },
  });

  const candidate = await prisma.user.create({
    data: {
      email: `${name.toLowerCase().replace(/\s+/g, "")}-candidate@test.local`,
      fullName: `${name} Candidate`,
      passwordHash: await hashPassword("password123"),
      role: UserRole.CANDIDATE,
      organizationId: org.id,
    },
  });

  const content = getDefaultTemplateContent(`${name} Scenario`);
  content.environment.rootCause = `SECRET_ROOT_CAUSE_${name}`;
  content.environment.hiddenFacts = [`SECRET_HIDDEN_FACT_${name}`];
  content.environment.redHerrings = [`SECRET_RED_HERRING_${name}`];
  content.aiInstructions = `SECRET_AI_INSTRUCTIONS_${name}`;
  content.actions = [
    {
      id: "hosts-view",
      label: "View HOSTS",
      triggers: ["hosts"],
      result: `SECRET_ACTION_RESULT_${name}`,
      category: "diagnostic",
      requirements: {
        requireTargetSystem: true,
        requireMethodOrTool: true,
        requiredParameters: [],
        allowedTargets: ["CLIENT-PC"],
        allowedMethods: ["type"],
      },
    },
  ];
  content.objectives[0].name = `SECRET_OBJECTIVE_NAME_${name}`;
  content.objectives[0].passCriteria = `SECRET_PASS_CRITERIA_${name}`;
  content.scoringRubric.categories[0].name = `SECRET_RUBRIC_CATEGORY_${name}`;
  content.hints = [{ level: 1, text: `SECRET_HINT_TEXT_${name}`, penalty: 5 }];

  const template = await prisma.scenarioTemplate.create({
    data: {
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-scenario`,
      title: `${name} Scenario`,
      organizationId: org.id,
      versions: {
        create: {
          version: "1.0",
          status: TemplateStatus.PUBLISHED,
          timeLimitMinutes: 45,
          content,
          publishedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });

  const assignment = await prisma.assignment.create({
    data: {
      organizationId: org.id,
      candidateId: candidate.id,
      assignedById: admin.id,
      scenarioVersionId: template.versions[0].id,
      status: "PENDING",
    },
  });

  return { org, admin, candidate, template, version: template.versions[0], assignment, content };
}
