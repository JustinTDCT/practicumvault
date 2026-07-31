"use client";

import { AdminNav } from "@/components/admin-nav";
import { useEffect, useState } from "react";

export default function PositionsPage() {
  const [positions, setPositions] = useState<Array<{ id: string; name: string; description: string; enabled: boolean }>>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/positions");
    setPositions((await res.json()).positions);
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setName("");
    setDescription("");
    load();
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Positions</h1>
          <p>Define roles such as Tier 1, Tier 2, or Help Desk.</p>
        </div>
        <form className="card" onSubmit={create} style={{ marginBottom: 24 }}>
          <div className="grid-2">
            <div className="form-group">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" type="submit">Add position</button>
        </form>
        <div className="card">
          <table>
            <thead><tr><th>Name</th><th>Description</th></tr></thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.description || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
