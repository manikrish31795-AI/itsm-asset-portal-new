import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";

const TEXT_FIELDS = [
  "asset_tag", "name", "category", "status", "company", "manufacturer", "model", "model_no", "serial_number",
  "hostname", "location", "department", "assigned_to_id", "assigned_username", "employee_no", "manager", "job_title",
  "vendor", "order_number", "purchase_date", "purchase_cost", "warranty_months", "warranty_expiry", "eol_date",
  "allocated_date", "mac_address", "ip_address", "os", "processor", "ram", "storage", "notes",
];
const EMPTY = Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""]));
EMPTY.category = "Laptop";
EMPTY.status = "In Stock";

export default function AssetForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [extras, setExtras] = useState([]); // [{k, v}] additional details
  const [meta, setMeta] = useState({ categories: [], statuses: [], locations: [] });
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.assetMeta().then(setMeta);
    api.users().then(setUsers).catch(() => {});
    if (id) {
      api
        .asset(id)
        .then((a) => {
          const f = { ...EMPTY };
          TEXT_FIELDS.forEach((k) => (f[k] = a[k] ?? ""));
          setForm(f);
          setExtras(Object.entries(a.attributes || {}).map(([k, v]) => ({ k, v })));
        })
        .catch((e) => setError(e.message));
    }
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setExtra = (i, key, val) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, [key]: val } : x)));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    // empty strings -> null so the API stores clean values
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
    ["purchase_cost"].forEach((k) => body[k] != null && (body[k] = Number(body[k])));
    ["warranty_months", "assigned_to_id"].forEach((k) => body[k] != null && (body[k] = parseInt(body[k], 10)));
    const attrs = {};
    extras.forEach(({ k, v }) => k.trim() && (attrs[k.trim()] = v));
    body.attributes = Object.keys(attrs).length ? attrs : null;
    try {
      const saved = id ? await api.updateAsset(id, body) : await api.createAsset(body);
      nav(`/assets/${saved.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const text = (k, label, props = {}) => (
    <label>
      {label}
      <input value={form[k]} onChange={set(k)} {...props} />
    </label>
  );
  const statuses = meta.statuses.includes(form.status) || !form.status ? meta.statuses : [...meta.statuses, form.status];

  return (
    <>
      <div className="page-head">
        <h1>{id ? "Edit asset" : "Add asset"}</h1>
        <Link className="btn" to={id ? `/assets/${id}` : "/assets"}>
          Cancel
        </Link>
      </div>
      <form className="card form-grid" onSubmit={submit}>
        <h3 className="span2 section-title">Identification</h3>
        {text("asset_tag", "Asset tag / ID *", { required: true })}
        {text("name", "Asset name *", { required: true })}
        <label>
          Category * <small className="muted">(pick one or type a new category)</small>
          <input list="category-list" value={form.category} onChange={set("category")} required />
          <datalist id="category-list">
            {meta.categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Status
          <select value={form.status} onChange={set("status")}>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {text("company", "Company")}
        {text("manufacturer", "Manufacturer")}
        {text("model", "Model")}
        {text("model_no", "Model no.")}
        {text("serial_number", "Serial number")}
        {text("hostname", "Hostname / device name")}

        <h3 className="span2 section-title">Location & assignment</h3>
        <label>
          Location <small className="muted">(pick one or type a new location)</small>
          <input list="location-list" value={form.location} onChange={set("location")} />
          <datalist id="location-list">
            {(meta.locations || []).map((l) => (
              <option key={l.name} value={l.name} />
            ))}
          </datalist>
        </label>
        {text("department", "Department")}
        <label>
          Assigned to (portal user)
          <select value={form.assigned_to_id} onChange={set("assigned_to_id")}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>
        {text("assigned_username", "Username (if not a portal user)")}
        {text("employee_no", "Employee no.")}
        {text("manager", "Manager")}
        {text("job_title", "Job title")}
        {text("allocated_date", "Allocated on", { type: "date" })}

        <h3 className="span2 section-title">Purchase & warranty</h3>
        {text("vendor", "Supplier / vendor")}
        {text("order_number", "Order number")}
        {text("purchase_date", "Purchase date", { type: "date" })}
        {text("purchase_cost", "Purchase cost (₹)", { type: "number", min: 0, step: "0.01" })}
        {text("warranty_months", "Warranty (months)", { type: "number", min: 0, step: "1" })}
        {text("warranty_expiry", "Warranty expiry", { type: "date" })}
        {text("eol_date", "End of life (EOL)", { type: "date" })}

        <h3 className="span2 section-title">Technical</h3>
        {text("mac_address", "MAC address")}
        {text("ip_address", "IP address")}
        {text("os", "Operating system")}
        {text("processor", "Processor")}
        {text("ram", "RAM")}
        {text("storage", "Storage (HDD / SSD)")}

        <h3 className="span2 section-title">Additional details</h3>
        <div className="span2">
          <p className="muted kv-help">
            Anything specific to this kind of asset, e.g. Antivirus, SwitchPort, Printer Type, Monitor Size, WIFI-SSID.
          </p>
          {extras.map((x, i) => (
            <div className="kv-row" key={i}>
              <input placeholder="Name (e.g. Antivirus)" value={x.k} onChange={(e) => setExtra(i, "k", e.target.value)} />
              <input placeholder="Value" value={x.v} onChange={(e) => setExtra(i, "v", e.target.value)} />
              <button type="button" className="btn" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setExtras((xs) => [...xs, { k: "", v: "" }])}>
            + Add detail
          </button>
        </div>

        <label className="span2">
          Notes
          <textarea rows="3" value={form.notes} onChange={set("notes")} />
        </label>
        {error && <div className="alert span2">{error}</div>}
        <div className="span2">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save asset"}
          </button>
        </div>
      </form>
    </>
  );
}
