import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

export const money = (n) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

export function SeatBar({ used, seats }) {
  const pct = seats ? Math.min(100, Math.round((used / seats) * 100)) : 0;
  return (
    <span className="seat-bar" title={`${used} of ${seats} seats in use`}>
      <span className={`seat-fill ${pct >= 100 ? "full" : pct >= 80 ? "high" : ""}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function RenewalPill({ state, days }) {
  if (state === "none") return <span className="muted">No expiry</span>;
  if (state === "expired") return <span className="pill lost">Expired {-days} day{days === -1 ? "" : "s"} ago</span>;
  if (days === 0) return <span className="pill in-repair">Renews today</span>;
  return <span className={`pill ${state === "expiring" ? "in-repair" : "in-stock"}`}>in {days} day{days === 1 ? "" : "s"}</span>;
}

const STATUS = [
  ["active", "Active"],
  ["available", "Seats available"],
  ["full", "All seats used"],
  ["expiring", "Renewing within 60 days"],
  ["expired", "Expired"],
  ["retired", "Retired"],
  ["all", "All (incl. retired)"],
];

export default function Licenses() {
  const [sp, setSp] = useSearchParams();
  const status = STATUS.some(([v]) => v === sp.get("status")) ? sp.get("status") : "active";
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [types, setTypes] = useState([]);
  const [sum, setSum] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.licenseMeta().then((m) => setTypes(m.types)).catch(() => {});
  }, []);
  useEffect(() => {
    api.licenseSummary().then(setSum).catch(() => {});
  }, []);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .licenses({ q, type, status })
        .then((d) => { setRows(d.items); setError(""); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, type, status]);

  const setStatus = (v) => setSp(v === "active" ? {} : { status: v }, { replace: true });
  const tile = (label, value, st, tone) => (
    <button type="button" className={`stat ${tone || ""} ${status === st ? "sel" : ""}`} onClick={() => st && setStatus(st)} disabled={!st}>
      <span>{label}</span>
      <strong>{sum ? value : "–"}</strong>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Software licences</h1>
          <span className="muted">Licence keys, seats bought against seats in use, and renewal dates.</span>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => api.exportLicenses({ q, type, status }).catch((e) => setError(e.message))}>
            Export CSV
          </button>
          <Link className="btn primary" to="/licenses/new">
            + Add licence
          </Link>
        </div>
      </div>

      <div className="stats stats-5">
        {tile("Licences", sum?.licenses, "active")}
        {tile("Seats bought", sum?.seats)}
        {tile("Seats in use", sum ? `${sum.used} / ${sum.seats}` : "")}
        {tile("Renewing within 60 days", sum?.expiring, "expiring", sum?.expiring ? "warn" : "")}
        {tile("Expired", sum?.expired, "expired", sum?.expired ? "danger" : "")}
      </div>

      <div className="filters filters-3b">
        <input placeholder="Search name, publisher, supplier, order no…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Licence</th>
              <th>Type</th>
              <th>Seats in use</th>
              <th>Renewal</th>
              <th>Supplier</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link to={`/licenses/${l.id}`}>
                    <strong>{l.name}</strong>
                  </Link>
                  {l.status === "retired" && <span className="pill retired" style={{ marginLeft: 8 }}>Retired</span>}
                  <div className="muted small">{l.publisher || ""}</div>
                </td>
                <td>{l.license_type}</td>
                <td className="seat-cell">
                  <SeatBar used={l.used} seats={l.seats} />
                  <span className="small">
                    {l.used} / {l.seats}
                    {l.available === 0 && <span className="muted"> · full</span>}
                  </span>
                </td>
                <td className="nowrap">
                  {l.renewal_date || ""}
                  <div>
                    <RenewalPill state={l.state} days={l.days_left} />
                  </div>
                </td>
                <td>{l.vendor || "—"}</td>
                <td className="nowrap">{money(l.purchase_cost)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan="6" className="muted center">
                  No licences{q || type || status !== "active" ? " match these filters" : " yet – click “+ Add licence”"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
