"use client";

import { AdminNav } from "@/components/admin-nav";
import Link from "next/link";
import { useEffect, useState } from "react";

interface AttemptRow {
  id: string;
  candidateName: string;
  scenarioTitle: string;
  version: string;
  status: string;
  overallScore: number | null;
  startedAt: string;
  completedAt: string | null;
}

export default function ReportsPage() {
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/attempts").then((r) => r.json()).then((d) => setAttempts(d.attempts));
  }, []);

  async function saveNotes(attemptId: string) {
    await fetch("/api/admin/attempts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, adminNotes: notes[attemptId] || "" }),
    });
    alert("Notes saved");
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Assessment Reports</h1>
          <p>View completed assessments and download PDF reports for employee files.</p>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Date</th>
                  <th>Admin notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {attempts.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--text-muted)", textAlign: "center", padding: 32 }}>
                      No assessments yet
                    </td>
                  </tr>
                )}
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.candidateName}</td>
                    <td>{a.scenarioTitle} v{a.version}</td>
                    <td><span className="badge badge-muted">{a.status}</span></td>
                    <td>{a.overallScore ?? "—"}/100</td>
                    <td>{new Date(a.startedAt).toLocaleDateString()}</td>
                    <td style={{ minWidth: 200 }}>
                      <textarea
                        className="chat-input"
                        placeholder="Evaluation notes…"
                        value={notes[a.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                        style={{ minHeight: 64, width: "100%", resize: "vertical" }}
                      />
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => saveNotes(a.id)} style={{ marginTop: 6 }}>
                        Save notes
                      </button>
                    </td>
                    <td>
                      <div className="btn-group">
                        <Link className="btn btn-primary btn-sm" href={`/admin/attempts/${a.id}`}>View</Link>
                        <a className="btn btn-secondary btn-sm" href={`/api/admin/attempts/${a.id}/pdf`}>PDF</a>
                        <a className="btn btn-secondary btn-sm" href={`/api/admin/attempts/${a.id}/transcript`}>Transcript</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
