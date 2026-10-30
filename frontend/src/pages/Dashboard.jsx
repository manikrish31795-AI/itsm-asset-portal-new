import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function BarList({ title, rows, filter }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="muted">No data</p>}
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label">
            <Link to={`/assets?${filter}=${encodeURIComponent(r.label === "Unspecified" && filter === "location" ? "__none__" : r.label)}`} title="Show these assets">
              {r.label}
            </Link>
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="bar-count">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <div className="stats">
        <div className="stat">
          <span>Total assets</span>
          <strong>{data.total_assets}</strong>
        </div>
        <div className="stat">
          <span>Total purchase value</span>
          <strong>{money(data.total_value)}</strong>
        </div>
        <div className="stat warn">
          <span>Warranty expiring (60 days)</span>
          <strong>{data.warranty_expiring_soon}</strong>
        </div>
        <div className="stat danger">
          <span>Warranty expired</span>
          <strong>{data.warranty_expired}</strong>
        </div>
      </div>
      <div className="grid3">
        <BarList title="By category" rows={data.by_category} filter="category" />
        <BarList title="By status" rows={data.by_status} filter="status" />
        <BarList title="By location" rows={data.by_location} filter="location" />
      </div>
      <div className="card">
        <h3>Warranties expiring soon</h3>
        {data.expiring_assets.length === 0 ? (
          <p className="muted">Nothing expiring in the next 60 days.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Asset</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {data.expiring_assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/assets/${a.id}`}>{a.asset_tag}</Link>
                  </td>
                  <td>{a.name}</td>
                  <td>{a.warranty_expiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
