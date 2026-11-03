import React, { useState } from "react";
import { useAuth } from "../auth.jsx";

const DEMO = [
  { role: "Admin", email: "admin@example.com", password: "Admin@123" },
  { role: "Technician", email: "tech@example.com", password: "Tech@123" },
  { role: "Requester", email: "user@example.com", password: "User@123" },
];

const FEATURES = [
  ["Automatic asset IDs", "Laptops, desktops and more get their ID the moment they are purchased."],
  ["Audit by location", "Verify what you own, site by site, and see what is missing."],
  ["Allocation and handover", "Know who holds what, with a printable handover form."],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-side">
        <div className="login-brand">
          <span className="login-logo" aria-hidden="true" />
          AssetDesk
        </div>
        <div className="login-pitch">
          <h2>Every asset,
            <br />accounted for.</h2>
          <ul>
            {FEATURES.map(([t, d]) => (
              <li key={t}>
                <strong>{t}</strong>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="login-foot">ESDS · IT asset management</div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          <div className="login-brand mobile-only">
            <span className="login-logo" aria-hidden="true" />
            AssetDesk
          </div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to manage your IT assets.</p>

          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username" autoFocus required />
          </label>
          <label>
            Password
            <div className="pw-wrap">
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
              <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="demo-box">
            <span className="muted small">Demo accounts – click to fill in</span>
            <div className="demo-chips">
              {DEMO.map((d) => (
                <button type="button" key={d.role} className="demo-chip" onClick={() => { setEmail(d.email); setPassword(d.password); setError(""); }}>
                  {d.role}
                </button>
              ))}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
