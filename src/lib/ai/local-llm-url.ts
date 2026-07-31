/**
 * When the app runs inside Docker, localhost refers to the container — not the host
 * where Ollama is running. Try host.docker.internal as a fallback.
 */
export function localLlmUrlCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const candidates = [trimmed];

  const dockerHost = process.env.LOCAL_LLM_HOST || "host.docker.internal";
  if (/:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(trimmed)) {
    candidates.push(
      trimmed.replace(/:\/\/localhost/, `://${dockerHost}`).replace(/:\/\/127\.0\.0\.1/, `://${dockerHost}`),
    );
  }

  return [...new Set(candidates)];
}

export function localLlmConnectionHint(baseUrl: string): string {
  if (/:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
    return " If Practicum Vault runs in Docker, use http://host.docker.internal:PORT/v1 — localhost inside the container is not your Mac.";
  }
  return "";
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out connecting to ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
