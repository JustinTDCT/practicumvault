"use client";

import { AdminNav } from "@/components/admin-nav";
import { ChatInterface } from "@/components/chat-interface";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ScoringFailure = {
  at: string | null;
  category: string;
  retryable: boolean;
  model: string | null;
  scoringAttempt: number;
};

type ScoringRun = {
  id: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown> | null;
};

export default function AttemptDetailPage() {
  const params = useParams();
  const attemptId = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [scoringRuns, setScoringRuns] = useState<ScoringRun[]>([]);
  const [rescoring, setRescoring] = useState(false);
  const [modelMode, setModelMode] = useState<"ORIGINAL_MODEL" | "CURRENT_MODEL">("ORIGINAL_MODEL");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/attempts/${attemptId}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          setError(body.error || "Failed to load attempt");
          setData(null);
          return;
        }
        setError(null);
        setData(body);
      });
    fetch(`/api/admin/attempts/${attemptId}/scoring-runs`)
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json();
        setScoringRuns(body.runs ?? []);
      })
      .catch(() => undefined);
  }, [attemptId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) {
    return (
      <>
        <AdminNav />
        <div className="container">
          <div className="alert alert-error">{error}</div>
          <Link className="btn btn-secondary btn-sm" href="/admin/attempts">Back to reports</Link>
        </div>
      </>
    );
  }

  if (!data) return (<><AdminNav /><div className="container">Loading...</div></>);

  const attempt = data.attempt as Record<string, unknown>;
  const messages = data.messages as Array<{ id: string; role: string; content: string }>;
  const score = data.score as Record<string, unknown> | undefined;
  const status = attempt.status as string;
  const canRescore = status === "SCORING_FAILED" || status === "COMPLETED";
  const failure = attempt.lastScoringFailure as ScoringFailure | null;

  async function handleRescore() {
    if (!confirm("Rescore this attempt? Transcript and submission time will be preserved. Prior scoring runs remain in the audit history.")) {
      return;
    }
    setRescoring(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/attempts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, action: "rescore", modelMode }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Rescore failed");
      }
      setMessage(`Rescore complete. Status: ${body.attempt?.status}. Score: ${body.attempt?.overallScore ?? "—"}/100`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rescore failed");
    } finally {
      setRescoring(false);
    }
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>{attempt.scenarioTitle as string} — {attempt.candidateName as string}</h1>
          <p>
            <span className="badge badge-muted">{status}</span>
            <span style={{ marginLeft: 10 }}>Score: {(score?.overallScore as number | null | undefined) ?? "—"}/100</span>
            {attempt.scenarioSlug ? (
              <span style={{ marginLeft: 10, color: "var(--text-muted)" }}>{attempt.scenarioSlug as string}</span>
            ) : null}
          </p>
          <div className="page-toolbar" style={{ marginBottom: 0, marginTop: 12 }}>
            <div className="btn-group">
              <a className="btn btn-secondary btn-sm" href={`/api/admin/attempts/${attemptId}/transcript`}>Transcript</a>
              {score && (
                <a className="btn btn-primary btn-sm" href={`/api/admin/attempts/${attemptId}/pdf`}>PDF report</a>
              )}
              <Link className="btn btn-secondary btn-sm" href="/admin/attempts">Back to reports</Link>
            </div>
          </div>
        </div>

        {(status === "SCORING_FAILED" || canRescore) && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Scoring</h3>
            <p style={{ margin: "0 0 8px" }}><strong>Status:</strong> {status}</p>
            <p style={{ margin: "0 0 8px" }}><strong>Scoring attempts:</strong> {(attempt.scoringAttempts as number) ?? 0}</p>
            <p style={{ margin: "0 0 8px" }}><strong>Actual model:</strong> {(attempt.scoringModel as string) || (score?.scoringModel as string) || "—"}</p>
            {failure && (
              <>
                <p style={{ margin: "0 0 8px" }}><strong>Last failure time:</strong> {failure.at ? new Date(failure.at).toLocaleString() : "—"}</p>
                <p style={{ margin: "0 0 8px" }}><strong>Sanitized reason:</strong> {failure.category}</p>
                <p style={{ margin: "0 0 8px" }}><strong>Retryable:</strong> {failure.retryable ? "Yes" : "No"}</p>
                <p style={{ margin: "0 0 8px" }}><strong>Failure model:</strong> {failure.model || "—"}</p>
                <p style={{ margin: "0 0 8px" }}><strong>Failure attempt #:</strong> {failure.scoringAttempt}</p>
              </>
            )}
            {canRescore && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                <label style={{ fontSize: 14 }}>
                  Model for rescore{" "}
                  <select
                    value={modelMode}
                    onChange={(e) => setModelMode(e.target.value as "ORIGINAL_MODEL" | "CURRENT_MODEL")}
                    disabled={rescoring}
                  >
                    <option value="ORIGINAL_MODEL">Original model (from snapshot)</option>
                    <option value="CURRENT_MODEL">Current organization model</option>
                  </select>
                </label>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={handleRescore}
                  disabled={rescoring}
                >
                  {rescoring ? "Rescoring…" : "Rescore"}
                </button>
              </div>
            )}
          </div>
        )}

        {scoringRuns.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Scoring-run history</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {scoringRuns.map((run) => (
                <li key={run.id} style={{ marginBottom: 8 }}>
                  <strong>{run.type}</strong> — {new Date(run.createdAt).toLocaleString()}
                  {run.payload?.scoringModel ? ` · ${String(run.payload.scoringModel)}` : ""}
                  {run.payload?.overallScore != null ? ` · score ${String(run.payload.overallScore)}` : ""}
                  {run.payload?.category ? ` · ${String(run.payload.category)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {message && <div className="alert" style={{ marginBottom: 16 }}>{message}</div>}
        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {score && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Summary</h3>
            <p style={{ margin: "0 0 8px" }}><strong>Strengths:</strong> {score.strengths as string}</p>
            <p style={{ margin: "0 0 8px" }}><strong>Development areas:</strong> {score.developmentAreas as string}</p>
            <p style={{ margin: 0 }}><strong>Recommendation:</strong> {score.recommendation as string}</p>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <ChatInterface
            attemptId={attemptId}
            initialMessages={messages}
            timerSettings={{ showCountdown: true, showElapsed: true }}
            expiresAt={attempt.expiresAt as string}
            startedAt={attempt.startedAt as string}
            submittedAt={attempt.submittedAt as string | null | undefined}
            status={status}
            completedAt={attempt.completedAt as string | null | undefined}
            onComplete={() => {}}
            onAbort={() => {}}
            readOnly
          />
        </div>
      </div>
    </>
  );
}
