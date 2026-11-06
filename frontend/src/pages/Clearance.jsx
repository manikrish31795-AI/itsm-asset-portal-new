import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { fmtTime } from "./Audits.jsx";
import { OutcomePill, profileLink } from "./Employees.jsx";

const RETURN_STATUSES = ["In Stock", "In Repair", "Retired"];
const CONDITIONS = ["Good", "Damaged", "Needs repair"];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const FINAL_TEXT = { returned: "Returned", lost: "Not returned – recorded as Lost", outstanding: "NOT RETURNED – still outstanding" };

function Row({ c, it, open, onSaved, onError }) {
  const [notes, setNotes] = useState(it.notes || "");
  useEffect(() => setNotes(it.notes || ""), [it.notes]);
  const save = async (patch) => {
    try {
      onSaved(await api.setClearanceItem(c.id, it.id, { result: it.result, return_status: it.return_status, condition: it.condition, notes, ...patch }));
    } catch (e) {
      onError(e.message);
    }
  };
  const decided = it.result !== "pending";

  return (
    <tr className={it.result === "returned" ? "row-ok" : it.result === "not_returned" ? "row-bad" : ""}>
      <td className="nowrap"><Link to={`/assets/${it.asset_id}`}>{it.asset_tag}</Link></td>
      <td>
        {it.asset_name}
        <div className="muted small">{it.category}{it.serial_number ? ` · ${it.serial_number}` : ""}</div>
      </td>
      <td className="nowrap">{it.allocated_on || "—"}</td>
      <td>
        {!open ? (
          <>
            <span className={`pill ${it.final === "returned" ? "in-use" : it.final === "lost" ? "in-repair" : "lost"}`}>{FINAL_TEXT[it.final] || "—"}</span>
            {it.final === "returned" && it.return_status && <span className="muted small"> → {it.return_status}{it.condition ? `, ${it.condition}` : ""}</span>}
            {it.notes && <div className="muted small">“{it.notes}”</div>}
          </>
        ) : it.already_returned ? (
          <span className="pill in-use">Already returned (Allocation tab)</span>
        ) : (
          <div className="decide">
            <div className="seg-toggle">
              <button type="button" className={it.result === "returned" ? "on ok" : ""} onClick={() => save({ result: "returned", return_status: it.return_status || "In Stock", condition: it.condition || "Good" })}>
                ✓ Returned
              </button>
              <button type="button" className={it.result === "not_returned" ? "on bad" : ""} onClick={() => save({ result: "not_returned" })}>
                ✗ Not returned
              </button>
            </div>
            {it.result === "returned" && (
              <div className="decide-extra">
                <select aria-label="Status after return" value={it.return_status || "In Stock"} onChange={(e) => save({ return_status: e.target.value })}>
                  {RETURN_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <select aria-label="Condition" value={it.condition || "Good"} onChange={(e) => save({ condition: e.target.value })}>
                  {CONDITIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
            {decided && (
              <input
                className="decide-notes"
                placeholder={it.result === "returned" ? "Notes (optional)" : "Why / where is it? (optional)"}
                value={notes}
                maxLength={300}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== (it.notes || "") && save({ notes })}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function CompleteDialog({ c, onClose, onDone }) {
  const n = c.counts;
  const [markLost, setMarkLost] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await api.completeClearance(c.id, { mark_lost: markLost }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ margin: 0 }}>Complete clearance</h3>
        <div className="muted">
          {plural(n.returned, "asset")} will be returned to stock as you chose
          {n.not_returned ? `, and ${plural(n.not_returned, "asset")} marked as not returned` : ""}. The assets then leave {c.employee_name}'s record and their software licence seats are freed. This cannot be undone.
        </div>
        {n.not_returned > 0 && (
          <div className="radio-col">
            <label className="check-row">
              <input type="radio" name="lost" checked={!markLost} onChange={() => setMarkLost(false)} />
              Keep the {plural(n.not_returned, "unreturned asset")} with the employee – the certificate will say <strong>NOT CLEARED</strong>
            </label>
            <label className="check-row">
              <input type="radio" name="lost" checked={markLost} onChange={() => setMarkLost(true)} />
              Write them off: set status to <strong>Lost</strong> and remove them from the employee
            </label>
          </div>
        )}
        {error && <div className="alert">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>{busy ? "Completing…" : "Complete clearance"}</button>
          <button type="button" className="btn" onClick={onClose}>Keep working</button>
        </div>
      </form>
    </div>
  );
}

export default function Clearance() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [freed, setFreed] = useState(0);

  useEffect(() => {
    api.clearance(id).then(setC).catch((e) => setError(e.message));
  }, [id]);

  if (error && !c) return <div className="alert">{error}</div>;
  if (!c) return <div className="muted">Loading…</div>;

  const open = c.status === "open";
  const n = c.counts;
  const decided = n.total - n.pending - c.items.filter((i) => i.already_returned && i.result === "pending").length;
  const stillPending = c.items.filter((i) => i.result === "pending" && !i.already_returned).length;
  const outstanding = c.items.filter((i) => i.final === "outstanding");

  const cancel = async () => {
    if (!window.confirm("Cancel this clearance? No asset has been changed.")) return;
    try {
      setC(await api.cancelClearance(id));
    } catch (e) {
      setError(e.message);
    }
  };
  const allBack = async () => {
    try {
      setC(await api.allReturned(id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="no-print">
        <div className="page-head">
          <div>
            <Link to="/clearances" className="muted">← Exit clearances</Link>
            <h1>
              Clearance #{c.id}: <Link to={profileLink(c.person_key)}>{c.employee_name}</Link> <OutcomePill c={c} />
            </h1>
            <span className="muted">
              {[c.employee_no && `ID ${c.employee_no}`, c.department, c.job_title, c.reason, c.last_working_day && `last working day ${c.last_working_day}`].filter(Boolean).join(" · ")}
            </span>
            {c.notes && <div className="muted small">{c.notes}</div>}
          </div>
          <div className="actions">
            {!open && c.status === "completed" && (
              <button className="btn primary" onClick={() => window.print()}>Print clearance certificate</button>
            )}
            {open && (
              <>
                <button className="btn" onClick={allBack} disabled={!stillPending}>Mark all returned (good)</button>
                <button className="btn primary" onClick={() => setCompleting(true)} disabled={stillPending > 0}
                  title={stillPending ? `${stillPending} item(s) still need a decision` : ""}>
                  Complete clearance
                </button>
                <button className="btn danger" onClick={cancel}>Cancel</button>
              </>
            )}
          </div>
        </div>

        {error && <div className="alert">{error}</div>}

        {c.status === "completed" && (
          <div className={c.outcome === "cleared" ? "flash" : c.outcome === "cleared_with_loss" ? "flash warnbox" : "alert"}>
            {c.outcome === "cleared" && <>Cleared – every asset has been returned.</>}
            {c.outcome === "cleared_with_loss" && <>Cleared with loss – some assets were not returned and are recorded as Lost.</>}
            {c.outcome === "not_cleared" && <><strong>Not cleared</strong> – {plural(outstanding.length, "asset")} still with the employee: {outstanding.map((i) => i.asset_tag).join(", ")}. Start a new clearance when they are returned.</>}
            {" "}Completed by {c.completed_by}, {fmtTime(c.completed_at)}.{freed > 0 && ` ${plural(freed, "software licence seat")} freed.`}
          </div>
        )}
        {c.status === "cancelled" && <div className="alert">This clearance was cancelled. No asset was changed.</div>}

        {open && (
          <div className="card">
            <div className="bulk-bar" style={{ marginBottom: 8 }}>
              <strong>{decided} of {n.total} decided</strong>
              <span className="muted">{n.returned} returned · {n.not_returned} not returned · {stillPending} to do</span>
            </div>
            <div className="progress">
              <span className="seg found" style={{ width: `${n.total ? (n.returned / n.total) * 100 : 0}%` }} />
              <span className="seg missing" style={{ width: `${n.total ? (n.not_returned / n.total) * 100 : 0}%` }} />
            </div>
            <p className="muted small" style={{ margin: "10px 0 0" }}>
              Check each asset as the employee hands it over. Nothing changes in the asset records until you click <strong>Complete clearance</strong>.
            </p>
          </div>
        )}

        <div className="card flush">
          <table>
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset</th>
                <th>Held since</th>
                <th>{open ? "Handed back?" : "Result"}</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <Row key={it.id} c={c} it={it} open={open} onSaved={setC} onError={setError} />
              ))}
              {c.items.length === 0 && (
                <tr>
                  <td colSpan="4" className="muted center">This employee held no assets when the clearance was started – it can be completed right away.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {c.status === "completed" && (
        <div className="print-only">
          <h1>Asset clearance certificate</h1>
          <p>
            <strong>Employee:</strong> {c.employee_name}{c.employee_no ? ` (ID ${c.employee_no})` : ""}
            <br />
            {c.department && (<><strong>Department:</strong> {c.department}<br /></>)}
            {c.job_title && (<><strong>Designation:</strong> {c.job_title}<br /></>)}
            <strong>Reason for exit:</strong> {c.reason}
            <br />
            {c.last_working_day && (<><strong>Last working day:</strong> {c.last_working_day}<br /></>)}
            <strong>Clearance date:</strong> {new Date(c.completed_at + "Z").toLocaleDateString()} · Ref #{c.id}
          </p>
          <table>
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset</th>
                <th>Serial number</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.asset_tag}</td>
                  <td>{i.asset_name}</td>
                  <td>{i.serial_number || "—"}</td>
                  <td>
                    {FINAL_TEXT[i.final] || "—"}
                    {i.final === "returned" && i.condition ? ` (${i.condition})` : ""}
                    {i.notes ? ` – ${i.notes}` : ""}
                  </td>
                </tr>
              ))}
              {c.items.length === 0 && (
                <tr><td colSpan="4">No company assets were held by this employee.</td></tr>
              )}
            </tbody>
          </table>
          <p style={{ marginTop: 16 }}>
            <strong>
              {c.outcome === "cleared" && "ASSET CLEARANCE: CLEARED. All company assets issued to the employee have been returned."}
              {c.outcome === "cleared_with_loss" && "ASSET CLEARANCE: CLEARED WITH LOSS. Assets marked “Lost” above were not returned and have been written off in the asset register."}
              {c.outcome === "not_cleared" && `ASSET CLEARANCE: NOT CLEARED. ${plural(outstanding.length, "asset")} listed above remain outstanding with the employee.`}
            </strong>
          </p>
          <div className="signatures">
            <div>Employee: ______________________</div>
            <div>IT / Asset manager ({c.completed_by}): ______________________</div>
            <div>HR / Manager: ______________________</div>
          </div>
        </div>
      )}

      {completing && (
        <CompleteDialog c={c} onClose={() => setCompleting(false)} onDone={(x) => { setCompleting(false); setFreed(x.licenses_released || 0); setC(x); }} />
      )}
    </>
  );
}
