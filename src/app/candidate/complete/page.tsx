export default function CandidateCompletePage() {
  return (
    <>
      <nav className="nav">
        <span className="nav-brand">Practicum Vault</span>
      </nav>
      <div className="container" style={{ marginTop: 80, textAlign: "center" }}>
        <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
          <h1>Assessment submitted</h1>
          <p style={{ color: "var(--text-muted)" }}>
            Your session has been recorded. Results are available to your administrator only.
          </p>
          <a className="btn btn-primary" href="/candidate" style={{ marginTop: 16 }}>
            Back to assessments
          </a>
        </div>
      </div>
    </>
  );
}
