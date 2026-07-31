import { describe, expect, it } from "vitest";
import { buildScenarioSnapshot, parseScenarioSnapshot } from "@/lib/attempts/snapshot";
import { getDefaultTemplateContent } from "@/lib/templates/schema";
import { LlmProvider, TemplateStatus } from "@prisma/client";

describe("scenario snapshots", () => {
  const template = {
    id: "tpl-1",
    slug: "dns-issue",
    title: "DNS Issue",
    description: "",
    enabled: true,
    organizationId: "org-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const version = {
    id: "ver-1",
    version: "1.0",
    status: TemplateStatus.PUBLISHED,
    timeLimitMinutes: 45,
    content: getDefaultTemplateContent("DNS Issue"),
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
    templateId: "tpl-1",
  };

  const org = {
    id: "org-1",
    name: "Test Org",
    setupComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    showCountdownTimer: true,
    showElapsedTimer: true,
    llmProvider: LlmProvider.OPENAI,
    anthropicApiKey: null,
    openaiApiKey: null,
    localLlmBaseUrl: null,
    anthropicModel: "claude-sonnet-4-20250514",
    openaiModel: "gpt-4o",
    localLlmModel: "llama3.2",
  };

  it("captures immutable scenario content at attempt start", () => {
    const snapshot = buildScenarioSnapshot(template, version, org);
    expect(snapshot.templateId).toBe("tpl-1");
    expect(snapshot.scenarioVersionId).toBe("ver-1");
    expect(snapshot.versionDisplay).toBe("1.0");
    expect(snapshot.templateTitle).toBe("DNS Issue");
    expect(snapshot.content.metadata.title).toBe("DNS Issue");
    expect(snapshot.modelProvider).toBe(LlmProvider.OPENAI);
    expect(snapshot.modelName).toBe("gpt-4o");
    expect(snapshot.simulationPromptVersion).toBeTruthy();
  });

  it("remains unchanged when parsed back", () => {
    const snapshot = buildScenarioSnapshot(template, version, org);
    const modifiedContent = { ...snapshot.content, metadata: { ...snapshot.content.metadata, title: "Changed" } };
    const parsed = parseScenarioSnapshot({ ...snapshot, content: snapshot.content });
    expect(parsed.content.metadata.title).toBe("DNS Issue");
    expect(modifiedContent.metadata.title).toBe("Changed");
    expect(parsed.content.metadata.title).not.toBe("Changed");
  });
});
