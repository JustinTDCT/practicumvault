import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModel } from "ai";
import { LlmProvider, Organization } from "@prisma/client";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { localLlmUrlCandidates } from "@/lib/ai/local-llm-url";

function safeDecrypt(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch {
    return undefined;
  }
}

export function getLanguageModel(org: Organization): LanguageModel {
  switch (org.llmProvider) {
    case LlmProvider.ANTHROPIC: {
      const apiKey = safeDecrypt(org.anthropicApiKey);
      if (!apiKey) throw new Error("Anthropic API key is not configured.");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(org.anthropicModel);
    }
    case LlmProvider.OPENAI: {
      const apiKey = safeDecrypt(org.openaiApiKey);
      if (!apiKey) throw new Error("OpenAI API key is not configured.");
      const openai = createOpenAI({ apiKey });
      return openai(org.openaiModel);
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
      return openai(org.localLlmModel);
    }
    default:
      throw new Error("Unsupported LLM provider.");
  }
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
