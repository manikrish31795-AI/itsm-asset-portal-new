import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import qrcode from "qrcode-generator";
import JsBarcode from "jsbarcode";
import { api } from "../api.js";

/* page size and label size in millimetres */
const LAYOUTS = {
  roll50: { name: "Label roll 50 × 25 mm", page: "50mm 25mm", w: 50, h: 25, cols: 1, pad: [0, 0] },
  roll75: { name: "Label roll 75 × 50 mm", page: "75mm 50mm", w: 75, h: 50, cols: 1, pad: [0, 0] },
  a4x24: { name: "A4 sheet – 3 × 8 (70 × 37 mm)", page: "A4", w: 70, h: 37, cols: 3, pad: [0.5, 0] },
  a4x40: { name: "A4 sheet – 4 × 10 (48.5 × 25.4 mm)", page: "A4", w: 48.5, h: 25.4, cols: 4, pad: [21.5, 8] },
};

function Qr({ text }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [text]);
  return <span className="lbl-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Bars({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      try {
        JsBarcode(ref.current, text, { format: "CODE128", displayValue: false, margin: 0, height: 40, width: 2 });
        ref.current.removeAttribute("width");
        ref.current.removeAttribute("height");
      } catch {}
    }
  }, [text]);
  return <svg ref={ref} className="lbl-bars" preserveAspectRatio="none" />;
}

// long imported tags such as ESDS\BDC\LP\20202108\2991\001 get a smaller font and may wrap
const tagSize = (t) => (t.length > 26 ? "xl" : t.length > 15 ? "long" : "");

function Label({ asset, kind, layout, show }) {
  const small = layout.h < 30;
  const tc = `lbl-tag ${tagSize(asset.asset_tag)}`;
  return (
    <div className={`lbl ${kind} ${small ? "small" : ""}`} style={{ width: `${layout.w}mm`, height: `${layout.h}mm` }}>
      {kind === "qr" ? (
        <>
          <Qr text={asset.asset_tag} />
          <div className="lbl-text">
            {show.company && <div className="lbl-co">{show.company}</div>}
            <div className={tc}>{asset.asset_tag}</div>
            {show.name && <div className="lbl-name">{asset.name}</div>}
            {show.location && asset.location && <div className="lbl-loc">{asset.location}</div>}
          </div>
        </>
      ) : (
        <>
          <div className="lbl-top">
            {show.company && <span className="lbl-co">{show.company}</span>}
            <span className={tc}>{asset.asset_tag}</span>
          </div>
          <Bars text={asset.asset_tag} />
          {(show.name || show.location) && (
            <div className="lbl-name">
              {show.name ? asset.name : ""}
              {show.name && show.location && asset.location ? " · " : ""}
              {show.location ? asset.location || "" : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Labels() {
  const [params] = useSearchParams();
  const [meta, setMeta] = useState({ categories: [], statuses: [], locations: [] });
  const [filters, setFilters] = useState({ q: "", category: "", status: "", location: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 20 });
  const [selected, setSelected] = useState({}); // id -> asset
  const [kind, setKind] = useState("qr");
  const [layoutKey, setLayoutKey] = useState("a4x24");
  const [copies, setCopies] = useState(1);
  const [show, setShow] = useState({ company: "ESDS", name: true, location: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const layout = LAYOUTS[layoutKey];

  useEffect(() => {
    api.assetMeta().then(setMeta).catch(() => {});
    const ids = (params.get("ids") || "").split(",").map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 100);
    if (ids.length) {
      Promise.all(ids.map((i) => api.asset(i).catch(() => null))).then((list) =>
        setSelected(Object.fromEntries(list.filter(Boolean).map((a) => [a.id, a])))
      );
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.assets({ ...filters, page, page_size: 20 }).then(setData).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [filters, page]);

  const setFilter = (k, v) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  const toggle = (a) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[a.id]) delete n[a.id];
      else n[a.id] = a;
      return n;
    });
  const allOnPage = data.items.length > 0 && data.items.every((a) => selected[a.id]);
  const togglePage = () =>
    setSelected((s) => {
      const n = { ...s };
      data.items.forEach((a) => (allOnPage ? delete n[a.id] : (n[a.id] = a)));
      return n;
    });
  const selectAllMatching = async () => {
    setBusy(true);
    setError("");
    try {
      const n = { ...selected };
      for (let p = 1; p <= 5; p++) {
        const d = await api.assets({ ...filters, page: p, page_size: 200 });
        d.items.forEach((a) => (n[a.id] = a));
        if (p * 200 >= d.total) break;
      }
      setSelected(n);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const list = Object.values(selected).sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
  const labels = list.flatMap((a) => Array.from({ length: copies }, (_, i) => ({ a, key: `${a.id}-${i}` })));
  const setCopiesSafe = (v) => setCopies(Math.min(20, Math.max(1, parseInt(v, 10) || 1)));

  return (
    <>
      <style>{`@media print { @page { size: ${layout.page}; margin: 0; } }`}</style>
      <div className="page-head no-print">
        <div>
          <h1>Asset labels</h1>
          <span className="muted">Pick assets, choose a label size and print. Stick the label on the device; scanning it in an Audit marks the asset found.</span>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={!list.length} onClick={() => window.print()}>
            Print {labels.length || ""} label{labels.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
      {error && <div className="alert no-print">{error}</div>}

      <div className="labels-layout no-print">
        <div>
          <div className="filters filters-4">
            <input placeholder="Search tag, name, serial…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
            <select aria-label="Category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
              <option value="">All categories</option>
              {meta.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All statuses</option>
              {meta.statuses.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Location" value={filters.location} onChange={(e) => setFilter("location", e.target.value)}>
              <option value="">All locations</option>
              {meta.locations.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name} ({l.count})
                </option>
              ))}
            </select>
          </div>
          <div className="bulk-bar">
            <span className="muted">
              {data.total} assets match · <strong>{list.length} selected</strong>
            </span>
            <div className="actions">
              <button className="btn" onClick={selectAllMatching} disabled={busy || !data.total}>
                {data.total > 1000 ? "Select first 1000 of " + data.total : `Select all ${data.total} matching`}
              </button>
              <button className="btn" onClick={() => setSelected({})} disabled={!list.length}>
                Clear selection
              </button>
            </div>
          </div>
          <div className="card flush">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" aria-label="Select this page" checked={allOnPage} onChange={togglePage} />
                  </th>
                  <th>Asset ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} onClick={() => toggle(a)} style={{ cursor: "pointer" }}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${a.asset_tag}`} checked={!!selected[a.id]} onChange={() => toggle(a)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="nowrap">{a.asset_tag}</td>
                    <td>{a.name}</td>
                    <td>{a.category}</td>
                    <td>{a.location || "—"}</td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan="5" className="muted center">
                      No assets found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>
            <span>
              Page {page} / {Math.max(1, Math.ceil(data.total / data.page_size))}
            </span>
            <button className="btn" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>

        <div className="card label-opts">
          <h3>Label options</h3>
          <label>
            Label size
            <select value={layoutKey} onChange={(e) => setLayoutKey(e.target.value)}>
              {Object.entries(LAYOUTS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="field-label">Code type</div>
            <div className="seg-toggle">
              <button type="button" className={kind === "qr" ? "on" : ""} onClick={() => setKind("qr")}>
                QR code
              </button>
              <button type="button" className={kind === "bar" ? "on" : ""} onClick={() => setKind("bar")}>
                Barcode
              </button>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              QR works with phone cameras and most scanners. Choose Barcode for older laser scanners.
            </div>
          </div>
          <label>
            Company name on label
            <input value={show.company} onChange={(e) => setShow({ ...show, company: e.target.value })} placeholder="Leave empty to hide" />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={show.name} onChange={(e) => setShow({ ...show, name: e.target.checked })} /> Show asset name
          </label>
          <label className="check-row">
            <input type="checkbox" checked={show.location} onChange={(e) => setShow({ ...show, location: e.target.checked })} /> Show location
          </label>
          <label>
            Copies of each label
            <input type="number" min="1" max="20" value={copies} onChange={(e) => setCopiesSafe(e.target.value)} />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            When printing, set the browser's <strong>Scale to 100%</strong> and <strong>Margins to None</strong>, so labels line up exactly.
          </p>
        </div>
      </div>

      <h3 className="no-print" style={{ marginTop: 22 }}>
        Preview {labels.length > 0 && <span className="muted">({labels.length} label{labels.length === 1 ? "" : "s"})</span>}
      </h3>
      {labels.length === 0 ? (
        <div className="card muted center no-print">Select assets above to see their labels here</div>
      ) : (
        <div
          className="label-sheet"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, ${layout.w}mm)`,
            paddingTop: `${layout.pad[0]}mm`,
            paddingLeft: `${layout.pad[1]}mm`,
          }}
        >
          {labels.map(({ a, key }) => (
            <Label key={key} asset={a} kind={kind} layout={layout} show={show} />
          ))}
        </div>
      )}
    </>
  );
}
