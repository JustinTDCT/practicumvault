"use client";

import { AdminNav } from "@/components/admin-nav";
import Link from "next/link";
import { useEffect, useState } from "react";

interface TemplateVersion {
  id: string;
  version: string;
  status: string;
  timeLimitMinutes: number;
  _count?: { attempts: number; assignments: number };
}

interface Template {
  id: string;
  slug: string;
  title: string;
  description: string;
  enabled: boolean;
  versions: TemplateVersion[];
  deletion?: {
    canDelete: boolean;
    reason: string | null;
    completedAttempts: number;
    activeAssignments: number;
  };
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(45);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/admin/templates");
    setTemplates((await res.json()).templates);
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const res = await fetch("/api/admin/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, title, timeLimitMinutes }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setSlug("");
    setTitle("");
    setMessage("Template created as draft v1.0");
    load();
  }

  async function publish(versionId: string) {
    setMessage("");
    const res = await fetch(`/api/admin/templates/${versionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setError("");
    setMessage("Template published — available to assign");
    load();
  }

  async function deleteTemplate(template: Template) {
    if (!template.deletion?.canDelete) {
      alert(template.deletion?.reason ?? "This template cannot be deleted.");
      return;
    }
    if (!confirm(`Delete template "${template.title}" and all its versions? Aborted assignments will be removed. This cannot be undone.`)) {
      return;
    }
    setMessage("");
    const res = await fetch("/api/admin/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setError("");
    setMessage("Template deleted");
    load();
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Scenario Templates</h1>
          <p>Create → edit → publish → assign. Delete is blocked only by submitted reports or active assignments.</p>
        </div>

        <form className="card" onSubmit={create} style={{ marginBottom: 24 }}>
          <h3>Create template</h3>
          <div className="grid-2">
            <div className="form-group">
              <label>Slug</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="hosts-hd01" required />
            </div>
            <div className="form-group">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Time limit (minutes)</label>
              <input type="number" value={timeLimitMinutes} onChange={(e) => setTimeLimitMinutes(Number(e.target.value))} min={5} />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="btn btn-primary" type="submit">Create</button>
        </form>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Versions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr><td colSpan={4}>No templates yet — create one above.</td></tr>
              )}
              {templates.map((t) => {
                const canDelete = t.deletion?.canDelete ?? false;
                const deleteTitle = canDelete
                  ? "Delete entire template"
                  : (t.deletion?.reason ?? "Cannot delete this template");
                return (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.slug}</td>
                    <td>
                      {t.versions.map((v) => (
                        <span key={v.id} className="badge badge-muted" style={{ marginRight: 4, marginBottom: 4, display: "inline-block" }}>
                          v{v.version} ({v.status})
                          {(v._count?.attempts ?? 0) > 0 && " · has attempts"}
                        </span>
                      ))}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {t.versions.map((v) => (
                          <div key={v.id} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 13, minWidth: 48 }}>v{v.version}</span>
                            <Link className="btn btn-secondary btn-sm" href={`/admin/templates/${v.id}`}>
                              Edit
                            </Link>
                            {v.status === "DRAFT" && (
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => publish(v.id)}>
                                Publish
                              </button>
                            )}
                            {v.status === "PUBLISHED" && (
                              <span className="badge badge-success">Published</span>
                            )}
                          </div>
                        ))}
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          onClick={() => deleteTemplate(t)}
                          disabled={!canDelete}
                          title={deleteTitle}
                          style={{ alignSelf: "flex-start", marginTop: 4 }}
                        >
                          Delete template
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
