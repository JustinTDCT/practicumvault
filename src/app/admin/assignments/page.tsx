"use client";

import { AdminNav } from "@/components/admin-nav";
import { useEffect, useState } from "react";

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Array<Record<string, unknown>>>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; fullName: string; email: string }>>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; title: string }>>([]);
  const [positions, setPositions] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ candidateId: "", templateId: "", positionId: "", notes: "" });
  const [error, setError] = useState("");

  async function load() {
    const [a, u, t, p] = await Promise.all([
      fetch("/api/admin/assignments"),
      fetch("/api/admin/users"),
      fetch("/api/admin/templates"),
      fetch("/api/admin/positions"),
    ]);
    setAssignments((await a.json()).assignments);
    setCandidates((await u.json()).users.filter((x: { role: string }) => x.role === "CANDIDATE"));
    setTemplates((await t.json()).templates);
    setPositions((await p.json()).positions);
  }

  useEffect(() => { load(); }, []);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setForm({ candidateId: "", templateId: "", positionId: "", notes: "" });
    load();
  }

  async function allowRetake(assignmentId: string) {
    if (!confirm("Allow this candidate to retake this assessment? The assignment will reopen for a new attempt.")) {
      return;
    }
    setError("");
    const res = await fetch("/api/admin/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId, action: "allow_retake" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to allow retake");
      return;
    }
    load();
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Assignments</h1>
          <p>Assign published scenarios to candidates.</p>
        </div>

        <form className="card" onSubmit={assign} style={{ marginBottom: 24 }}>
          <div className="grid-2">
            <div className="form-group">
              <label>Candidate</label>
              <select value={form.candidateId} onChange={(e) => setForm({ ...form, candidateId: e.target.value })} required>
                <option value="">Select candidate</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName} ({c.email})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Template</label>
              <select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })} required>
                <option value="">Select template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Position (optional)</label>
              <select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                <option value="">— None —</option>
                {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Assignment notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" type="submit">Assign scenario</button>
        </form>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Scenario</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => {
                  const candidate = a.candidate as { fullName: string };
                  const sv = a.scenarioVersion as { version: string; template: { title: string } };
                  const status = a.status as string;
                  return (
                    <tr key={a.id as string}>
                      <td>{candidate.fullName}</td>
                      <td>{sv.template.title}</td>
                      <td>v{sv.version}</td>
                      <td><span className="badge badge-muted">{status}</span></td>
                      <td>{new Date(a.createdAt as string).toLocaleDateString()}</td>
                      <td>
                        {status === "COMPLETED" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            onClick={() => allowRetake(a.id as string)}
                          >
                            Allow retake
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
