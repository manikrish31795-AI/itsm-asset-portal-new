import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const RETURN_STATUSES = ["In Stock", "In Repair", "Retired", "Lost"];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ allocate form */
function AllocateForm({ prefill, onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [who, setWho] = useState(prefill ? (prefill.user_id ? String(prefill.user_id) : "__other__") : "");
  const [name, setName] = useState(prefill && !prefill.user_id ? prefill.name : "");
  const [empNo, setEmpNo] = useState(prefill?.employee_no || "");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.users().then((u) => setUsers(u.filter((x) => x.is_active))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.availableAssets(q).then(setResults).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const toggle = (a) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = a;
      return n;
    });
  const count = Object.keys(picked).length;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!who) return setError("Choose who the assets are for");
    if (who === "__other__" && !name.trim()) return setError("Type the employee's name");
    if (!count) return setError("Select at least one asset");
    const body = {
      asset_ids: Object.keys(picked).map(Number),
      allocated_on: date,
      notes: notes.trim() || null,
      employee_no: empNo.trim() || null,
    };
    if (who === "__other__") body.assignee_name = name.trim();
    else body.user_id = Number(who);
    setBusy(true);
    try {
      const res = await api.allocate(body);
      onDone(`${plural(res.length, "asset")} allocated to ${res[0].assignee_name}`, res[0].person);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="card no-print" onSubmit={submit}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Allocate assets</h3>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      <div className="form-grid">
        <label>
          Allocate to *
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose a person…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
            <option value="__other__">Someone else (not a portal user)…</option>
          </select>
        </label>
        {who === "__other__" ? (
          <label>
            Employee name *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kavya Nair" />
          </label>
        ) : (
          <div />
        )}
        <label>
          Employee no.
          <input value={empNo} onChange={(e) => setEmpNo(e.target.value)} />
        </label>
        <label>
          Allocation date
          <input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <div className="span2">
          <label>
            Assets * <small className="muted">(only assets nobody holds are listed — search by name, tag or serial)</small>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search available assets…" />
          </label>
          {count > 0 && (
            <div className="chips">
              {Object.values(picked).map((a) => (
                <span className="chip" key={a.id}>
                  {a.asset_tag} · {a.name}
                  <button type="button" aria-label={`Remove ${a.asset_tag}`} onClick={() => toggle(a)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="picker">
            {results.length === 0 && <div className="muted center">No available assets match</div>}
            {results.map((a) => (
              <label key={a.id}>
                <input type="checkbox" checked={!!picked[a.id]} onChange={() => toggle(a)} />
                <span>
                  <strong>{a.asset_tag}</strong> · {a.name} <span className="muted">— {a.category}
                  {a.serial_number ? ` · ${a.serial_number}` : ""} · {a.status}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="span2">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. new joiner kit" />
        </label>
        {error && <div className="alert span2">{error}</div>}
        <div className="span2">
          <button className="btn primary" disabled={busy}>
            {busy ? "Allocating…" : count ? `Allocate ${plural(count, "asset")}` : "Allocate"}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ return dialog */
function ReturnDialog({ allocs, onClose, onDone }) {
  const [status, setStatus] = useState("In Stock");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const earliest = allocs.reduce((m, a) => (a.allocated_on > m ? a.allocated_on : m), "");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.returnAssets({
        allocation_ids: allocs.map((a) => a.id),
        return_status: status,
        returned_on: date,
        notes: notes.trim() || null,
      });
      onDone(`${plural(allocs.length, "asset")} returned from ${allocs[0].assignee_name}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop no-print" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ margin: 0 }}>Return {plural(allocs.length, "asset")}</h3>
        <div className="muted">
          {allocs.map((a) => a.asset.asset_tag).join(", ")} from <strong>{allocs[0].assignee_name}</strong>
        </div>
        <label>
          Status after return
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {RETURN_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Return date
          <input type="date" value={date} min={earliest} max={localToday()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. screen cracked" />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Confirm return"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ by-user tab */
function PeopleTab({ refreshKey, focus, onFocusDone, onAllocate, onReturn }) {
  const [q, setQ] = useState("");
  const [onlyWith, setOnlyWith] = useState(true);
  const [people, setPeople] = useState([]);
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState([]);
  const [past, setPast] = useState([]);
  const [checked, setChecked] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .allocationPeople({ q, only_with_assets: onlyWith ? "true" : "false" })
        .then((rows) => {
          setPeople(rows);
          setError("");
          setSel((s) => (s ? rows.find((r) => r.key === s.key) || s : s)); // refresh the selected person's count
        })
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, onlyWith, refreshKey]);

  // one-time jump to the person just allocated to (then forget it, so later clicks are never overridden)
  useEffect(() => {
    if (!focus) return;
    const p = people.find((r) => r.key === focus);
    if (p) {
      setSel(p);
      onFocusDone();
    }
  }, [focus, people]);

  useEffect(() => {
    setChecked({});
    if (!sel) {
      setActive([]);
      setPast([]);
      return;
    }
    api.allocations({ status: "active", person: sel.key, page_size: 200 }).then((d) => setActive(d.items)).catch((e) => setError(e.message));
    api.allocations({ status: "returned", person: sel.key, page_size: 10 }).then((d) => setPast(d.items)).catch(() => {});
  }, [sel?.key, refreshKey]);

  const ticked = active.filter((a) => checked[a.id]);
  const allTicked = active.length > 0 && ticked.length === active.length;

  return (
    <>
      {error && <div className="alert no-print">{error}</div>}
      <div className="alloc-layout no-print">
        <div className="card">
          <input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check-row">
            <input type="checkbox" checked={onlyWith} onChange={(e) => setOnlyWith(e.target.checked)} />
            Only people holding assets
          </label>
          <div className="person-list">
            {people.map((p) => (
              <button
                type="button"
                key={p.key}
                className={`person ${sel?.key === p.key ? "active" : ""}`}
                onClick={() => setSel(p)}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small className="muted">
                    {[p.employee_no, p.email].filter(Boolean).join(" · ") || (p.is_portal_user ? "" : "No portal login")}
                  </small>
                </span>
                <span className="count">{p.active_count}</span>
              </button>
            ))}
            {people.length === 0 && <div className="muted center">Nobody found</div>}
          </div>
        </div>

        <div>
          {!sel && (
            <div className="card muted center">Choose a person from the list to see and manage the assets they hold.</div>
          )}
          {sel && (
            <>
              <div className="card">
                <div className="page-head" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18 }}>{sel.name}</h3>
                    <span className="muted">
                      {[sel.employee_no && `Employee no. ${sel.employee_no}`, sel.email].filter(Boolean).join(" · ")}
                      {!sel.is_portal_user && " (not a portal user)"}
                    </span>
                  </div>
                  <div className="actions">
                    <button className="btn" disabled={!active.length} onClick={() => window.print()}>
                      Print handover form
                    </button>
                    <button className="btn primary" onClick={() => onAllocate(sel)}>
                      + Allocate assets
                    </button>
                  </div>
                </div>

                <div className="bulk-bar">
                  <span className="muted">{plural(active.length, "asset")} currently held</span>
                  <button className="btn danger" disabled={!ticked.length} onClick={() => onReturn(ticked)}>
                    {ticked.length ? `Return selected (${ticked.length})` : "Return selected"}
                  </button>
                </div>

                <div className="card flush" style={{ marginBottom: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={allTicked}
                            onChange={(e) => setChecked(e.target.checked ? Object.fromEntries(active.map((a) => [a.id, true])) : {})}
                          />
                        </th>
                        <th>Tag</th>
                        <th>Asset</th>
                        <th>Category</th>
                        <th>Serial</th>
                        <th>Since</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.asset.asset_tag}`}
                              checked={!!checked[a.id]}
                              onChange={(e) => setChecked((c) => ({ ...c, [a.id]: e.target.checked }))}
                            />
                          </td>
                          <td>
                            <Link to={`/assets/${a.asset.id}`}>{a.asset.asset_tag}</Link>
                          </td>
                          <td>{a.asset.name}</td>
                          <td>{a.asset.category}</td>
                          <td>{a.asset.serial_number || "—"}</td>
                          <td className="nowrap">{a.allocated_on}</td>
                          <td>
                            <button className="btn" onClick={() => onReturn([a])}>
                              Return
                            </button>
                          </td>
                        </tr>
                      ))}
                      {active.length === 0 && (
                        <tr>
                          <td colSpan="7" className="muted center">
                            Holds no assets right now.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {past.length > 0 && (
                <div className="card">
                  <h3>Previously held (latest {past.length})</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Tag</th>
                        <th>Asset</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Returned as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {past.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <Link to={`/assets/${a.asset.id}`}>{a.asset.asset_tag}</Link>
                          </td>
                          <td>{a.asset.name}</td>
                          <td className="nowrap">{a.allocated_on}</td>
                          <td className="nowrap">{a.returned_on}</td>
                          <td>{a.return_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sel && (
        <div className="print-only">
          <h1>Asset handover form</h1>
          <p>
            <strong>Employee:</strong> {sel.name}
            {sel.employee_no ? ` (${sel.employee_no})` : ""}
            <br />
            <strong>Date:</strong> {new Date().toLocaleDateString()}
          </p>
          <table>
            <thead>
              <tr>
                <th>Asset tag</th>
                <th>Asset</th>
                <th>Serial number</th>
                <th>Allocated on</th>
              </tr>
            </thead>
            <tbody>
              {active.map((a) => (
                <tr key={a.id}>
                  <td>{a.asset.asset_tag}</td>
                  <td>{a.asset.name}</td>
                  <td>{a.asset.serial_number || "—"}</td>
                  <td className="nowrap">{a.allocated_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 16 }}>
            I acknowledge that I have received the assets listed above and will return them in good condition when
            asked or when I leave the organisation.
          </p>
          <div className="signatures">
            <div>Employee signature: ______________________</div>
            <div>IT representative: ______________________</div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ history tab */
function HistoryTab({ refreshKey }) {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 20 });
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .allocations({ status, q, page, page_size: 20 })
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [status, q, page, refreshKey]);

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return (
    <div className="no-print">
      <div className="filters" style={{ gridTemplateColumns: "2fr 1fr auto" }}>
        <input
          placeholder="Search person, employee no., asset tag, name or serial…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All allocations</option>
          <option value="active">Currently held</option>
          <option value="returned">Returned</option>
        </select>
        <button className="btn" onClick={() => api.exportAllocationsCsv({ status, q }).catch((e) => setError(e.message))}>
          Export CSV
        </button>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Assigned to</th>
              <th>Employee no.</th>
              <th>Allocated</th>
              <th>Returned</th>
              <th>State</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/assets/${a.asset.id}`}>{a.asset.asset_tag}</Link> · {a.asset.name}
                </td>
                <td>{a.assignee_name}</td>
                <td>{a.employee_no || "—"}</td>
                <td className="nowrap">{a.allocated_on}</td>
                <td className="nowrap">{a.returned_on || "—"}</td>
                <td>
                  <span className={`pill ${a.returned_on ? "retired" : "in-use"}`}>
                    {a.returned_on ? `Returned · ${a.return_status}` : "Active"}
                  </span>
                </td>
                <td>{a.returned_by || a.allocated_by}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan="7" className="muted center">
                  No allocations found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span className="muted">{data.total} records</span>
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
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function Allocation() {
  const [tab, setTab] = useState("users");
  const [form, setForm] = useState(null); // null = closed, otherwise { prefill }
  const [returning, setReturning] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [focus, setFocus] = useState(null);
  const [peopleKey, setPeopleKey] = useState(0); // changing it restarts the by-user tab with default filters
  const [flash, setFlash] = useState("");

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <div className="page-head no-print">
        <h1>Asset allocation</h1>
        <button className="btn primary" onClick={() => setForm({ prefill: null })}>
          + Allocate asset
        </button>
      </div>

      {flash && <div className="flash no-print">{flash}</div>}

      {form && (
        <AllocateForm
          key={form.prefill?.key || "new"}
          prefill={form.prefill}
          onClose={() => setForm(null)}
          onDone={(msg, person) => {
            setForm(null);
            setFlash(msg);
            setTab("users");
            setFocus(person);
            setPeopleKey((k) => k + 1);
            bump();
          }}
        />
      )}

      <div className="tabs no-print">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          By user
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          Allocation history
        </button>
      </div>

      {tab === "users" ? (
        <PeopleTab
          key={peopleKey}
          refreshKey={refreshKey}
          focus={focus}
          onFocusDone={() => setFocus(null)}
          onAllocate={(p) => {
            setFlash("");
            setForm({ prefill: p });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onReturn={(allocs) => {
            setFlash("");
            setReturning(allocs);
          }}
        />
      ) : (
        <HistoryTab refreshKey={refreshKey} />
      )}

      {returning && (
        <ReturnDialog
          allocs={returning}
          onClose={() => setReturning(null)}
          onDone={(msg) => {
            setReturning(null);
            setFlash(msg);
            bump();
          }}
        />
      )}
    </>
  );
}
