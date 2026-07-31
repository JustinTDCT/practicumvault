"use client";

import { AdminNav } from "@/components/admin-nav";
import { useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  enabled: boolean;
  notes: string;
  position?: { id: string; name: string } | null;
}

interface Position {
  id: string;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    password: "",
    role: "CANDIDATE",
    positionId: "",
    notes: "",
  });
  const [error, setError] = useState("");

  async function load() {
    const [usersRes, posRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/positions"),
    ]);
    setUsers((await usersRes.json()).users);
    setPositions((await posRes.json()).positions);
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setForm({ email: "", fullName: "", password: "", role: "CANDIDATE", positionId: "", notes: "" });
    load();
  }

  async function resetPassword(id: string) {
    const password = prompt("New password (min 8 characters):");
    if (!password || password.length < 8) return;
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    alert("Password updated");
  }

  async function updateNotes(id: string, notes: string) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
  }

  return (
    <>
      <AdminNav />
      <div className="container">
        <div className="page-header">
          <h1>Users</h1>
          <p>Create and manage admin and candidate accounts.</p>
        </div>

        <form className="card" onSubmit={createUser} style={{ marginBottom: 24 }}>
          <h3>Create user</h3>
          <div className="grid-2">
            <div className="form-group">
              <label>Full name</label>
              <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="CANDIDATE">Candidate</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="form-group">
              <label>Position</label>
              <select value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
                <option value="">— None —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Candidate notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" type="submit">Create user</button>
        </form>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Position</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td>{u.email}</td>
                  <td><span className="badge badge-muted">{u.role}</span></td>
                  <td>{u.position?.name ?? "—"}</td>
                  <td>
                    <textarea
                      defaultValue={u.notes}
                      onBlur={(e) => updateNotes(u.id, e.target.value)}
                      style={{ minHeight: 60, width: "100%" }}
                    />
                  </td>
                  <td>
                    <button className="btn btn-secondary" type="button" onClick={() => resetPassword(u.id)}>
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
