"use client";

import { ChatInterface } from "@/components/chat-interface";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function CandidateAttemptPage() {
  const params = useParams();
  const router = useRouter();
  const attemptId = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/attempts/${attemptId}`);
      if (!res.ok) {
        router.push("/candidate");
        return;
      }
      setData(await res.json());
      setLoading(false);
    }
    load();
  }, [attemptId, router]);

  if (loading || !data) {
    return <div className="container">Loading assessment...</div>;
  }

  const attempt = data.attempt as Record<string, unknown>;
  const messages = data.messages as Array<{ id: string; role: string; content: string }>;
  const timerSettings = data.timerSettings as { showCountdown: boolean; showElapsed: boolean };

  if (attempt.status !== "IN_PROGRESS") {
    return (
      <div className="container" style={{ marginTop: 80 }}>
        <div className="card">
          <h2>Session ended</h2>
          <p>This assessment session is no longer active (status: {attempt.status as string}).</p>
          <button className="btn btn-primary" type="button" onClick={() => router.push("/candidate")}>
            Back to assessments
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <nav className="nav">
        <span className="nav-brand">Practicum Vault</span>
        <span>{attempt.scenarioTitle as string} · v{attempt.scenarioVersion as string}</span>
      </nav>
      <ChatInterface
        attemptId={attemptId}
        initialMessages={messages}
        timerSettings={timerSettings}
        expiresAt={attempt.expiresAt as string}
        startedAt={attempt.startedAt as string}
        submittedAt={attempt.submittedAt as string | null | undefined}
        status={attempt.status as string}
        completedAt={attempt.completedAt as string | null | undefined}
        onComplete={() => router.push("/candidate/complete")}
        onAbort={async () => {
          await fetch(`/api/attempts/${attemptId}`, { method: "DELETE" });
          router.push("/candidate");
        }}
      />
    </>
  );
}
