import { LlmProvider, Organization } from "@prisma/client";
import { decrypt, isEncrypted } from "@/lib/encryption";
import {
  fetchWithTimeout,
  localLlmConnectionHint,
  localLlmUrlCandidates,
} from "@/lib/ai/local-llm-url";

export interface ModelOption {
  id: string;
  label: string;
}

function safeDecrypt(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch {
    return undefined;
  }
}

function ollamaTagsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3) + "/api/tags";
  }
  return trimmed + "/api/tags";
}

function openAiModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

async function fetchOpenAiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI models request failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o[0-9]|chatgpt-)/i.test(id))
    .filter((id) => !/(embed|whisper|tts|dall-e|realtime|audio|transcribe|search|computer)/i.test(id))
    .sort();

  return models.map((id) => ({ id, label: id }));
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic models request failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
  };
  const models = (data.data ?? [])
    .map((m) => ({
      id: m.id,
      label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (models.length > 0) return models;

  return [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ];
}

async function fetchLocalModelsFromBase(baseUrl: string): Promise<ModelOption[]> {
  const openAiUrl = openAiModelsUrl(baseUrl);
  try {
    const res = await fetchWithTimeout(openAiUrl, {
      headers: { Authorization: "Bearer ollama" },
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean).sort();
      if (models.length > 0) {
        return models.map((id) => ({ id, label: id }));
      }
    }
  } catch {
    // try Ollama native API
  }

  const tagsUrl = ollamaTagsUrl(baseUrl);
  const res = await fetchWithTimeout(tagsUrl);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    models?: Array<{ name: string; details?: { parameter_size?: string } }>;
  };
  const models = (data.models ?? [])
    .map((m) => ({
      id: m.name,
      label: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (models.length === 0) {
    throw new Error("Ollama returned no models");
  }
  return models;
}

async function fetchLocalModels(baseUrl: string): Promise<ModelOption[]> {
  const attempts: string[] = [];

  for (const url of localLlmUrlCandidates(baseUrl)) {
    try {
      return await fetchLocalModelsFromBase(url);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "fetch failed";
      attempts.push(`${url} → ${msg}`);
    }
  }

  throw new Error(
    `Could not reach Ollama. ${attempts.join("; ")}.${localLlmConnectionHint(baseUrl)}`,
  );
}

export interface ListModelsInput {
  provider: LlmProvider;
  org: Organization;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  localLlmBaseUrl?: string;
}

export async function listAvailableModels(input: ListModelsInput): Promise<ModelOption[]> {
  const { provider, org } = input;

  switch (provider) {
    case LlmProvider.OPENAI: {
      const apiKey =
        input.openaiApiKey && input.openaiApiKey !== "configured"
          ? input.openaiApiKey
          : safeDecrypt(org.openaiApiKey);
      if (!apiKey) throw new Error("OpenAI API key is not configured.");
      return fetchOpenAiModels(apiKey);
    }
    case LlmProvider.ANTHROPIC: {
      const apiKey =
        input.anthropicApiKey && input.anthropicApiKey !== "configured"
          ? input.anthropicApiKey
          : safeDecrypt(org.anthropicApiKey);
      if (!apiKey) throw new Error("Anthropic API key is not configured.");
      return fetchAnthropicModels(apiKey);
    }
    case LlmProvider.LOCAL: {
      const baseUrl = input.localLlmBaseUrl || org.localLlmBaseUrl || "http://localhost:11434/v1";
      return fetchLocalModels(baseUrl);
    }
    default:
      throw new Error("Unsupported provider.");
  }
}

export function resolveLocalLlmBaseUrl(baseUrl: string | null | undefined): string {
  const url = baseUrl || "http://localhost:11434/v1";
  const candidates = localLlmUrlCandidates(url);
  return process.env.IN_DOCKER === "true" && candidates.length > 1
    ? candidates[1]
    : candidates[0];
}
