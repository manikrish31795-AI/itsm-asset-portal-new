import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

const TABS = [
  { key: "warranty_expiring", label: "Warranty expiring", tone: "warn", dateLabel: "Warranty ends", help: "Warranty ends within the chosen period." },
  { key: "warranty_expired", label: "Warranty expired", tone: "danger", dateLabel: "Warranty ended", help: "Warranty has already ended (Retired and Lost assets are left out)." },
  { key: "eol", label: "End of life", tone: "warn", dateLabel: "End of life", help: "End-of-life date is near or already passed – plan replacements." },
  { key: "audit_due", label: "Audit due", tone: "warn", dateLabel: "Next audit", help: "Next audit date is near or already passed." },
];
const DAYS = [30, 60, 90, 180, 365];

function When({ d, expired }) {
  let text, cls;
  if (d === 0) { text = "today"; cls = "pill in-repair"; }
  else if (d < 0) { text = `${-d} day${d === -1 ? "" : "s"} ago`; cls = "pill lost"; }
  else { text = `in ${d} day${d === 1 ? "" : "s"}`; cls = d <= 30 ? "pill in-repair" : "pill in-stock"; }
  return <span className={cls}>{text}</span>;
}

export default function Alerts() {
  const [params, setParams] = useSearchParams();
  const type = TABS.some((t) => t.key === params.get("type")) ? params.get("type") : "warranty_expiring";
  const days = DAYS.includes(parseInt(params.get("days"), 10)) ? parseInt(params.get("days"), 10) : 60;
  const tab = TABS.find((t) => t.key === type);

  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ categories: [], locations: [] });
  const [filters, setFilters] = useState({ q: "", category: "", location: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 25 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const go = (next) => setParams({ type, days: String(days), ...next }, { replace: true });
  const setFilter = (k, v) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  useEffect(() => {
    api.assetMeta().then(setMeta).catch(() => {});
  }, []);
  useEffect(() => {
    api.alertSummary(days).then(setSummary).catch((e) => setError(e.message));
  }, [days]);
  useEffect(() => {
    setPage(1);
  }, [type, days]);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .alertItems({ type, days, ...filters, page, page_size: 25 })
        .then((d) => { setData(d); setError(""); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [type, days, filters, page]);

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const overdue = summary?.overdue_audits || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts &amp; reminders</h1>
          <span className="muted">Things that need action soon. Retired and Lost assets are not included.</span>
        </div>
        <div className="actions">
          <label className="inline-label">
            Look ahead
            <select value={days} onChange={(e) => go({ days: e.target.value })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {overdue.length > 0 && (
        <div className="card alert-audits">
          <h3>Overdue audits</h3>
          {overdue.map((a) => (
            <div className="overdue-row" key={a.id}>
              <Link to={`/audits/${a.id}`}>
                <strong>{a.name}</strong>
              </Link>
              <span className="muted">
                {a.checked} of {a.total} checked
              </span>
              <span className="pill lost">
                {a.days_overdue} day{a.days_overdue === 1 ? "" : "s"} overdue
              </span>
            </div>
          ))}
        </div>
      )}

      {summary?.licence_renewals?.length > 0 && (
        <div className="card">
          <h3>Software licences due for renewal</h3>
          {summary.licence_renewals.map((l) => (
            <div className="overdue-row" key={l.id}>
              <Link to={`/licenses/${l.id}`}>
                <strong>{l.name}</strong>
              </Link>
              <span className="muted">
                {l.used} of {l.seats} seats in use · {l.renewal_date}
              </span>
              <When d={l.days_left} />
            </div>
          ))}
        </div>
      )}

      <div className="stats">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`stat ${summary && summary[t.key] ? t.tone : ""} ${type === t.key ? "sel" : ""}`} onClick={() => go({ type: t.key })}>
            <span>{t.label}</span>
            <strong>{summary ? summary[t.key] : "–"}</strong>
          </button>
        ))}
      </div>

      <p className="muted small" style={{ margin: "-6px 0 12px" }}>
        {tab.help}
      </p>

      <div className="filters filters-3">
        <input placeholder="Search tag, name, serial, employee ID…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">All categories</option>
          {meta.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Location" value={filters.location} onChange={(e) => setFilter("location", e.target.value)}>
          <option value="">All locations</option>
          {meta.locations.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => api.exportAlerts({ type, days, category: filters.category, location: filters.location }).catch((e) => setError(e.message))}>
          Export CSV
        </button>
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Name</th>
              <th>Category</th>
              <th>Location</th>
              <th>Assigned to</th>
              <th>{tab.dateLabel}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">
                  <Link to={`/assets/${a.id}`}>{a.asset_tag}</Link>
                </td>
                <td>{a.name}</td>
                <td>{a.category}</td>
                <td>{a.location || "—"}</td>
                <td>{a.assigned_to || "—"}</td>
                <td className="nowrap">{a.date}</td>
                <td className="nowrap">
                  <When d={a.days_left} />
                </td>
              </tr>
            ))}
            {!loading && data.items.length === 0 && (
              <tr>
                <td colSpan="7" className="muted center">
                  Nothing here – all clear 🎉
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
    </>
  );
}
