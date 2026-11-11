import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const SEV = { high: "High", medium: "Medium", low: "Low" };
const GROUPS = ["Duplicates", "Inconsistent", "Missing details", "Spelling"];

function VariantGroups({ data, onFix, canFix, busy }) {
  const [pick, setPick] = useState({});
  if (!data.groups.length) return <div className="card muted">No spelling problems found.</div>;
  return (
    <div className="card flush">
      <table>
        <thead>
          <tr>
            <th>Spellings found</th>
            <th>Assets</th>
            <th className="no-print">Keep this spelling</th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => {
            const chosen = pick[g.label] || g.suggested;
            return (
              <tr key={g.label}>
                <td>
                  {g.variants.map((v) => (
                    <span key={v.name} className="pill dq-variant">
                      “{v.name}” · {v.count}
                    </span>
                  ))}
                </td>
                <td>{g.total}</td>
                <td className="no-print">
                  {canFix ? (
                    <span className="dq-fix">
                      <select value={chosen} onChange={(e) => setPick({ ...pick, [g.label]: e.target.value })}>
                        {g.variants.map((v) => (
                          <option key={v.name} value={v.name.replace(/\s+/g, " ").trim()}>
                            {v.name.replace(/\s+/g, " ").trim()}
                          </option>
                        ))}
                      </select>
                      <button className="btn" disabled={busy} onClick={() => onFix(data.field, chosen, g.total)}>
                        Standardise
                      </button>
                    </span>
                  ) : (
                    <span className="muted">Admin can fix</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DataQuality() {
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState("active");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [opts, setOpts] = useState({ locations: [], categories: [], no_location_count: 0 });
  const [sum, setSum] = useState(null);
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.assetMeta().then((m) => setOpts(m)).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .qualitySummary({ scope, location, category })
      .then((d) => {
        setSum(d);
        setError("");
        // open the first failing check by default
        setSel((cur) => (cur && d.checks.some((c) => c.key === cur) ? cur : d.checks.find((c) => c.count)?.key || ""));
      })
      .catch((e) => setError(e.message));
  }, [scope, location, category, tick]);

  useEffect(() => {
    setPage(1);
  }, [sel, q, scope, location, category]);

  useEffect(() => {
    if (!sel) {
      setDetail(null);
      return;
    }
    setLoading(true);
    api
      .qualityItems({ check: sel, scope, location, category, q, page, page_size: 25 })
      .then((d) => {
        setDetail(d);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sel, scope, location, category, q, page, tick]);

  const fix = (field, canonical, n) => {
    if (!window.confirm(`Change ${n} asset${n === 1 ? "" : "s"} to use “${canonical}” as the ${field}?`)) return;
    setBusy(true);
    api
      .fixSpelling({ field, canonical })
      .then((r) => {
        setFlash(`Updated ${r.changed} asset${r.changed === 1 ? "" : "s"} to “${r.canonical}”.`);
        setTick((t) => t + 1);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const exportIt = (check) => api.exportQuality({ check, scope, location, category }).catch((e) => setError(e.message));
  const current = sum?.checks.find((c) => c.key === sel);
  const pages = detail?.kind === "assets" ? Math.max(1, Math.ceil(detail.total / detail.page_size)) : 1;
  const pct = sum?.clean_percent ?? 0;
  const tone = pct >= 90 ? "ok" : pct >= 70 ? "warn" : "bad";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data quality</h1>
          <span className="muted">Finds duplicates, missing details and mistakes in the asset list so reports and audits can be trusted.</span>
        </div>
        <div className="actions no-print">
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn primary" onClick={() => exportIt("all")}>Export all issues (CSV)</button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {flash && <div className="flash">{flash}</div>}

      <div className="filters filters-rep no-print">
        <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {opts.locations.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
          {opts.no_location_count > 0 && <option value="__none__">No location</option>}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {opts.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="active">Active assets only</option>
          <option value="all">Include retired and lost</option>
        </select>
      </div>

      <div className="stats stats-3">
        <div className={`stat dq-score ${tone}`}>
          <span>Clean records</span>
          <strong>{sum ? `${pct}%` : "–"}</strong>
        </div>
        <div className="stat">
          <span>Assets with a problem</span>
          <strong>{sum ? `${sum.assets_with_issues.toLocaleString("en-IN")} of ${sum.total_assets.toLocaleString("en-IN")}` : "–"}</strong>
        </div>
        <div className="stat">
          <span>Checks with findings</span>
          <strong>{sum ? `${sum.checks_failing} of ${sum.checks.length}` : "–"}</strong>
        </div>
      </div>

      <div className="dq-layout">
        <div className="card dq-list no-print">
          {GROUPS.map((g) => (
            <div key={g}>
              <h4>{g}</h4>
              {sum?.checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <button key={c.key} className={`dq-check ${sel === c.key ? "active" : ""}`} onClick={() => setSel(c.key)}>
                    <span className="dq-title">{c.title}</span>
                    <span className={`dq-count ${c.count ? c.severity : "zero"}`}>{c.count ? c.count.toLocaleString("en-IN") : "✓"}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>

        <div className="dq-detail">
          {current && (
            <div className="dq-head">
              <div>
                <h3>
                  {current.title} <span className={`pill dq-sev ${current.severity}`}>{SEV[current.severity]}</span>
                </h3>
                <span className="muted">{current.description}</span>
              </div>
              <div className="actions no-print">
                {detail?.kind === "assets" && (
                  <input type="search" placeholder="Search these…" value={q} onChange={(e) => setQ(e.target.value)} />
                )}
                <button className="btn" onClick={() => exportIt(current.key)} disabled={!current.count}>
                  Export (CSV)
                </button>
              </div>
            </div>
          )}

          {!current ? (
            <div className="card muted">{sum ? "Nothing to show." : "Checking your assets…"}</div>
          ) : loading && !detail ? (
            <div className="card muted">Loading…</div>
          ) : detail?.kind === "variants" ? (
            <VariantGroups data={detail} onFix={fix} canFix={isAdmin} busy={busy} />
          ) : detail && detail.items.length === 0 ? (
            <div className="card muted">{current.count ? "No matches for that search." : "No problems found for this check. ✓"}</div>
          ) : (
            detail && (
              <div className="card flush">
                <table>
                  <thead>
                    <tr>
                      <th>Asset ID</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Location</th>
                      <th>Assigned to</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((r) => (
                      <tr key={`${r.id}-${r.detail}`}>
                        <td>
                          <Link to={`/assets/${r.id}`}>
                            <strong>{r.asset_tag}</strong>
                          </Link>
                        </td>
                        <td>{r.name}</td>
                        <td>
                          <span className={`pill ${r.status.toLowerCase().replace(/\s+/g, "-")}`}>{r.status}</span>
                        </td>
                        <td>{r.location || <span className="muted">—</span>}</td>
                        <td>
                          {r.assigned_to || <span className="muted">—</span>}
                          {r.employee_no && <span className="muted"> · {r.employee_no}</span>}
                        </td>
                        <td className="dq-problem">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pages > 1 && (
                  <div className="pager no-print">
                    <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      Previous
                    </button>
                    <span className="muted">
                      Page {page} of {pages} · {detail.total.toLocaleString("en-IN")} findings
                    </span>
                    <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                      Next
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
