import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { money } from "./Licenses.jsx";

const TABS = [
  ["location", "By location"],
  ["category", "By category"],
  ["age", "By age"],
  ["cost", "By cost"],
  ["matrix", "Location × category"],
];
const KEYS = { location: "by_location", category: "by_category", age: "by_age", cost: "by_cost" };
const TITLES = { location: "Location", category: "Category", age: "Age of asset", cost: "Cost band" };

function BarCell({ value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <span className="rep-bar-wrap">
      <span className="rep-num">{value.toLocaleString("en-IN")}</span>
      <span className="rep-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function GroupTable({ items, title, showAge = true }) {
  const max = Math.max(0, ...items.map((i) => i.count));
  const sum = (k) => items.reduce((a, i) => a + (i[k] || 0), 0);
  if (!items.length) return <div className="card muted">No assets match these filters.</div>;
  return (
    <div className="card flush">
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            <th>Assets</th>
            <th className="r">In use</th>
            <th className="r">In stock</th>
            <th className="r">In repair</th>
            <th className="r">Total cost</th>
            <th className="r">Average cost</th>
            {showAge && <th className="r">Avg age</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.label}>
              <td>
                <strong>{i.label}</strong>
              </td>
              <td>
                <BarCell value={i.count} max={max} />
              </td>
              <td className="r">{i.in_use}</td>
              <td className="r">{i.in_stock}</td>
              <td className="r">{i.in_repair}</td>
              <td className="r">{money(i.cost)}</td>
              <td className="r">{money(i.avg_cost)}</td>
              {showAge && <td className="r">{i.avg_age != null ? `${i.avg_age} yrs` : "—"}</td>}
            </tr>
          ))}
          <tr className="rep-total">
            <td>Total</td>
            <td>{sum("count").toLocaleString("en-IN")}</td>
            <td className="r">{sum("in_use")}</td>
            <td className="r">{sum("in_stock")}</td>
            <td className="r">{sum("in_repair")}</td>
            <td className="r">{money(sum("cost"))}</td>
            <td className="r"></td>
            {showAge && <td className="r"></td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Matrix({ m }) {
  if (!m.rows.length) return <div className="card muted">No assets match these filters.</div>;
  const colTotals = m.categories.map((_, ci) => m.rows.reduce((a, r) => a + r.cells[ci], 0));
  const grand = m.rows.reduce((a, r) => a + r.total, 0);
  return (
    <div className="card flush">
      <table className="rep-matrix">
        <thead>
          <tr>
            <th>Location</th>
            {m.categories.map((c) => (
              <th key={c} className="r">{c}</th>
            ))}
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.label}>
              <td><strong>{r.label}</strong></td>
              {r.cells.map((n, i) => (
                <td key={i} className={`r ${n ? "" : "zero"}`}>{n || "·"}</td>
              ))}
              <td className="r"><strong>{r.total}</strong></td>
            </tr>
          ))}
          <tr className="rep-total">
            <td>Total</td>
            {colTotals.map((n, i) => (
              <td key={i} className="r">{n}</td>
            ))}
            <td className="r">{grand}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState("location");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("active");
  const [data, setData] = useState(null);
  const [opts, setOpts] = useState({ locations: [], categories: [], has_no_location: false, no_location_value: "__none__" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .reportSummary({ location, category, scope })
      .then((d) => {
        setData(d);
        setOpts(d.options);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [location, category, scope]);

  const t = data?.totals;
  const stat = (label, value, tone) => (
    <div className={`stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{data ? value : "–"}</strong>
    </div>
  );
  const exportIt = (report) => api.exportReport({ report, location, category, scope }).catch((e) => setError(e.message));
  const filterText = [location === opts.no_location_value ? "No location" : location, category, scope === "all" ? "including retired and lost" : "excluding retired and lost"]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <span className="muted">Asset summaries by location, category, age and cost. Generated {data?.generated_on || ""}.</span>
        </div>
        <div className="actions no-print">
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn" onClick={() => exportIt("assets")}>Export all assets (CSV)</button>
          <button className="btn primary" onClick={() => exportIt(tab)}>Export this report (CSV)</button>
        </div>
      </div>

      <div className="filters filters-rep no-print">
        <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {opts.locations.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
          {opts.has_no_location && <option value={opts.no_location_value}>No location</option>}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {opts.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="active">Active assets only</option>
          <option value="all">Include retired and lost</option>
        </select>
      </div>
      <div className="print-only rep-filter-line">Filters: {filterText}</div>
      {error && <div className="alert">{error}</div>}

      <div className="stats stats-5">
        {stat("Assets", t?.assets.toLocaleString("en-IN"))}
        {stat("Total purchase value", money(t?.cost))}
        {stat("Average cost", money(t?.avg_cost))}
        {stat("Average age", t?.avg_age != null ? `${t.avg_age} yrs` : "—")}
        {stat("Older than 5 years", t?.over_5_years, t?.over_5_years ? "warn" : "")}
      </div>
      {t && (t.no_cost > 0 || t.no_purchase_date > 0) && (
        <p className="muted rep-note">
          {t.no_cost > 0 && <>{t.no_cost.toLocaleString("en-IN")} {t.no_cost === 1 ? "asset has" : "assets have"} no cost recorded (not counted in cost totals). </>}
          {t.no_purchase_date > 0 && <>{t.no_purchase_date.toLocaleString("en-IN")} {t.no_purchase_date === 1 ? "asset has" : "assets have"} no purchase date (age unknown).</>}
        </p>
      )}

      <div className="tabs no-print">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {loading && !data ? (
        <div className="card muted">Loading…</div>
      ) : tab === "matrix" ? (
        data && <Matrix m={data.matrix} />
      ) : (
        data && <GroupTable items={data[KEYS[tab]]} title={TITLES[tab]} showAge={tab !== "age"} />
      )}
    </>
  );
}
