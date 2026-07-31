"use client";

import { AdminNav } from "@/components/admin-nav";
import { StringListEditor } from "@/components/string-list-editor";
import { ScenarioTemplateContent, validateTemplateContent } from "@/lib/templates/schema";
import { getNextObjectiveId, reindexObjectives } from "@/lib/templates/objectives";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function TemplateEditorPage() {
  const params = useParams();
  const versionId = params.id as string;
  const [content, setContent] = useState<ScenarioTemplateContent | null>(null);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(45);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [attemptCount, setAttemptCount] = useState(0);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/templates");
      const data = await res.json();
      for (const t of data.templates) {
        const v = t.versions.find((ver: { id: string }) => ver.id === versionId);
        if (v) {
          setContent(validateTemplateContent(v.content));
          setTimeLimitMinutes(v.timeLimitMinutes);
          setTitle(t.title);
          setStatus(v.status);
          setVersion(v.version);
          setAttemptCount(v._count?.attempts ?? 0);
          return;
        }
      }
    }
    load();
  }, [versionId]);

  async function publish() {
    setMessage("");
    const res = await fetch(`/api/admin/templates/${versionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Publish failed");
      return;
    }
    setStatus("PUBLISHED");
    setMessage("Published — available to assign");
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setMessage("");
    const cleaned = {
      ...content,
      environment: {
        ...content.environment,
        hiddenFacts: content.environment.hiddenFacts.map((f) => f.trim()).filter(Boolean),
        redHerrings: content.environment.redHerrings.map((f) => f.trim()).filter(Boolean),
      },
    };
    const res = await fetch("/api/admin/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, content: cleaned, timeLimitMinutes, title }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error);
      return;
    }
    setContent(cleaned);
    setMessage(data.warning ? `Saved. ${data.warning}` : "Saved");
  }

  if (!content) {
    return (<><AdminNav /><div className="container">Loading...</div></>);
  }

  const updateMeta = (field: string, value: string) =>
    setContent({ ...content, metadata: { ...content.metadata, [field]: value } });

  const updateStarting = (field: string, value: string) =>
    setContent({ ...content, startingSituation: { ...content.startingSituation, [field]: value } });

  const updateEnv = (field: string, value: string | string[]) =>
    setContent({ ...content, environment: { ...content.environment, [field]: value } });

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>{title} — v{version}</h1>
          <p>
            Status: <span className="badge badge-muted">{status}</span>
            {attemptCount > 0 && (
              <span style={{ marginLeft: 8, color: "var(--warning)" }}>
                {attemptCount} assessment(s) on record — edits affect new runs only
              </span>
            )}
          </p>
        </div>

        {message && <p className={message.startsWith("Saved") || message.includes("Published") ? "success" : "error"}>{message}</p>}

        <div className="page-toolbar">
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving || status === "DISABLED"}>
            {saving ? "Saving…" : "Save"}
          </button>
          {status !== "DISABLED" && (
            <button className="btn btn-secondary" type="button" onClick={publish}>
              Publish
            </button>
          )}
          <Link className="btn btn-secondary" href="/admin/templates">Back to templates</Link>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Metadata</h3>
          <div className="grid-2">
            <div className="form-group">
              <label>Title</label>
              <input value={content.metadata.title} onChange={(e) => updateMeta("title", e.target.value)} disabled={status === "DISABLED"} />
            </div>
            <div className="form-group">
              <label>Skill level</label>
              <input value={content.metadata.skillLevel} onChange={(e) => updateMeta("skillLevel", e.target.value)} disabled={status === "DISABLED"} />
            </div>
            <div className="form-group">
              <label>Environment</label>
              <input value={content.metadata.environment} onChange={(e) => updateMeta("environment", e.target.value)} disabled={status === "DISABLED"} />
            </div>
            <div className="form-group">
              <label>Time limit (minutes)</label>
              <input type="number" value={timeLimitMinutes} onChange={(e) => setTimeLimitMinutes(Number(e.target.value))} disabled={status === "DISABLED"} />
            </div>
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={content.metadata.description} onChange={(e) => updateMeta("description", e.target.value)} disabled={status === "DISABLED"} />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Starting situation</h3>
          <div className="grid-2">
            <div className="form-group">
              <label>Ticket subject</label>
              <input value={content.startingSituation.ticketSubject} onChange={(e) => updateStarting("ticketSubject", e.target.value)} disabled={status === "DISABLED"} />
            </div>
            <div className="form-group">
              <label>Ticket user</label>
              <input value={content.startingSituation.ticketUser} onChange={(e) => updateStarting("ticketUser", e.target.value)} disabled={status === "DISABLED"} />
            </div>
          </div>
          <div className="form-group">
            <label>Ticket body</label>
            <textarea value={content.startingSituation.ticketBody} onChange={(e) => updateStarting("ticketBody", e.target.value)} disabled={status === "DISABLED"} />
          </div>
          <div className="form-group">
            <label>Candidate instructions</label>
            <textarea value={content.startingSituation.candidateInstructions} onChange={(e) => updateStarting("candidateInstructions", e.target.value)} disabled={status === "DISABLED"} />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Hidden environment</h3>
          <div className="form-group">
            <label>Root cause (hidden)</label>
            <textarea value={content.environment.rootCause} onChange={(e) => updateEnv("rootCause", e.target.value)} disabled={status === "DISABLED"} />
          </div>
          <StringListEditor
            label="Hidden facts"
            description="Ground truth the simulation uses for command output (IPs, DNS servers, hostnames, etc.). Never shown directly to the candidate."
            items={content.environment.hiddenFacts}
            onChange={(hiddenFacts) => updateEnv("hiddenFacts", hiddenFacts)}
            placeholder="e.g. Client DNS servers: 192.168.1.1, 8.8.8.8"
            disabled={status === "DISABLED"}
            addLabel="Add fact"
            itemLabel="Fact"
          />
          <StringListEditor
            label="Red herrings"
            description="Plausible distractors — may appear in dead-end paths or misleading output, but are not the root cause."
            items={content.environment.redHerrings}
            onChange={(redHerrings) => updateEnv("redHerrings", redHerrings)}
            placeholder="e.g. Corporate proxy was updated last week — other users unaffected"
            disabled={status === "DISABLED"}
            addLabel="Add red herring"
            itemLabel="Red herring"
          />
          <div className="form-group">
            <label>Architecture notes</label>
            <textarea value={content.environment.architectureNotes} onChange={(e) => updateEnv("architectureNotes", e.target.value)} disabled={status === "DISABLED"} />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Objectives</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 0 }}>
            Define what the candidate must accomplish — from a single objective to 20 or more. Each is evaluated against the transcript on submit.
          </p>
          {content.objectives.map((objective, i) => (
            <div key={objective.id} className="card-section" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "var(--text-faint)", fontSize: "0.8125rem", fontWeight: 600 }}>
                  Objective {objective.id}
                </span>
                {status !== "DISABLED" && content.objectives.length > 1 && (
                  <button
                    className="btn btn-danger btn-sm"
                    type="button"
                    onClick={() => {
                      setContent({
                        ...content,
                        objectives: reindexObjectives(content.objectives.filter((_, idx) => idx !== i)),
                      });
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="form-group">
                <label>Name</label>
                <input
                  value={objective.name}
                  onChange={(e) => {
                    const objectives = [...content.objectives];
                    objectives[i] = { ...objective, name: e.target.value };
                    setContent({ ...content, objectives });
                  }}
                  disabled={status === "DISABLED"}
                />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input
                  value={objective.description}
                  onChange={(e) => {
                    const objectives = [...content.objectives];
                    objectives[i] = { ...objective, description: e.target.value };
                    setContent({ ...content, objectives });
                  }}
                  disabled={status === "DISABLED"}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Completion criteria</label>
                <textarea
                  value={objective.passCriteria}
                  onChange={(e) => {
                    const objectives = [...content.objectives];
                    objectives[i] = { ...objective, passCriteria: e.target.value };
                    setContent({ ...content, objectives });
                  }}
                  disabled={status === "DISABLED"}
                />
              </div>
            </div>
          ))}
          {status !== "DISABLED" && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() =>
                setContent({
                  ...content,
                  objectives: [
                    ...content.objectives,
                    {
                      id: getNextObjectiveId(content.objectives),
                      name: "",
                      description: "",
                      passCriteria: "",
                      requiredEvidence: [],
                    },
                  ],
                })
              }
            >
              Add objective
            </button>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Scoring rubric</h3>
          {content.scoringRubric.categories.map((cat, i) => (
            <div key={i} className="grid-2" style={{ marginBottom: 8 }}>
              <input
                value={cat.name}
                onChange={(e) => {
                  const categories = [...content.scoringRubric.categories];
                  categories[i] = { ...cat, name: e.target.value };
                  setContent({ ...content, scoringRubric: { ...content.scoringRubric, categories } });
                }}
                disabled={status === "DISABLED"}
              />
              <input
                type="number"
                value={cat.weight}
                onChange={(e) => {
                  const categories = [...content.scoringRubric.categories];
                  categories[i] = { ...cat, weight: Number(e.target.value) };
                  setContent({ ...content, scoringRubric: { ...content.scoringRubric, categories } });
                }}
                disabled={status === "DISABLED"}
              />
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Actions</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Predefined diagnostic actions and their results. The AI maps candidate requests to these.
          </p>
          {content.actions.map((action, i) => (
            <div key={`${action.id}-${i}`} style={{ marginBottom: 12, padding: 12, background: "var(--surface-2)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Action {i + 1}</span>
                {status !== "DISABLED" && (
                  <button
                    className="btn btn-danger"
                    type="button"
                    style={{ padding: "4px 10px", fontSize: 13 }}
                    onClick={() => {
                      setContent({
                        ...content,
                        actions: content.actions.filter((_, idx) => idx !== i),
                      });
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid-2">
                <input
                  placeholder="Action ID"
                  value={action.id}
                  onChange={(e) => {
                    const actions = [...content.actions];
                    actions[i] = { ...action, id: e.target.value };
                    setContent({ ...content, actions });
                  }}
                  disabled={status === "DISABLED"}
                />
                <input
                  placeholder="Label"
                  value={action.label}
                  onChange={(e) => {
                    const actions = [...content.actions];
                    actions[i] = { ...action, label: e.target.value };
                    setContent({ ...content, actions });
                  }}
                  disabled={status === "DISABLED"}
                />
              </div>
              <textarea
                placeholder="Predefined result"
                value={action.result}
                onChange={(e) => {
                  const actions = [...content.actions];
                  actions[i] = { ...action, result: e.target.value };
                  setContent({ ...content, actions });
                }}
                disabled={status === "DISABLED"}
                style={{ marginTop: 8 }}
              />
            </div>
          ))}
          {status !== "DISABLED" && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() =>
                setContent({
                  ...content,
                  actions: [
                    ...content.actions,
                    {
                      id: `action-${content.actions.length + 1}`,
                      label: "",
                      triggers: [],
                      result: "",
                      category: "diagnostic",
                      requirements: {
                        requireTargetSystem: false,
                        requireMethodOrTool: false,
                        requiredParameters: [],
                        allowedTargets: [],
                        allowedMethods: [],
                      },
                    },
                  ],
                })
              }
            >
              Add action
            </button>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Hints</h3>
          {content.hints.map((hint, i) => (
            <div
              key={i}
              style={{
                marginBottom: 8,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Hint level {hint.level}</span>
                {status !== "DISABLED" && (
                  <button
                    className="btn btn-danger"
                    type="button"
                    style={{ padding: "4px 10px", fontSize: 13 }}
                    onClick={() => {
                      const hints = content.hints
                        .filter((_, idx) => idx !== i)
                        .map((h, idx) => ({ ...h, level: idx + 1 }));
                      setContent({ ...content, hints });
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid-2">
                <input
                  placeholder="Hint text"
                  value={hint.text}
                  onChange={(e) => {
                    const hints = [...content.hints];
                    hints[i] = { ...hint, text: e.target.value };
                    setContent({ ...content, hints });
                  }}
                  disabled={status === "DISABLED"}
                />
                <input
                  type="number"
                  placeholder="Penalty"
                  value={hint.penalty}
                  onChange={(e) => {
                    const hints = [...content.hints];
                    hints[i] = { ...hint, penalty: Number(e.target.value) };
                    setContent({ ...content, hints });
                  }}
                  disabled={status === "DISABLED"}
                />
              </div>
            </div>
          ))}
          {status !== "DISABLED" && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() =>
                setContent({
                  ...content,
                  hints: [...content.hints, { level: content.hints.length + 1, text: "", penalty: 5 }],
                })
              }
            >
              Add hint
            </button>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Completion & AI instructions</h3>
          <div className="form-group">
            <label>Completion conditions</label>
            <textarea
              value={content.completionConditions}
              onChange={(e) => setContent({ ...content, completionConditions: e.target.value })}
              disabled={status === "DISABLED"}
            />
          </div>
          <div className="form-group">
            <label>Additional AI instructions</label>
            <textarea
              value={content.aiInstructions}
              onChange={(e) => setContent({ ...content, aiInstructions: e.target.value })}
              disabled={status === "DISABLED"}
            />
          </div>
        </div>

      </div>
    </>
  );
}
