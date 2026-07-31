"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName, fullName, email, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Setup failed");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="container" style={{ maxWidth: 480, marginTop: 80 }}>
      <div className="page-header">
        <h1>Welcome to Practicum Vault</h1>
        <p>Create your organization and primary administrator account.</p>
      </div>
      <form className="card" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Organization name</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Your full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Admin email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Setting up..." : "Complete setup"}
        </button>
      </form>
    </div>
  );
}
