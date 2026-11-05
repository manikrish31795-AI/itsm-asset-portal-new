import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";

export function PeopleTabs({ active }) {
  const nav = useNavigate();
  return (
    <div className="tabs no-print">
      <button className={active === "employees" ? "active" : ""} onClick={() => nav("/employees")}>
        Find employee
      </button>
      <button className={active === "clearances" ? "active" : ""} onClick={() => nav("/clearances")}>
        Exit clearances
      </button>
    </div>
  );
}

export const profileLink = (key) => `/employee?key=${encodeURIComponent(key)}`;

export default function Employees() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [withAssets, setWithAssets] = useState(false);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .employees({ q, only_with_assets: withAssets ? "true" : "" })
        .then((d) => { setData(d); setError(""); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, withAssets]);

  const onEnter = (e) => {
    e.preventDefault();
    const exact = data.items.find((p) => (p.employee_no || "").toLowerCase() === q.trim().toLowerCase());
    const pick = exact || (data.items.length === 1 ? data.items[0] : null);
    if (pick) nav(profileLink(pick.key));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <span className="muted">Type an Employee ID or name to see everything that person holds, print a handover form, or start an exit clearance.</span>
        </div>
      </div>
      <PeopleTabs active="employees" />
      <form onSubmit={onEnter} className="emp-search">
        <input
          className="big"
          autoFocus
          placeholder="Employee ID or name, then press Enter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Employee ID or name"
        />
        <label className="check-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={withAssets} onChange={(e) => setWithAssets(e.target.checked)} /> Only people who currently hold assets
        </label>
      </form>
      {error && <div className="alert">{error}</div>}
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Department</th>
              <th>Assets held</th>
              <th>Exit clearance</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.key}>
                <td className="nowrap">
                  <Link to={profileLink(p.key)}>{p.employee_no || "—"}</Link>
                </td>
                <td>
                  <Link to={profileLink(p.key)}>{p.name}</Link>
                </td>
                <td>{p.department || "—"}</td>
                <td>
                  <span className="count">{p.active_count}</span>
                </td>
                <td>
                  {p.open_clearance_id ? (
                    <Link to={`/clearances/${p.open_clearance_id}`} className="pill in-repair">
                      In progress
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!loading && data.items.length === 0 && (
              <tr>
                <td colSpan="5" className="muted center">
                  No employee found{q ? ` for “${q}”` : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > data.items.length && <p className="muted small">Showing {data.items.length} of {data.total}. Type more of the ID or name to narrow it down.</p>}
    </>
  );
}

export function OutcomePill({ c }) {
  if (c.status === "open") return <span className="pill in-repair">In progress</span>;
  if (c.status === "cancelled") return <span className="pill retired">Cancelled</span>;
  if (c.outcome === "cleared") return <span className="pill in-use">Cleared</span>;
  if (c.outcome === "cleared_with_loss") return <span className="pill in-repair">Cleared – with loss</span>;
  return <span className="pill lost">Not cleared</span>;
}
