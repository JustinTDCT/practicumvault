"use client";

import { useCallback, useEffect, useState } from "react";

interface ModelOption {
  id: string;
  label: string;
}

interface ModelSelectProps {
  label: string;
  provider: "OPENAI" | "ANTHROPIC" | "LOCAL";
  value: string;
  onChange: (value: string) => void;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  localLlmBaseUrl?: string;
  autoLoad?: boolean;
}

export function ModelSelect({
  label,
  provider,
  value,
  onChange,
  anthropicApiKey,
  openaiApiKey,
  localLlmBaseUrl,
  autoLoad = false,
}: ModelSelectProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        anthropicApiKey,
        openaiApiKey,
        localLlmBaseUrl,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Failed to load models");
      setLoaded(true);
      return;
    }

    setModels(data.models ?? []);
    setLoaded(true);

    if (data.models?.length && !value) {
      onChange(data.models[0].id);
    }
  }, [provider, anthropicApiKey, openaiApiKey, localLlmBaseUrl, value, onChange]);

  useEffect(() => {
    setModels([]);
    setLoaded(false);
    setError("");
  }, [provider, anthropicApiKey, openaiApiKey, localLlmBaseUrl]);

  useEffect(() => {
    if (autoLoad) {
      loadModels();
    }
  }, [autoLoad, loadModels]);

  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading && !loaded}
          style={{ flex: 1 }}
        >
          {!loaded && value && <option value={value}>{value} (current)</option>}
          {loaded && models.length === 0 && !value && (
            <option value="">No models found</option>
          )}
          {loaded && value && !models.some((m) => m.id === value) && (
            <option value={value}>{value} (current, not in list)</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={loadModels}
          disabled={loading}
          style={{ whiteSpace: "nowrap" }}
        >
          {loading ? "Loading..." : loaded ? "Refresh" : "Load models"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loaded && !loading && !error && !autoLoad && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
          Click Load models after entering your API key or local LLM URL.
        </p>
      )}
      {loaded && models.length > 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
          {models.length} model{models.length === 1 ? "" : "s"} available
        </p>
      )}
    </div>
  );
}
