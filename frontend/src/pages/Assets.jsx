import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export const statusClass = (s) => "pill " + s.toLowerCase().replace(/\s+/g, "-");

const NO_LOCATION = "__none__";

export default function Assets() {
  const { isStaff } = useAuth();
  const [sp, setSp] = useSearchParams(); // filters live in the URL, so they survive a refresh and can be linked to
  const [meta, setMeta] = useState({ categories: [], statuses: [], locations: [], no_location_count: 0 });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 20 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const filters = useMemo(
    () => ({
      q: sp.get("q") || "",
      category: sp.get("category") || "",
      status: sp.get("status") || "",
      location: sp.get("location") || "",
    }),
    [sp]
  );
  const anyFilter = Object.values(filters).some(Boolean);

  useEffect(() => {
    api.assetMeta().then(setMeta).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .assets({ ...filters, page, page_size: 20 })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in search
    return () => clearTimeout(t);
  }, [load]);

  const setFilter = (k, v) => {
    setPage(1);
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const clearFilters = () => {
    setPage(1);
    setSp({}, { replace: true });
  };

  // location choices: everything known, plus the current choice even if it is not in the list
  const locationOptions = [...meta.locations];
  const known = (v) => locationOptions.some((l) => l.name.toLowerCase() === v.toLowerCase());
  if (filters.location && filters.location !== NO_LOCATION && !known(filters.location)) {
    locationOptions.push({ name: filters.location, count: 0 });
  }
  const locationLabel =
    filters.location === NO_LOCATION
      ? "no location"
      : locationOptions.find((l) => l.name.toLowerCase() === filters.location.toLowerCase())?.name || filters.location;

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <>
      <div className="page-head">
        <h1>Assets</h1>
        {isStaff && (
          <div className="actions">
            <button className="btn" onClick={() => api.exportCsv(filters).catch((e) => setError(e.message))}>
              Export CSV
            </button>
            <Link className="btn" to="/assets/import">
              Import
            </Link>
            <Link className="btn primary" to="/assets/new">
              + Add asset
            </Link>
          </div>
        )}
      </div>

      <div className="filters filters-4">
        <input
          placeholder="Search name, tag, serial, hostname, MAC, IP, user…"
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
        />
        <select aria-label="Location" value={filters.location} onChange={(e) => setFilter("location", e.target.value)}>
          <option value="">All locations</option>
          {locationOptions.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name} ({l.count})
            </option>
          ))}
          {meta.no_location_count > 0 && <option value={NO_LOCATION}>No location ({meta.no_location_count})</option>}
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">All categories</option>
          {meta.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {meta.statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Location</th>
              <th>Assigned to</th>
              <th>Warranty</th>
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
                <td>
                  <span className={statusClass(a.status)}>{a.status}</span>
                </td>
                <td>
                  {a.location?.trim() ? (
                    <button type="button" className="link-btn" title="Show only this location" onClick={() => setFilter("location", a.location.trim())}>
                      {a.location}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{a.assigned_to?.full_name || a.assigned_username || "—"}</td>
                <td className="nowrap">{a.warranty_expiry || "—"}</td>
              </tr>
            ))}
            {!loading && data.items.length === 0 && (
              <tr>
                <td colSpan="7" className="muted center">
                  No assets found{anyFilter ? " for these filters" : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">
          {data.total} asset{data.total === 1 ? "" : "s"}
          {filters.location ? ` · ${locationLabel}` : ""}
          {anyFilter && (
            <>
              {" · "}
              <button type="button" className="link-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          )}
        </span>
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
