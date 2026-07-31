"use client";

import { AdminNav } from "@/components/admin-nav";
import { ChatInterface } from "@/components/chat-interface";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function AttemptDetailPage() {
  const params = useParams();
  const attemptId = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [rescoring, setRescoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/attempts/${attemptId}`)
      .then((r) => r.json())
      .then(setData);
  }, [attemptId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return (<><AdminNav /><div className="container">Loading...</div></>);

  const attempt = data.attempt as Record<string, unknown>;
  const messages = data.messages as Array<{ id: string; role: string; content: string }>;
  const score = data.score as Record<string, unknown> | undefined;
  const status = attempt.status as string;
  const canRescore = status === "SCORING_FAILED" || status === "COMPLETED";

  async function handleRescore() {
    if (!confirm("Rescore this attempt? Transcript and submission time will be preserved.")) {
      return;
    }
    setRescoring(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/attempts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, action: "rescore", modelMode: "ORIGINAL_MODEL" }),
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
          </p>
          <div className="page-toolbar" style={{ marginBottom: 0, marginTop: 12 }}>
            <div className="btn-group">
              <a className="btn btn-secondary btn-sm" href={`/api/admin/attempts/${attemptId}/transcript`}>Transcript</a>
              {score && (
                <a className="btn btn-primary btn-sm" href={`/api/admin/attempts/${attemptId}/pdf`}>PDF report</a>
              )}
              {canRescore && (
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={handleRescore}
                  disabled={rescoring}
                >
                  {rescoring ? "Rescoring…" : "Rescore"}
                </button>
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
            <p style={{ margin: "0 0 8px" }}><strong>Model:</strong> {(attempt.scoringModel as string) || (score?.scoringModel as string) || "—"}</p>
            {status === "SCORING_FAILED" && (
              <p style={{ margin: 0, color: "var(--text-muted)" }}>
                Scoring failed. You can retry without changing the original submission time or transcript.
              </p>
            )}
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
