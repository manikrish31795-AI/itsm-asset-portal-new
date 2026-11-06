import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtTime } from "./Audits.jsx";
import { RenewalPill, SeatBar, money } from "./Licenses.jsx";
import { profileLink } from "./Employees.jsx";

const personKey = (a) => (a.employee_no ? `e:${a.employee_no.trim().replace(/\s+/g, " ").toLowerCase()}` : `n:${a.assignee_name.trim().replace(/\s+/g, " ").toLowerCase()}`);

/* ------------------------------------------------------------------ give a seat */
function AssignDialog({ lic, onClose, onDone }) {
  const [mode, setMode] = useState("user");
  const [name, setName] = useState("");
  const [emp, setEmp] = useState("");
  const [found, setFound] = useState([]);
  const [assetQ, setAssetQ] = useState("");
  const [assets, setAssets] = useState([]);
  const [asset, setAsset] = useState(null);
  const [on, setOn] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // suggestions while typing a name or Employee ID
  useEffect(() => {
    const term = (emp.trim() || name.trim());
    if (mode !== "user" || term.length < 2) return setFound([]);
    const t = setTimeout(() => api.employees({ q: term, limit: 6 }).then((d) => setFound(d.items)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [name, emp, mode]);
  useEffect(() => {
    if (mode !== "asset" || assetQ.trim().length < 2) return setAssets([]);
    const t = setTimeout(() => api.assets({ q: assetQ.trim(), page_size: 8 }).then((d) => setAssets(d.items)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [assetQ, mode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { kind: mode, assigned_on: on || null, notes: notes.trim() || null };
      if (mode === "asset") body.asset_id = asset?.id;
      else Object.assign(body, { assignee_name: name, employee_no: emp || null });
      onDone(await api.assignLicense(lic.id, body));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ margin: 0 }}>Give a seat of {lic.name}</h3>
        <div className="muted">{lic.available} of {lic.seats} seats free.</div>
        <div className="seg-toggle">
          <button type="button" className={mode === "user" ? "on" : ""} onClick={() => setMode("user")}>A person</button>
          <button type="button" className={mode === "asset" ? "on" : ""} onClick={() => setMode("asset")}>A device (asset)</button>
        </div>

        {mode === "user" ? (
          <>
            <label>
              Employee ID
              <input value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="e.g. 104522" autoFocus autoComplete="off" />
            </label>
            <label>
              Name *
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type to search employees, or enter a new name" autoComplete="off" />
            </label>
            {found.length > 0 && (
              <div className="picker">
                {found.map((p) => (
                  <button type="button" key={p.key} className="pick-row" onClick={() => { setName(p.name); setEmp(p.employee_no || ""); setFound([]); }}>
                    <strong>{p.name}</strong>
                    <span className="muted small">{p.employee_no ? `ID ${p.employee_no}` : "no Employee ID"}{p.department ? ` · ${p.department}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              Find the asset
              <input value={assetQ} onChange={(e) => { setAssetQ(e.target.value); setAsset(null); }} placeholder="Asset ID, name, serial number or hostname" autoFocus autoComplete="off" />
            </label>
            {asset ? (
              <div className="flash" style={{ margin: 0 }}>
                Selected: <strong>{asset.asset_tag}</strong> · {asset.name}
              </div>
            ) : (
              assets.length > 0 && (
                <div className="picker">
                  {assets.map((a) => (
                    <button type="button" key={a.id} className="pick-row" onClick={() => setAsset(a)}>
                      <strong>{a.asset_tag}</strong>
                      <span className="muted small">{a.name}{a.assigned_to?.full_name || a.assigned_username ? ` · ${a.assigned_to?.full_name || a.assigned_username}` : ""}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </>
        )}
        <label>
          Assigned on <small className="muted">(optional, default today)</small>
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </label>
        <label>
          Notes <small className="muted">(optional)</small>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy || (mode === "asset" ? !asset : !name.trim())}>
            {busy ? "Assigning…" : "Assign seat"}
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function LicenseDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [lic, setLic] = useState(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [checked, setChecked] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.license(id).then(setLic).catch((e) => setError(e.message));
  }, [id]);

  if (error && !lic) return <div className="alert">{error} <Link to="/licenses">Back to licences</Link></div>;
  if (!lic) return <div className="muted">Loading…</div>;

  const ids = Object.keys(checked).filter((k) => checked[k]).map(Number);
  const release = async (list) => {
    if (!list.length) return;
    setError("");
    try {
      setLic(await api.releaseLicense(id, { assignment_ids: list }));
      setChecked({});
      setFlash(`${list.length} seat${list.length === 1 ? "" : "s"} released`);
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${lic.name}” and its seat history? Use Retired status instead if you only want to stop tracking it.`)) return;
    try {
      await api.deleteLicense(id);
      nav("/licenses");
    } catch (e) {
      setError(e.message);
    }
  };
  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(lic.license_key);
      setCopied(true);
    } catch {}
  };
  const canAssign = lic.status === "active" && lic.available > 0 && lic.state !== "expired";
  const whyNot = lic.status !== "active" ? "This licence is retired" : lic.state === "expired" ? "This licence has expired – update the renewal date" : lic.available === 0 ? "All seats are in use" : "";

  const who = (a) =>
    a.kind === "asset" ? (
      <Link to={`/assets/${a.asset_id}`}>{a.assignee_name}</Link>
    ) : a.employee_no ? (
      <Link to={profileLink(personKey(a))}>{a.assignee_name}</Link>
    ) : (
      a.assignee_name
    );

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/licenses" className="muted">← Licences</Link>
          <h1>
            {lic.name} {lic.status === "retired" && <span className="pill retired">Retired</span>}
          </h1>
          <span className="muted">{[lic.publisher, lic.license_type].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={!canAssign} title={whyNot} onClick={() => setAssigning(true)}>
            Assign a seat
          </button>
          <Link className="btn" to={`/licenses/${id}/edit`}>Edit</Link>
          {isAdmin && <button className="btn danger" onClick={remove}>Delete</button>}
        </div>
      </div>
      {flash && <div className="flash">{flash}</div>}
      {error && <div className="alert">{error}</div>}
      {!canAssign && whyNot && lic.status === "active" && <div className={lic.state === "expired" ? "alert" : "flash warnbox"}>{whyNot}.</div>}

      <div className="grid2">
        <div className="card">
          <h3>Seats</h3>
          <div className="seat-big">
            <strong>{lic.used}</strong> <span className="muted">of {lic.seats} in use</span>
            <span className="muted"> · {lic.available} free</span>
          </div>
          <SeatBar used={lic.used} seats={lic.seats} />
          <h3 style={{ marginTop: 22 }}>Licence key</h3>
          {lic.has_key ? (
            <div className="key-row">
              <code className="key">{showKey ? lic.license_key : lic.key_hint}</code>
              <button className="btn" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
              <button className="btn" onClick={copyKey}>{copied ? "Copied ✓" : "Copy"}</button>
            </div>
          ) : (
            <span className="muted">No key recorded</span>
          )}
        </div>
        <div className="card">
          <h3>Renewal & purchase</h3>
          <dl className="details">
            <dt>Renewal date</dt>
            <dd>
              {lic.renewal_date || "Never expires"} <RenewalPill state={lic.state} days={lic.days_left} />
            </dd>
            <dt>Purchased</dt>
            <dd>{lic.purchase_date || "—"}</dd>
            <dt>Cost</dt>
            <dd>{money(lic.purchase_cost)}</dd>
            <dt>Supplier</dt>
            <dd>{lic.vendor || "—"}</dd>
            <dt>Order no.</dt>
            <dd>{lic.order_number || "—"}</dd>
            {lic.notes && (<><dt>Notes</dt><dd>{lic.notes}</dd></>)}
          </dl>
        </div>
      </div>

      <div className="bulk-bar">
        <h3 style={{ margin: 0 }}>Who is using it ({lic.assignments.length})</h3>
        <div className="actions">
          <button className="btn" disabled={!ids.length} onClick={() => release(ids)}>
            Release {ids.length || ""} selected
          </button>
        </div>
      </div>
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" aria-label="Select all" checked={lic.assignments.length > 0 && ids.length === lic.assignments.length}
                  onChange={(e) => setChecked(e.target.checked ? Object.fromEntries(lic.assignments.map((a) => [a.id, true])) : {})} />
              </th>
              <th>Person / device</th>
              <th>Employee ID</th>
              <th>Since</th>
              <th>Assigned by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lic.assignments.map((a) => (
              <tr key={a.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${a.assignee_name}`} checked={!!checked[a.id]} onChange={(e) => setChecked((c) => ({ ...c, [a.id]: e.target.checked }))} />
                </td>
                <td>
                  {who(a)} <span className="pill retired">{a.kind === "asset" ? "Device" : "Person"}</span>
                  {a.notes && <div className="muted small">“{a.notes}”</div>}
                </td>
                <td>{a.employee_no || "—"}</td>
                <td className="nowrap">{a.assigned_on}</td>
                <td>{a.assigned_by || "—"}</td>
                <td>
                  <button className="btn" onClick={() => release([a.id])}>Release</button>
                </td>
              </tr>
            ))}
            {lic.assignments.length === 0 && (
              <tr>
                <td colSpan="6" className="muted center">No seats in use yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {lic.history.length > 0 && (
        <>
          <h3>Seat history</h3>
          <div className="card flush">
            <table>
              <thead>
                <tr>
                  <th>Person / device</th>
                  <th>From</th>
                  <th>Released</th>
                  <th>Released by</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {lic.history.map((a) => (
                  <tr key={a.id}>
                    <td>{who(a)}</td>
                    <td className="nowrap">{a.assigned_on}</td>
                    <td className="nowrap">{a.released_on}</td>
                    <td>{a.released_by || "—"}</td>
                    <td className="muted small">{a.release_notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {assigning && (
        <AssignDialog lic={lic} onClose={() => setAssigning(false)} onDone={(l) => { setAssigning(false); setLic(l); setFlash("Seat assigned"); }} />
      )}
    </>
  );
}
