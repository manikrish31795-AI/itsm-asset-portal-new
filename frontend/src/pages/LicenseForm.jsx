import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";

const EMPTY = {
  name: "", publisher: "", license_type: "Subscription", seats: "1", license_key: "", vendor: "", order_number: "",
  purchase_date: "", purchase_cost: "", renewal_date: "", status: "active", notes: "",
};

export default function LicenseForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [types, setTypes] = useState(["Subscription", "Perpetual"]);
  const [used, setUsed] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.licenseMeta().then((m) => setTypes(m.types)).catch(() => {});
    if (id) {
      api
        .license(id)
        .then((l) => {
          setUsed(l.used);
          setF(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, l[k] ?? ""])));
        })
        .catch((e) => setError(e.message));
    }
  }, [id]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));
    body.seats = parseInt(f.seats, 10) || 1;
    body.purchase_cost = body.purchase_cost == null ? null : Number(body.purchase_cost);
    try {
      const saved = id ? await api.updateLicense(id, body) : await api.createLicense(body);
      nav(`/licenses/${saved.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const text = (k, label, props = {}) => (
    <label>
      {label}
      <input value={f[k]} onChange={set(k)} {...props} />
    </label>
  );

  return (
    <>
      <div className="page-head">
        <h1>{id ? "Edit licence" : "Add licence"}</h1>
        <Link className="btn" to={id ? `/licenses/${id}` : "/licenses"}>
          Cancel
        </Link>
      </div>
      <form className="card form-grid" onSubmit={submit}>
        <h3 className="span2 section-title">Software</h3>
        {text("name", "Name *", { required: true, placeholder: "e.g. Microsoft 365 E3" })}
        {text("publisher", "Publisher", { placeholder: "e.g. Microsoft" })}
        <label>
          Licence type
          <select value={f.license_type} onChange={set("license_type")}>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Seats bought *{used > 0 && <small className="muted"> ({used} in use – can't go lower)</small>}
          <input type="number" min={Math.max(1, used)} max="1000000" step="1" required value={f.seats} onChange={set("seats")} />
        </label>
        <label className="span2">
          Licence key / serial <small className="muted">(only admins and technicians can see it)</small>
          <textarea rows="2" className="mono" value={f.license_key} onChange={set("license_key")} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" />
        </label>

        <h3 className="span2 section-title">Purchase & renewal</h3>
        {text("vendor", "Supplier / reseller")}
        {text("order_number", "PO / order number")}
        {text("purchase_date", "Purchase date", { type: "date" })}
        {text("purchase_cost", "Purchase cost (₹)", { type: "number", min: 0, step: "0.01" })}
        <label>
          Renewal / expiry date <small className="muted">(leave empty if it never expires)</small>
          <input type="date" value={f.renewal_date} onChange={set("renewal_date")} />
        </label>
        {id && (
          <label>
            Status
            <select value={f.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="retired">Retired (no longer used – no alerts)</option>
            </select>
          </label>
        )}
        <label className="span2">
          Notes
          <textarea rows="3" value={f.notes} onChange={set("notes")} />
        </label>
        {error && <div className="alert span2">{error}</div>}
        <div className="span2">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save licence"}
          </button>
        </div>
      </form>
    </>
  );
}
