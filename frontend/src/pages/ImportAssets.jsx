import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function Tile({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ImportAssets() {
  const [file, setFile] = useState(null);
  const [onDuplicate, setOnDuplicate] = useState("skip");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (e) => {
    setFile(e.target.files[0] || null);
    setResult(null); // a new file invalidates any earlier preview
    setError("");
  };

  const run = async (dryRun) => {
    setBusy(true);
    setError("");
    try {
      setResult(await api.importAssets(file, { onDuplicate, dryRun }));
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const done = result && !result.dry_run;
  const importable = result ? result.created + result.updated : 0;
  const verb = (past, future) => (done ? past : future);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/assets" className="muted">
            ← Assets
          </Link>
          <h1>Import assets</h1>
        </div>
        <button className="btn" onClick={() => api.downloadImportTemplate().catch((e) => setError(e.message))}>
          Download CSV template
        </button>
      </div>

      <div className="card">
        <h3>1. Choose your file</h3>
        <p className="muted">
          Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file (up to 5 MB / 5,000 rows) with one row per
          asset. The first row must be column headings. Required: an asset ID, a name (Asset Name, DeviceName or Model)
          and a Category. Columns such as Company, Model No., Serial, Cost, Supplier, Username, Employee No.,
          MAC Address, IPADDR, RAM or Warranty Expires are recognised automatically; <strong>every other column is
          kept as an “additional detail” on the asset</strong>, so nothing is lost. New categories are created
          automatically. Dates can be <code>YYYY-MM-DD</code> or <code>DD/MM/YYYY</code>.
        </p>
        <div className="import-controls">
          <input type="file" accept=".csv,.xlsx" onChange={pick} />
          <label>
            If an asset tag already exists
            <select value={onDuplicate} onChange={(e) => { setOnDuplicate(e.target.value); setResult(null); }}>
              <option value="skip">Skip it (keep the existing record)</option>
              <option value="update">Update it with the values from my file</option>
            </select>
          </label>
          <button className="btn primary" disabled={!file || busy} onClick={() => run(true)}>
            {busy ? "Working…" : "Check file"}
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {result && (
        <div className="card">
          <h3>{done ? "Import finished" : "2. Preview — nothing has been imported yet"}</h3>
          <div className="stats">
            <Tile label={verb("Created", "Will be created")} value={result.created} />
            <Tile label={verb("Updated", "Will be updated")} value={result.updated} />
            <Tile label="Skipped (already exist)" value={result.skipped} />
            <Tile label="Rows with errors" value={result.failed} tone={result.failed ? "danger" : ""} />
          </div>

          {result.new_categories.length > 0 && (
            <p>
              <strong>{verb("New categories created", "New categories that will be created")}:</strong>{" "}
              {result.new_categories.join(", ")}
            </p>
          )}
          {result.new_statuses.length > 0 && (
            <p>
              <strong>{verb("New statuses created", "New statuses that will be created")}:</strong>{" "}
              {result.new_statuses.join(", ")}
            </p>
          )}
          {result.extra_columns.length > 0 && (
            <p className="muted">
              Saved as additional details ({result.extra_columns.length} columns): {result.extra_columns.join(", ")}
            </p>
          )}

          {result.failed > 0 && (
            <>
              <h3>Rows that need fixing</h3>
              <div className="card flush">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Asset tag</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e) => (
                      <tr key={e.row}>
                        <td>{e.row}</td>
                        <td>{e.asset_tag || "—"}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.errors_truncated && <p className="muted">Showing the first {result.errors.length} errors.</p>}
              <p className="muted">
                Row numbers match your spreadsheet. Rows with errors are never imported; the others are. After fixing
                them you can upload the file again — assets that already exist are skipped, so nothing is duplicated.
              </p>
            </>
          )}

          {!done && (
            <div className="actions">
              <button className="btn primary" disabled={busy || importable === 0} onClick={() => run(false)}>
                {busy ? "Importing…" : importable ? `Import ${importable} asset${importable === 1 ? "" : "s"}` : "Nothing to import"}
              </button>
            </div>
          )}
          {done && (
            <div className="actions">
              <Link className="btn primary" to="/assets">
                View assets
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
