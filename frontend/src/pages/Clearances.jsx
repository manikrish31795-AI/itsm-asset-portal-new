import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { fmtTime } from "./Audits.jsx";
import { OutcomePill, PeopleTabs, profileLink } from "./Employees.jsx";

export default function Clearances() {
  const [status, setStatus] = useState("all");
  const [location, setLocation] = useState("");
  const [locations, setLocations] = useState({ locations: [], no_location_count: 0 });
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.assetMeta().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .clearances({ status, q, location })
        .then((d) => { setRows(d); setError(""); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [status, q, location]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Exit clearances</h1>
          <span className="muted">To start one, find the employee under “Find employee” and click Start exit clearance.</span>
        </div>
      </div>
      <PeopleTabs active="clearances" />
      <div className="filters filters-3b">
        <input placeholder="Search Employee ID or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {locations.locations.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
          <option value="__none__">No location</option>
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="open">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Clearance</th>
              <th>Employee</th>
              <th>Location</th>
              <th>Reason</th>
              <th>Last working day</th>
              <th>Checked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="nowrap">
                  <Link to={`/clearances/${c.id}`}>#{c.id}</Link>
                  <div className="muted small">{fmtTime(c.created_at)}</div>
                </td>
                <td>
                  <Link to={profileLink(c.person_key)}>{c.employee_name}</Link>
                  <div className="muted small">{c.employee_no ? `ID ${c.employee_no}` : ""}{c.department ? ` · ${c.department}` : ""}</div>
                </td>
                <td>{c.location || "—"}</td>
                <td>{c.reason}</td>
                <td className="nowrap">{c.last_working_day || "—"}</td>
                <td className="nowrap">
                  {c.counts.total - c.counts.pending} / {c.counts.total}
                </td>
                <td>
                  <OutcomePill c={c} />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan="7" className="muted center">No clearances{q || location || status !== "all" ? " match these filters" : " yet"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
