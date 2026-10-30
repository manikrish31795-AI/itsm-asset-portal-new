import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";

const NO_LOCATION = "__none__";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// the server stores UTC without a "Z"
export const fmtTime = (s) =>
  s ? new Date(s.endsWith("Z") ? s : s + "Z").toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

export const RESULT_LABEL = { pending: "Not checked", found: "Found", missing: "Missing", moved: "Found elsewhere" };

/** Stacked bar: found / found elsewhere / missing / not yet checked. */
export function Progress({ counts }) {
  const total = counts.total || 1;
  const w = (n) => `${(n / total) * 100}%`;
  return (
    <div
      className="progress"
      role="img"
      aria-label={`${counts.audited} of ${counts.total} checked`}
      title={`${counts.found} found · ${counts.moved} found elsewhere · ${counts.missing} missing · ${counts.pending} not checked`}
    >
      <span className="seg found" style={{ width: w(counts.found) }} />
      <span className="seg moved" style={{ width: w(counts.moved) }} />
      <span className="seg missing" style={{ width: w(counts.missing) }} />
    </div>
  );
}

export function ResultPill({ item }) {
  return (
    <span className="result-cell">
      <span className={`pill res-${item.result}`}>
        {item.result === "moved" ? `Found at ${item.found_location}` : RESULT_LABEL[item.result]}
      </span>
      {item.condition && item.condition !== "Good" && <span className="pill res-cond">{item.condition}</span>}
      {item.unexpected && (
        <span className="pill res-unexpected" title="This asset was not on the audit's original list">
          Not on list
        </span>
      )}
    </span>
  );
}

export const scopeText = (a) => {
  const locs = a.locations.length ? a.locations.map((l) => (l === NO_LOCATION ? "No location" : l)).join(", ") : "All locations";
  return a.categories.length ? `${locs} · ${a.categories.join(", ")}` : locs;
};

/* ------------------------------------------------------------------ new audit form */
function NewAudit({ onCancel }) {
  const nav = useNavigate();
  const [meta, setMeta] = useState({ categories: [], locations: [], no_location_count: 0 });
  const month = new Date().toLocaleString("en", { month: "short", year: "numeric" });
  const [name, setName] = useState(`Asset audit – ${month}`);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [due, setDue] = useState("");
  const [inactive, setInactive] = useState(false);
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.assetMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  // live "how many assets will this cover" number
  useEffect(() => {
    setCount(null);
    const t = setTimeout(() => {
      api.auditPreview({ locations, categories, include_inactive: inactive }).then((r) => setCount(r.count)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [locations, categories, inactive]);

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const a = await api.createAudit({
        name: name.trim(),
        locations,
        categories,
        include_inactive: inactive,
        due_date: due || null,
        notes: notes.trim() || null,
      });
      nav(`/audits/${a.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Start a new audit</h3>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="form-grid">
        <label>
          Audit name *
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
        </label>
        <label>
          Complete by <small className="muted">(optional)</small>
          <input type="date" value={due} min={localToday()} onChange={(e) => setDue(e.target.value)} />
        </label>

        <div className="span2">
          <div className="field-label">
            Locations to audit <small className="muted">— leave all unticked to include every location</small>
          </div>
          <div className="check-grid">
            {meta.locations.map((l) => (
              <label key={l.name} className="check-chip">
                <input type="checkbox" checked={locations.includes(l.name)} onChange={() => toggle(locations, setLocations, l.name)} />
                {l.name} <span className="muted">({l.count})</span>
              </label>
            ))}
            {meta.no_location_count > 0 && (
              <label className="check-chip">
                <input type="checkbox" checked={locations.includes(NO_LOCATION)} onChange={() => toggle(locations, setLocations, NO_LOCATION)} />
                No location <span className="muted">({meta.no_location_count})</span>
              </label>
            )}
          </div>
        </div>

        <div className="span2">
          <div className="field-label">
            Categories <small className="muted">— leave all unticked to include every category</small>
          </div>
          <div className="check-grid">
            {meta.categories.map((c) => (
              <label key={c} className="check-chip">
                <input type="checkbox" checked={categories.includes(c)} onChange={() => toggle(categories, setCategories, c)} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <label className="check-row span2">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          Also include Retired and Lost assets
        </label>
        <label className="span2">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. year-end physical verification" />
        </label>

        <div className="span2 scope-count" aria-live="polite">
          {count === null ? "Counting…" : count === 0 ? "No assets match these choices." : <><strong>{count}</strong> asset{count === 1 ? "" : "s"} will be included.</>}
        </div>
        {error && <div className="alert span2">{error}</div>}
        <div className="span2">
          <button className="btn primary" disabled={busy || count === 0 || !name.trim()}>
            {busy ? "Starting…" : "Start audit"}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ list */
export default function Audits() {
  const [audits, setAudits] = useState(null);
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.audits({ status }).then(setAudits).catch((e) => setError(e.message));
  }, [status]);

  return (
    <>
      <div className="page-head">
        <h1>Asset audit</h1>
        {!creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New audit
          </button>
        )}
      </div>

      {creating && <NewAudit onCancel={() => setCreating(false)} />}
      {error && <div className="alert">{error}</div>}

      <div className="filters" style={{ gridTemplateColumns: "220px", marginBottom: 14 }}>
        <select aria-label="Show audits" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All audits</option>
          <option value="open">In progress</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Audit</th>
              <th>Scope</th>
              <th>Due</th>
              <th style={{ width: 220 }}>Progress</th>
              <th>Found</th>
              <th>Elsewhere</th>
              <th>Missing</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {audits === null && (
              <tr>
                <td colSpan="8" className="muted center">
                  Loading…
                </td>
              </tr>
            )}
            {audits?.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/audits/${a.id}`}>
                    <strong>{a.name}</strong>
                  </Link>
                  <div className="muted small">
                    {a.created_by} · {fmtTime(a.created_at)}
                  </div>
                </td>
                <td className="small">{scopeText(a)}</td>
                <td className="nowrap">
                  {a.due_date || "—"} {a.is_overdue && <span className="pill lost">Overdue</span>}
                </td>
                <td>
                  <Progress counts={a.counts} />
                  <div className="muted small">
                    {a.counts.audited} of {a.counts.total} checked
                  </div>
                </td>
                <td>{a.counts.found}</td>
                <td>{a.counts.moved}</td>
                <td>{a.counts.missing}</td>
                <td>
                  <span className={`pill ${a.status === "open" ? "in-use" : "retired"}`}>{a.status === "open" ? "In progress" : "Closed"}</span>
                </td>
              </tr>
            ))}
            {audits?.length === 0 && (
              <tr>
                <td colSpan="8" className="muted center">
                  {status === "all" ? "No audits yet. Click “+ New audit” to start one." : "No audits here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
