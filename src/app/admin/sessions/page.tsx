"use client";

import { AdminNav } from "@/components/admin-nav";
import { ChatInterface } from "@/components/chat-interface";
import { useEffect, useState } from "react";

interface Session {
  id: string;
  candidateName: string;
  candidateEmail: string;
  scenarioTitle: string;
  scenarioVersion: string;
  startedAt: string;
  expiresAt: string;
  timer: { elapsedFormatted: string; remainingFormatted: string };
  messages: Array<{ id: string; role: string; content: string }>;
}

export default function LiveSessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);

  async function load() {
    const res = await fetch("/api/admin/sessions");
    const data = await res.json();
    setSessions(data.sessions);
    if (selected) {
      const updated = data.sessions.find((s: Session) => s.id === selected.id);
      setSelected(updated ?? null);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function abortSession(id: string) {
    if (!confirm("Abort this session? Score will be 0.")) return;
    await fetch(`/api/attempts/${id}`, { method: "DELETE" });
    setSelected(null);
    load();
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Live Sessions</h1>
          <p>Monitor in-progress assessments and view live transcripts.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: selected ? "320px 1fr" : "1fr", gap: 16 }}>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Scenario</th>
                  <th>Elapsed</th>
                  <th>Remaining</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr><td colSpan={5}>No active sessions</td></tr>
                )}
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.candidateName}</td>
                    <td>{s.scenarioTitle} v{s.scenarioVersion}</td>
                    <td>{s.timer.elapsedFormatted}</td>
                    <td>{s.timer.remainingFormatted}</td>
                    <td>
                      <button className="btn btn-secondary" type="button" onClick={() => setSelected(s)}>View</button>
                      <button className="btn btn-danger" type="button" onClick={() => abortSession(s.id)} style={{ marginLeft: 4 }}>Abort</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
                <strong>{selected.candidateName}</strong> — {selected.scenarioTitle}
              </div>
              <ChatInterface
                attemptId={selected.id}
                initialMessages={selected.messages}
                timerSettings={{ showCountdown: true, showElapsed: true }}
                expiresAt={selected.expiresAt}
                startedAt={selected.startedAt}
                onComplete={() => load()}
                onAbort={() => abortSession(selected.id)}
                readOnly
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
