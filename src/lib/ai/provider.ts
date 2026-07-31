import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModel } from "ai";
import { LlmProvider, Organization } from "@prisma/client";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { localLlmUrlCandidates } from "@/lib/ai/local-llm-url";
import { ScenarioAttemptSnapshot } from "@/lib/attempts/snapshot";

function safeDecrypt(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch {
    return undefined;
  }
}

function buildModel(provider: LlmProvider, modelName: string, org: Organization): LanguageModel {
  switch (provider) {
    case LlmProvider.ANTHROPIC: {
      const apiKey = safeDecrypt(org.anthropicApiKey);
      if (!apiKey) throw new Error("Anthropic API key is not configured.");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelName);
    }
    case LlmProvider.OPENAI: {
      const apiKey = safeDecrypt(org.openaiApiKey);
      if (!apiKey) throw new Error("OpenAI API key is not configured.");
      const openai = createOpenAI({ apiKey });
      return openai(modelName);
    }
    case LlmProvider.LOCAL: {
      const configured = org.localLlmBaseUrl || "http://localhost:11434/v1";
      const candidates = localLlmUrlCandidates(configured);
      const baseURL =
        process.env.IN_DOCKER === "true" && candidates.length > 1
          ? candidates[1]
          : candidates[0];
      const openai = createOpenAI({
        apiKey: "ollama",
        baseURL,
      });
      return openai(modelName);
    }
    default:
      throw new Error("Unsupported LLM provider.");
  }
}

function resolveOrgModelName(org: Organization): string {
  switch (org.llmProvider) {
    case LlmProvider.ANTHROPIC:
      return org.anthropicModel;
    case LlmProvider.OPENAI:
      return org.openaiModel;
    case LlmProvider.LOCAL:
      return org.localLlmModel;
    default:
      return org.openaiModel;
  }
}

/** Live organization settings (admin tooling, setup). */
export function getLanguageModel(org: Organization): LanguageModel {
  return buildModel(org.llmProvider, resolveOrgModelName(org), org);
}

export type RescoreModelMode = "ORIGINAL_MODEL" | "CURRENT_MODEL";

/**
 * Attempt inference uses snapshot provider/model.
 * API keys and connection details come from the current organization.
 */
export function getLanguageModelForAttempt(options: {
  snapshot: ScenarioAttemptSnapshot;
  organization: Organization;
  mode?: RescoreModelMode;
}): { model: LanguageModel; provider: LlmProvider; modelName: string; mode: RescoreModelMode } {
  const mode = options.mode ?? "ORIGINAL_MODEL";
  if (mode === "CURRENT_MODEL") {
    const modelName = resolveOrgModelName(options.organization);
    return {
      model: buildModel(options.organization.llmProvider, modelName, options.organization),
      provider: options.organization.llmProvider,
      modelName,
      mode,
    };
  }

  const provider = options.snapshot.modelProvider;
  const modelName = options.snapshot.modelName;
  return {
    model: buildModel(provider, modelName, options.organization),
    provider,
    modelName,
    mode,
  };
}

export function providerLabel(provider: LlmProvider): string {
  switch (provider) {
    case LlmProvider.ANTHROPIC:
      return "Anthropic";
    case LlmProvider.OPENAI:
      return "OpenAI";
    case LlmProvider.LOCAL:
      return "Local (OpenAI-compatible)";
    default:
      return provider;
  }
}

export function formatModelLabel(provider: LlmProvider, modelName: string): string {
  return `${providerLabel(provider)}/${modelName}`;
}
