"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Assignment {
  id: string;
  status: string;
  canStart: boolean;
  scenarioVersion: {
    template: { title: string };
    version: string;
    timeLimitMinutes: number;
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Ready to start";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Submitted";
    case "ABORTED":
      return "Aborted — retry available";
    case "TIMED_OUT":
      return "Timed out — retry available";
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "badge badge-success";
    case "ABORTED":
    case "TIMED_OUT":
      return "badge badge-warning";
    case "IN_PROGRESS":
      return "badge badge-muted";
    default:
      return "badge badge-muted";
  }
}

export default function CandidateDashboard() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/candidate/dashboard");
    const data = await res.json();
    if (data.activeAttempt) {
      router.replace(`/candidate/attempt/${data.activeAttempt.id}`);
      return;
    }
    setAssignments(data.assignments || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [router]);

  async function startAssignment(assignmentId: string) {
    const res = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    router.push(`/candidate/attempt/${data.attempt.id}`);
  }

  async function handleLogout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    router.push("/login");
  }

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  return (
    <>
      <nav className="nav">
        <span className="nav-brand">Practicum Vault</span>
        <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Sign out</button>
      </nav>
      <div className="container">
        <div className="page-header">
          <h1>Your Assessments</h1>
          <p>Submitted assessments cannot be retaken unless your administrator re-opens them.</p>
        </div>

        {assignments.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0, color: "var(--text-muted)" }}>No scenarios assigned yet. Contact your administrator.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {assignments.map((a) => (
              <div key={a.id} className="card list-card">
                <div>
                  <h3 className="list-card-title">{a.scenarioVersion.template.title}</h3>
                  <p className="list-card-meta">
                    Version {a.scenarioVersion.version} · {a.scenarioVersion.timeLimitMinutes} min
                  </p>
                  <span className={statusBadgeClass(a.status)} style={{ marginTop: 8, display: "inline-block" }}>
                    {statusLabel(a.status)}
                  </span>
                </div>
                {a.canStart ? (
                  <button className="btn btn-primary" type="button" onClick={() => startAssignment(a.id)}>
                    {a.status === "PENDING" ? "Start assessment" : "Retry assessment"}
                  </button>
                ) : a.status === "COMPLETED" ? (
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.875rem", maxWidth: 220, textAlign: "right" }}>
                    Submitted for scoring. Ask your admin for another attempt.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
