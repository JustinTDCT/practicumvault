"use client";

import { AdminNav } from "@/components/admin-nav";
import { ModelSelect } from "@/components/model-select";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [org, setOrg] = useState<Record<string, unknown>>({});
  const [pendingAnthropicKey, setPendingAnthropicKey] = useState("");
  const [pendingOpenAiKey, setPendingOpenAiKey] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d) => {
        setOrg(d.org);
        setLoaded(true);
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...org };
    if (pendingAnthropicKey) payload.anthropicApiKey = pendingAnthropicKey;
    if (pendingOpenAiKey) payload.openaiApiKey = pendingOpenAiKey;

    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setPendingAnthropicKey("");
      setPendingOpenAiKey("");
      setOrg((prev) => ({
        ...prev,
        anthropicApiKey: pendingAnthropicKey || prev.anthropicApiKey || "",
        openaiApiKey: pendingOpenAiKey || prev.openaiApiKey || "",
      }));
    }
    setMessage(res.ok ? "Settings saved" : "Failed to save");
  }

  const provider = (org.llmProvider as string) || "OPENAI";
  const anthropicKeyForQuery = pendingAnthropicKey || (org.anthropicApiKey as string) || undefined;
  const openaiKeyForQuery = pendingOpenAiKey || (org.openaiApiKey as string) || undefined;
  const localBaseUrl = (org.localLlmBaseUrl as string) || "http://localhost:11434/v1";

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Organization Settings</h1>
          <p>LLM provider, timer display, and organization name.</p>
        </div>

        <form className="card" onSubmit={save}>
          <div className="form-group">
            <label>Organization name</label>
            <input value={(org.name as string) || ""} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
          </div>

          <h3>Timer display (global)</h3>
          <div className="grid-2">
            <label><input type="checkbox" checked={!!org.showCountdownTimer} onChange={(e) => setOrg({ ...org, showCountdownTimer: e.target.checked })} /> Show countdown</label>
            <label><input type="checkbox" checked={!!org.showElapsedTimer} onChange={(e) => setOrg({ ...org, showElapsedTimer: e.target.checked })} /> Show elapsed time</label>
          </div>

          <h3 style={{ marginTop: 24 }}>LLM Provider</h3>
          <div className="form-group">
            <select value={provider} onChange={(e) => setOrg({ ...org, llmProvider: e.target.value })}>
              <option value="OPENAI">OpenAI</option>
              <option value="ANTHROPIC">Anthropic</option>
              <option value="LOCAL">Local (Ollama / OpenAI-compatible)</option>
            </select>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label>Anthropic API key {org.anthropicApiKey === "configured" && !pendingAnthropicKey && "(configured)"}</label>
              <input
                type="password"
                value={pendingAnthropicKey}
                placeholder="Leave blank to keep existing"
                onChange={(e) => setPendingAnthropicKey(e.target.value)}
              />
            </div>
            {loaded && (
              <ModelSelect
                label="Anthropic model"
                provider="ANTHROPIC"
                value={(org.anthropicModel as string) || ""}
                onChange={(anthropicModel) => setOrg({ ...org, anthropicModel })}
                anthropicApiKey={anthropicKeyForQuery}
                autoLoad={provider === "ANTHROPIC" && anthropicKeyForQuery === "configured"}
              />
            )}

            <div className="form-group">
              <label>OpenAI API key {org.openaiApiKey === "configured" && !pendingOpenAiKey && "(configured)"}</label>
              <input
                type="password"
                value={pendingOpenAiKey}
                placeholder="Leave blank to keep existing"
                onChange={(e) => setPendingOpenAiKey(e.target.value)}
              />
            </div>
            {loaded && (
              <ModelSelect
                label="OpenAI model"
                provider="OPENAI"
                value={(org.openaiModel as string) || ""}
                onChange={(openaiModel) => setOrg({ ...org, openaiModel })}
                openaiApiKey={openaiKeyForQuery}
                autoLoad={provider === "OPENAI" && openaiKeyForQuery === "configured"}
              />
            )}

            <div className="form-group">
              <label>Local LLM base URL</label>
              <input
                value={localBaseUrl}
                onChange={(e) => setOrg({ ...org, localLlmBaseUrl: e.target.value })}
                placeholder="http://host.docker.internal:11436/v1"
              />
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
                Use your Ollama port (e.g. 11436). Docker → <code>http://host.docker.internal:PORT/v1</code>.
                Local dev → <code>http://localhost:PORT/v1</code>.
              </p>
            </div>
            {loaded && (
              <ModelSelect
                label="Local LLM model"
                provider="LOCAL"
                value={(org.localLlmModel as string) || ""}
                onChange={(localLlmModel) => setOrg({ ...org, localLlmModel })}
                localLlmBaseUrl={localBaseUrl}
                autoLoad={provider === "LOCAL"}
              />
            )}
          </div>

          {message && <p className="success">{message}</p>}
          <button className="btn btn-primary" type="submit">Save settings</button>
        </form>
      </div>
    </>
  );
}
