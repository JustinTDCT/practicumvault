"use client";

import { AdminNav } from "@/components/admin-nav";
import { ChatInterface } from "@/components/chat-interface";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function AttemptDetailPage() {
  const params = useParams();
  const attemptId = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/attempts/${attemptId}`).then((r) => r.json()).then(setData);
  }, [attemptId]);

  if (!data) return (<><AdminNav /><div className="container">Loading...</div></>);

  const attempt = data.attempt as Record<string, unknown>;
  const messages = data.messages as Array<{ id: string; role: string; content: string }>;
  const score = data.score as Record<string, unknown> | undefined;

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>{attempt.scenarioTitle as string} — {attempt.candidateName as string}</h1>
          <p>
            <span className="badge badge-muted">{attempt.status as string}</span>
            <span style={{ marginLeft: 10 }}>Score: {(score?.overallScore as number | null | undefined) ?? "—"}/100</span>
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
            status={attempt.status as string}
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
