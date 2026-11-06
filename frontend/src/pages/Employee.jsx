import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { fmtTime } from "./Audits.jsx";
import { statusClass } from "./Assets.jsx";
import { OutcomePill } from "./Employees.jsx";

const REASONS = ["Resignation", "Termination", "Retirement", "Transfer", "Contract end", "Other"];

function StartDialog({ person, onClose }) {
  const nav = useNavigate();
  const [reason, setReason] = useState("Resignation");
  const [day, setDay] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const c = await api.startClearance({ person, reason, last_working_day: day || null, notes: notes.trim() || null });
      nav(`/clearances/${c.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ margin: 0 }}>Start exit clearance</h3>
        <div className="muted">A checklist is created with every asset this person holds now. Nothing changes until you complete it.</div>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Last working day <small className="muted">(optional)</small>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label>
          Notes <small className="muted">(optional)</small>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>
            {busy ? "Starting…" : "Start clearance"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Employee() {
  const [sp] = useSearchParams();
  const key = sp.get("key") || "";
  const [p, setP] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setP(null);
    api.employee(key).then(setP).catch((e) => setError(e.message));
  }, [key]);

  if (error) return <div className="alert">{error} <Link to="/employees">Back to search</Link></div>;
  if (!p) return <div className="muted">Loading…</div>;

  const open = p.clearances.find((c) => c.status === "open");
  const today = new Date().toLocaleDateString();

  return (
    <>
      <div className="no-print">
        <div className="page-head">
          <div>
            <Link to="/employees" className="muted">← Employees</Link>
            <h1>
              {p.name} {p.employee_no && <span className="pill in-stock">ID {p.employee_no}</span>}
            </h1>
            <span className="muted">
              {[p.department, p.job_title, p.manager && `Manager: ${p.manager}`, p.location, p.email].filter(Boolean).join(" · ") || "No other details recorded"}
            </span>
          </div>
          <div className="actions">
            <button className="btn" disabled={!p.assets.length} onClick={() => window.print()}>
              Print handover form
            </button>
            <button className="btn primary" disabled={!!open} onClick={() => setStarting(true)} title={open ? "A clearance is already in progress" : ""}>
              Start exit clearance
            </button>
          </div>
        </div>

        {open && (
          <div className="flash">
            Exit clearance in progress ({open.counts.total - open.counts.pending} of {open.counts.total} decided) –{" "}
            <Link to={`/clearances/${open.id}`}>continue the checklist</Link>
          </div>
        )}

        <div className="stats stats-3">
          <div className="stat">
            <span>Assets held now</span>
            <strong>{p.assets.length}</strong>
          </div>
          <div className="stat">
            <span>Previously held</span>
            <strong>{p.history.length}</strong>
          </div>
          <div className="stat">
            <span>Exit clearances</span>
            <strong>{p.clearances.length}</strong>
          </div>
        </div>

        <h3>Assets held now</h3>
        <div className="card flush">
          <table>
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Serial number</th>
                <th>Status</th>
                <th>Location</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {p.assets.map((a) => (
                <tr key={a.allocation_id}>
                  <td className="nowrap"><Link to={`/assets/${a.asset_id}`}>{a.asset_tag}</Link></td>
                  <td>{a.name}</td>
                  <td>{a.category}</td>
                  <td>{a.serial_number || "—"}</td>
                  <td><span className={statusClass(a.status)}>{a.status}</span></td>
                  <td>{a.location || "—"}</td>
                  <td className="nowrap">{a.allocated_on}</td>
                </tr>
              ))}
              {p.assets.length === 0 && (
                <tr>
                  <td colSpan="7" className="muted center">This person holds no assets right now</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {p.licenses.length > 0 && (
          <>
            <h3>Software licences</h3>
            <div className="card">
              {p.licenses.map((l) => (
                <div className="overdue-row" key={l.assignment_id}>
                  <Link to={`/licenses/${l.license_id}`}>
                    <strong>{l.name}</strong>
                  </Link>
                  <span className="muted">since {l.assigned_on}{l.renewal_date ? ` · renews ${l.renewal_date}` : ""}</span>
                </div>
              ))}
              <p className="muted small" style={{ margin: "8px 0 0" }}>These seats are freed automatically when an exit clearance is completed.</p>
            </div>
          </>
        )}

        {p.clearances.length > 0 && (
          <>
            <h3>Exit clearances</h3>
            <div className="card">
              {p.clearances.map((c) => (
                <div className="overdue-row" key={c.id}>
                  <Link to={`/clearances/${c.id}`}><strong>Clearance #{c.id}</strong></Link>
                  <span className="muted">{c.reason} · {fmtTime(c.created_at)}</span>
                  <OutcomePill c={c} />
                </div>
              ))}
            </div>
          </>
        )}

        {p.history.length > 0 && (
          <>
            <h3>Previously held</h3>
            <div className="card flush">
              <table>
                <thead>
                  <tr>
                    <th>Asset ID</th>
                    <th>Name</th>
                    <th>Serial number</th>
                    <th>Held from</th>
                    <th>Returned</th>
                    <th>Returned as</th>
                  </tr>
                </thead>
                <tbody>
                  {p.history.map((a) => (
                    <tr key={a.allocation_id}>
                      <td className="nowrap"><Link to={`/assets/${a.asset_id}`}>{a.asset_tag}</Link></td>
                      <td>{a.name}</td>
                      <td>{a.serial_number || "—"}</td>
                      <td className="nowrap">{a.allocated_on}</td>
                      <td className="nowrap">{a.returned_on}</td>
                      <td>{a.return_status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="print-only">
        <h1>Asset handover form</h1>
        <p>
          <strong>Employee:</strong> {p.name}
          {p.employee_no ? ` (ID ${p.employee_no})` : ""}
          <br />
          {p.department && (<><strong>Department:</strong> {p.department}<br /></>)}
          <strong>Date:</strong> {today}
        </p>
        <table>
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Asset</th>
              <th>Serial number</th>
              <th>Allocated on</th>
            </tr>
          </thead>
          <tbody>
            {p.assets.map((a) => (
              <tr key={a.allocation_id}>
                <td>{a.asset_tag}</td>
                <td>{a.name}</td>
                <td>{a.serial_number || "—"}</td>
                <td className="nowrap">{a.allocated_on}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 16 }}>
          I acknowledge that I hold the assets listed above and will return them in good condition when asked or when I leave the organisation.
        </p>
        <div className="signatures">
          <div>Employee signature: ______________________</div>
          <div>IT representative: ______________________</div>
        </div>
      </div>

      {starting && <StartDialog person={p.key} onClose={() => setStarting(false)} />}
    </>
  );
}
