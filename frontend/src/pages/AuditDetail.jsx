import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Progress, ResultPill, fmtTime, scopeText } from "./Audits.jsx";

const NO_LOCATION = "__none__";
const CONDITIONS = ["Good", "Damaged", "Needs repair"];
const RESULT_FILTERS = [
  ["all", "All assets"],
  ["pending", "Not checked"],
  ["audited", "Checked"],
  ["found", "Found"],
  ["moved", "Found elsewhere"],
  ["missing", "Missing"],
  ["issues", "Needs attention"],
  ["unexpected", "Not on the original list"],
];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ edit one asset's result */
function ItemDialog({ auditId, item, locations, onClose, onSaved }) {
  const [result, setResult] = useState(item.result);
  const [where, setWhere] = useState(item.found_location || "");
  const [condition, setCondition] = useState(item.condition || "");
  const [notes, setNotes] = useState(item.notes || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const checked = result === "found" || result === "moved";

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.updateAuditItem(auditId, item.id, {
        result,
        found_location: result === "moved" ? where.trim() : null,
        condition: checked && condition ? condition : null,
        notes: notes.trim() || null,
      });
      onSaved(`${item.asset_tag} updated`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3 style={{ margin: 0 }}>
          {item.asset_tag} · {item.asset_name}
        </h3>
        <div className="muted">
          Registered at <strong>{item.expected_location || "no location"}</strong>
          {item.expected_holder ? ` · held by ${item.expected_holder}` : ""}
        </div>
        <label>
          Result
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="found">Found where it should be</option>
            <option value="moved">Found somewhere else</option>
            <option value="missing">Missing</option>
            <option value="pending">Not checked</option>
          </select>
        </label>
        {result === "moved" && (
          <label>
            Where was it found? *
            <input list="audit-locations" value={where} onChange={(e) => setWhere(e.target.value)} autoFocus />
            <datalist id="audit-locations">
              {locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
        )}
        {checked && (
          <label>
            Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Not recorded</option>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" maxLength={500} />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ close the audit */
function CloseDialog({ audit, onClose, onClosed }) {
  const c = audit.counts;
  const [pendingAction, setPendingAction] = useState("leave");
  const [applyMoves, setApplyMoves] = useState(c.moved > 0);
  const [markLost, setMarkLost] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const missingTotal = c.missing + (pendingAction === "missing" ? c.pending : 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.closeAudit(audit.id, {
        pending_action: c.pending ? pendingAction : "leave",
        apply_moves: applyMoves,
        mark_missing_lost: markLost,
      });
      onClosed();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ margin: 0 }}>Close this audit</h3>
        <div className="muted">
          {c.found} found · {c.moved} found elsewhere · {c.missing} missing · {c.pending} not checked. Once closed, results
          can't be changed and verified assets get today's date as their “last audited” date.
        </div>

        {c.pending > 0 && (
          <div className="radio-col">
            <strong>{plural(c.pending, "asset")} not checked yet</strong>
            <label className="check-row">
              <input type="radio" name="pending" checked={pendingAction === "leave"} onChange={() => setPendingAction("leave")} />
              Leave them as “not checked” (they will not get an audit date)
            </label>
            <label className="check-row">
              <input type="radio" name="pending" checked={pendingAction === "missing"} onChange={() => setPendingAction("missing")} />
              Mark them as missing
            </label>
          </div>
        )}
        {c.moved > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={applyMoves} onChange={(e) => setApplyMoves(e.target.checked)} />
            Update the location of the {plural(c.moved, "asset")} found elsewhere to where {c.moved === 1 ? "it was" : "they were"} found
          </label>
        )}
        {missingTotal > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={markLost} onChange={(e) => setMarkLost(e.target.checked)} />
            Change the status of the {plural(missingTotal, "missing asset")} to Lost
          </label>
        )}
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>
            {busy ? "Closing…" : "Close audit"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Keep working
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function AuditDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [audit, setAudit] = useState(null);
  const [meta, setMeta] = useState({ categories: [], locations: [] });
  const [filters, setFilters] = useState({ result: "all", q: "", location: "", category: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 50 });
  const [loadingItems, setLoadingItems] = useState(true);
  const [checked, setChecked] = useState({});
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  // scan box
  const [code, setCode] = useState("");
  const [where, setWhere] = useState("");
  const [log, setLog] = useState([]);
  const scanRef = useRef(null);

  const open = audit?.status === "open";
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    api.assetMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    api.audit(id).then(setAudit).catch((e) => setError(e.message));
  }, [id, refreshKey]);

  useEffect(() => {
    setLoadingItems(true);
    const t = setTimeout(() => {
      api
        .auditItems(id, { ...filters, page, page_size: 50 })
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoadingItems(false));
    }, 200);
    return () => clearTimeout(t);
  }, [id, filters, page, refreshKey]);

  useEffect(() => {
    setChecked({});
  }, [filters, page]);

  const setFilter = (k, v) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  if (error && !audit) return <div className="alert">{error}</div>;
  if (!audit) return <div className="muted">Loading…</div>;

  const c = audit.counts;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const pct = c.total ? Math.round((c.audited / c.total) * 100) : 0;
  const locationNames = audit.by_location.filter((l) => l.key !== NO_LOCATION).map((l) => l.name);
  const ids = Object.keys(checked).filter((k) => checked[k]).map(Number);
  const allTicked = data.items.length > 0 && data.items.every((i) => checked[i.id]);

  const act = async (fn, message) => {
    setError("");
    try {
      await fn();
      if (message) setFlash(message);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };
  const quick = (item, result) => act(() => api.updateAuditItem(id, item.id, { result }));
  const bulk = (result, label) =>
    act(async () => {
      await api.bulkAuditItems(id, { item_ids: ids, result });
      setChecked({});
    }, `${plural(ids.length, "asset")} ${label}`);

  const submitScan = async (e) => {
    e.preventDefault();
    const text = code.trim();
    if (!text) return;
    setFlash("");
    const entry = (kind, msg) => setLog((l) => [{ key: Date.now() + Math.random(), kind, msg }, ...l].slice(0, 8));
    try {
      const r = await api.scanAudit(id, { code: text, found_location: where.trim() || null });
      const it = r.item;
      const label = `${it.asset_tag} · ${it.asset_name}`;
      if (r.added) {
        entry("extra", `${label} is not on this audit's list. Added and marked ${it.result === "moved" ? `found at ${it.found_location}` : "found"}.`);
      } else if (r.previous === "found" && it.result === "found") {
        entry("already", `${label} was already marked found.`);
      } else if (it.result === "moved") {
        entry("extra", `${label} found at ${it.found_location} (registered at ${it.expected_location || "no location"}).`);
      } else {
        entry("ok", `${label} verified.`);
      }
      refresh();
    } catch (err) {
      entry("error", err.message);
    }
    setCode("");
    scanRef.current?.focus();
  };

  const remove = async () => {
    if (!window.confirm(`Delete the audit “${audit.name}” and all its results? This cannot be undone.`)) return;
    try {
      await api.deleteAudit(id);
      nav("/audits");
    } catch (e) {
      setError(e.message);
    }
  };

  const tile = (label, value, result, tone) => (
    <button type="button" className={`stat ${tone || ""} ${filters.result === result ? "sel" : ""}`} onClick={() => setFilter("result", result)} title="Show these assets">
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
  const s = audit.close_summary;

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/audits" className="muted">
            ← Audits
          </Link>
          <h1>
            {audit.name}{" "}
            <span className={`pill ${open ? "in-use" : "retired"}`}>{open ? "In progress" : "Closed"}</span>
          </h1>
          <span className="muted">
            {scopeText(audit)}
            {audit.due_date && ` · due ${audit.due_date}`}
            {audit.is_overdue && " (overdue)"} · started by {audit.created_by}, {fmtTime(audit.created_at)}
            {!open && ` · closed by ${audit.closed_by}, ${fmtTime(audit.closed_at)}`}
          </span>
          {audit.notes && <div className="muted small">{audit.notes}</div>}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => api.exportAuditCsv(id).catch((e) => setError(e.message))}>
            Export report (CSV)
          </button>
          {open && (
            <button className="btn primary" onClick={() => setClosing(true)}>
              Close audit
            </button>
          )}
          {isAdmin && (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>

      {flash && <div className="flash">{flash}</div>}
      {error && <div className="alert">{error}</div>}

      <div className="stats stats-6">
        {tile("Assets in audit", c.total, "all")}
        {tile("Checked", c.audited, "audited")}
        {tile("Found", c.found, "found")}
        {tile("Found elsewhere", c.moved, "moved", c.moved ? "warn" : "")}
        {tile("Missing", c.missing, "missing", c.missing ? "danger" : "")}
        {tile("Not checked", c.pending, "pending")}
      </div>

      <div className="card">
        <div className="bulk-bar" style={{ marginBottom: 8 }}>
          <strong>{pct}% checked</strong>
          <span className="muted">
            {c.audited} of {c.total}
            {c.unexpected > 0 && (
              <>
                {" · "}
                <button type="button" className="link-btn" onClick={() => setFilter("result", "unexpected")}>
                  {c.unexpected} not on the original list
                </button>
              </>
            )}
          </span>
        </div>
        <Progress counts={c} />
        {audit.by_location.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <div className="field-label">Progress by location (click to show only that location)</div>
            {audit.by_location.map((l) => (
              <button
                type="button"
                key={l.key}
                className={`loc-row ${filters.location === l.key ? "sel" : ""}`}
                onClick={() => setFilter("location", filters.location === l.key ? "" : l.key)}
              >
                <span>{l.name}</span>
                <Progress counts={{ total: l.total, audited: l.audited, found: l.found, moved: l.moved, missing: l.missing, pending: l.total - l.audited }} />
                <span className="muted small">
                  {l.audited} / {l.total}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {s && (
        <div className="card">
          <h3>Closing summary</h3>
          <div className="summary-grid">
            {[
              ["Verified", s.verified],
              ["Found elsewhere", s.found_elsewhere],
              ["Missing", s.missing],
              ["Not checked", s.not_audited],
              ["Locations updated", s.locations_updated],
              ["Marked Lost", s.marked_lost],
              ["Unchecked → missing", s.unchecked_marked_missing],
              ["Need attention (condition)", s.need_attention],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="muted small">{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <form className="card" onSubmit={submitScan}>
          <h3>Scan or type an asset tag</h3>
          <div className="scan-row">
            <label>
              Asset tag or serial number
              <input
                ref={scanRef}
                className="big"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan a barcode or type, then press Enter"
                autoComplete="off"
                autoFocus
              />
            </label>
            <label>
              Found at <small className="muted">(only if it’s not where it should be)</small>
              <input list="scan-locations" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Same as registered" />
              <datalist id="scan-locations">
                {locationNames.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            <button className="btn primary" disabled={!code.trim()}>
              Mark found
            </button>
          </div>
          {log.length > 0 && (
            <ul className="scan-log" aria-live="polite">
              {log.map((l) => (
                <li key={l.key} className={l.kind}>
                  {l.msg}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      <div className="filters filters-4">
        <input placeholder="Search tag, name, serial, holder…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        <select aria-label="Result" value={filters.result} onChange={(e) => setFilter("result", e.target.value)}>
          {RESULT_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Location" value={filters.location} onChange={(e) => setFilter("location", e.target.value)}>
          <option value="">All locations</option>
          {audit.by_location.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">All categories</option>
          {(audit.categories.length ? audit.categories : meta.categories).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>

      {open && (
        <div className="bulk-bar">
          <span className="muted">{ids.length ? `${ids.length} selected` : "Tick assets to update several at once"}</span>
          <div className="actions">
            <button className="btn ok" disabled={!ids.length} onClick={() => bulk("found", "marked found")}>
              Mark found
            </button>
            <button className="btn bad" disabled={!ids.length} onClick={() => bulk("missing", "marked missing")}>
              Mark missing
            </button>
            <button className="btn" disabled={!ids.length} onClick={() => bulk("pending", "reset to not checked")}>
              Reset
            </button>
          </div>
        </div>
      )}

      <div className="card flush">
        <table>
          <thead>
            <tr>
              {open && (
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allTicked}
                    onChange={(e) => setChecked(e.target.checked ? Object.fromEntries(data.items.map((i) => [i.id, true])) : {})}
                  />
                </th>
              )}
              <th>Tag</th>
              <th>Asset</th>
              <th>Registered at</th>
              <th>Result</th>
              {open && <th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id}>
                {open && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${it.asset_tag}`}
                      checked={!!checked[it.id]}
                      onChange={(e) => setChecked((c0) => ({ ...c0, [it.id]: e.target.checked }))}
                    />
                  </td>
                )}
                <td className="nowrap">
                  <Link to={`/assets/${it.asset_id}`}>{it.asset_tag}</Link>
                </td>
                <td>
                  {it.asset_name}
                  <div className="muted small">
                    {it.category}
                    {it.serial_number ? ` · ${it.serial_number}` : ""}
                    {it.expected_holder ? ` · ${it.expected_holder}` : ""}
                  </div>
                </td>
                <td>{it.expected_location || "—"}</td>
                <td>
                  <ResultPill item={it} />
                  {(it.audited_by || it.notes) && (
                    <div className="muted small">
                      {it.audited_by && `${it.audited_by} · ${fmtTime(it.audited_at)}`}
                      {it.notes && ` · “${it.notes}”`}
                    </div>
                  )}
                </td>
                {open && (
                  <td>
                    <div className="row-actions">
                      {it.result === "pending" ? (
                        <>
                          <button className="btn ok" onClick={() => quick(it, "found")}>
                            Found
                          </button>
                          <button className="btn bad" onClick={() => quick(it, "missing")}>
                            Missing
                          </button>
                        </>
                      ) : (
                        <button className="btn" onClick={() => quick(it, "pending")}>
                          Reset
                        </button>
                      )}
                      <button className="btn" onClick={() => setEditing(it)}>
                        Details
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loadingItems && data.items.length === 0 && (
              <tr>
                <td colSpan={open ? 6 : 4} className="muted center">
                  No assets match these filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">{data.total} assets</span>
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <span>
          Page {page} / {pages}
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>

      {editing && (
        <ItemDialog
          auditId={id}
          item={editing}
          locations={locationNames}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setFlash(msg);
            refresh();
          }}
        />
      )}
      {closing && (
        <CloseDialog
          audit={audit}
          onClose={() => setClosing(false)}
          onClosed={() => {
            setClosing(false);
            setFlash("Audit closed");
            refresh();
          }}
        />
      )}
    </>
  );
}
