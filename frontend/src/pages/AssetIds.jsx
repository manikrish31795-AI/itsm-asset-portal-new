import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { fmtTime } from "./Audits.jsx";

const EMPTY = {
  category: "Laptop", manufacturer: "", model: "", model_no: "", name: "", serial_number: "", hostname: "", mac_address: "",
  vendor: "", order_number: "", purchase_date: "", purchase_cost: "", warranty_months: "", warranty_expiry: "",
  company: "", location: "", department: "", os: "", processor: "", ram: "", storage: "", notes: "",
};
const NO_SERIAL_NEEDED = ["software", "other"];

export default function AssetIds() {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ categories: [], locations: [] });
  const [series, setSeries] = useState({ company: "ESDS", series: [] });
  const [preview, setPreview] = useState(null);
  const [dups, setDups] = useState([]);
  const [recent, setRecent] = useState([]);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const top = useRef(null);

  const loadLists = () => {
    api.assetIdRecent().then(setRecent).catch(() => {});
    api.assetIdSeries().then(setSeries).catch(() => {});
  };
  useEffect(() => {
    api.assetMeta().then(setMeta).catch(() => {});
    loadLists();
  }, []);

  // the ID that the next save will receive, for the category typed
  useEffect(() => {
    const cat = form.category.trim();
    if (!cat) return setPreview(null);
    const t = setTimeout(() => api.assetIdPreview(cat).then(setPreview).catch(() => setPreview(null)), 200);
    return () => clearTimeout(t);
  }, [form.category, created]);

  // warn as soon as a serial / MAC / hostname already exists
  useEffect(() => {
    const { serial_number, mac_address, hostname } = form;
    if (!serial_number.trim() && !mac_address.trim() && !hostname.trim()) return setDups([]);
    const t = setTimeout(
      () => api.assetIdCheck({ serial_number, mac_address, hostname }).then((d) => setDups(d.duplicates)).catch(() => {}),
      350
    );
    return () => clearTimeout(t);
  }, [form.serial_number, form.mac_address, form.hostname, created]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const needSerial = !NO_SERIAL_NEEDED.includes(form.category.trim().toLowerCase());

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));
    body.purchase_cost = body.purchase_cost == null ? null : Number(body.purchase_cost);
    body.warranty_months = body.warranty_months == null ? null : parseInt(body.warranty_months, 10);
    try {
      const a = await api.createAssetId(body);
      setCreated(a);
      setCopied(false);
      loadLists();
      // keep the shared purchase details, clear what is unique to one device
      setForm((f) => ({ ...f, serial_number: "", hostname: "", mac_address: "", name: "", notes: "" }));
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.asset_tag);
      setCopied(true);
    } catch {}
  };

  const text = (k, label, props = {}) => (
    <label>
      {label}
      <input value={form[k]} onChange={set(k)} {...props} />
    </label>
  );

  return (
    <>
      <div className="page-head" ref={top}>
        <div>
          <h1>Asset ID creation</h1>
          <span className="muted">
            Enter the details of a newly purchased asset. The asset ID is created automatically from its category (Laptop → L-{series.company}-0001,
            Desktop → D-{series.company}-0001 …) and the asset is added to your inventory.
          </span>
        </div>
      </div>

      {created && (
        <div className="card id-done" role="status">
          <div className="muted">Asset ID created</div>
          <div className="id-big">{created.asset_tag}</div>
          <div className="muted">
            {created.name} · {created.category}
            {created.serial_number ? ` · serial ${created.serial_number}` : ""}
          </div>
          <div className="actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn primary" onClick={copy}>
              {copied ? "Copied ✓" : "Copy ID"}
            </button>
            <Link className="btn" to={`/labels?ids=${created.id}`}>
              Print label
            </Link>
            <Link className="btn" to={`/assets/${created.id}`}>
              View asset
            </Link>
            <button type="button" className="btn" onClick={() => setCreated(null)}>
              Dismiss
            </button>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            The form below keeps the category, model, supplier and purchase details so you can enter the next unit of the same purchase — just add its serial number.
          </p>
        </div>
      )}

      <form className="card form-grid" onSubmit={submit}>
        <div className="span2 id-banner">
          <div>
            <span className="muted small">Next asset ID for this category</span>
            <div className="id-big">{preview ? preview.next_id : "—"}</div>
          </div>
          <label className="id-cat">
            Category * <small className="muted">(pick one or type a new one)</small>
            <input list="idcat-list" value={form.category} onChange={set("category")} required autoComplete="off" />
            <datalist id="idcat-list">
              {meta.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>

        <h3 className="span2 section-title">Device</h3>
        {text("manufacturer", "Manufacturer *", { placeholder: "e.g. Dell" })}
        {text("model", "Model *", { placeholder: "e.g. Latitude 5440" })}
        {text("model_no", "Model no.")}
        {text("name", "Asset name", { placeholder: "Leave empty to use manufacturer + model" })}
        {text("serial_number", needSerial ? "Serial number *" : "Serial number / licence key", { required: needSerial })}
        {text("hostname", "Hostname / device name")}
        {text("mac_address", "MAC address", { placeholder: "AA:BB:CC:DD:EE:FF" })}
        <div />
        {dups.length > 0 && (
          <div className="alert span2" role="alert">
            <strong>Already registered – no new ID will be created.</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {dups.map((d) => (
                <li key={d.id}>
                  <Link to={`/assets/${d.id}`}>{d.asset_tag}</Link> ({d.name}) has the same {d.matches.join(" and ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h3 className="span2 section-title">Purchase</h3>
        {text("vendor", "Supplier / vendor")}
        {text("order_number", "PO / order number")}
        {text("purchase_date", "Purchase date", { type: "date" })}
        {text("purchase_cost", "Purchase cost (₹)", { type: "number", min: 0, step: "0.01" })}
        {text("warranty_months", "Warranty (months)", { type: "number", min: 0, step: "1" })}
        {text("warranty_expiry", "Warranty expiry (optional)", { type: "date" })}

        <h3 className="span2 section-title">Where it goes</h3>
        {text("company", "Company")}
        <label>
          Location
          <input list="idloc-list" value={form.location} onChange={set("location")} />
          <datalist id="idloc-list">
            {(meta.locations || []).map((l) => (
              <option key={l.name} value={l.name} />
            ))}
          </datalist>
        </label>
        {text("department", "Department")}
        <div />

        <h3 className="span2 section-title">Technical (optional)</h3>
        {text("os", "Operating system")}
        {text("processor", "Processor")}
        {text("ram", "RAM")}
        {text("storage", "Storage (HDD / SSD)")}
        <label className="span2">
          Notes
          <textarea rows="2" value={form.notes} onChange={set("notes")} />
        </label>

        {error && <div className="alert span2">{error}</div>}
        <div className="span2 actions">
          <button className="btn primary" disabled={busy || dups.length > 0}>
            {busy ? "Creating…" : `Create asset ID${preview ? ` (${preview.next_id})` : ""}`}
          </button>
          <button type="button" className="btn" onClick={() => { setForm(EMPTY); setError(""); setCreated(null); }}>
            Clear form
          </button>
        </div>
      </form>

      <div className="grid2">
        <div className="card flush">
          <div className="bulk-bar" style={{ padding: "16px 18px 0" }}>
            <h3 style={{ margin: 0 }}>Recently created IDs</h3>
            {recent.length > 0 && (
              <Link className="btn" to={`/labels?ids=${recent.map((r) => r.id).join(",")}`}>
                Print labels for these
              </Link>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset</th>
                <th>Serial</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/assets/${r.id}`}>{r.asset_tag}</Link>
                  </td>
                  <td>
                    {r.name}
                    <div className="muted small">{r.category}</div>
                  </td>
                  <td>{r.serial_number || "—"}</td>
                  <td className="muted small">
                    {r.created_by}
                    <br />
                    {fmtTime(r.created_at + "Z")}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan="4" className="muted center">
                    No IDs created here yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>ID series by category</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Format: <code>letter-{series.company}-number</code>. A number is never used twice. A new category gets its own letter automatically.
          </p>
          <table className="series-table">
            <tbody>
              {series.series.map((s) => (
                <tr key={s.category}>
                  <td>{s.category}</td>
                  <td>
                    <code>{s.prefix}-</code>
                  </td>
                  <td className="muted">next {s.next_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
