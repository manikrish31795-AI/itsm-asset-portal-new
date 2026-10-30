import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { statusClass } from "./Assets.jsx";

const money = (n) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : null);

const sections = (a) => [
  [
    "Identification",
    [
      ["Category", a.category],
      ["Company", a.company],
      ["Manufacturer", a.manufacturer],
      ["Model", a.model],
      ["Model no.", a.model_no],
      ["Serial number", a.serial_number],
      ["Hostname", a.hostname],
    ],
  ],
  [
    "Location & assignment",
    [
      ["Location", a.location],
      ["Department", a.department],
      ["Assigned to", a.assigned_to?.full_name || a.assigned_username],
      ["Employee no.", a.employee_no],
      ["Manager", a.manager],
      ["Job title", a.job_title],
      ["Allocated on", a.allocated_date],
    ],
  ],
  [
    "Purchase & warranty",
    [
      ["Supplier", a.vendor],
      ["Order number", a.order_number],
      ["Purchase date", a.purchase_date],
      ["Purchase cost", money(a.purchase_cost)],
      ["Warranty (months)", a.warranty_months],
      ["Warranty expiry", a.warranty_expiry],
      ["End of life", a.eol_date],
    ],
  ],
  [
    "Technical",
    [
      ["MAC address", a.mac_address],
      ["IP address", a.ip_address],
      ["Operating system", a.os],
      ["Processor", a.processor],
      ["RAM", a.ram],
      ["Storage", a.storage],
    ],
  ],
];

export default function AssetDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isStaff, isAdmin } = useAuth();
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState("");
  const [allocs, setAllocs] = useState([]);
  const [audits, setAudits] = useState([]);

  useEffect(() => {
    api.asset(id).then(setAsset).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!isStaff) return;
    api.allocations({ asset_id: id, page_size: 50 }).then((d) => setAllocs(d.items)).catch(() => {});
  }, [id, isStaff]);

  useEffect(() => {
    if (!isStaff) return;
    api.auditsOfAsset(id).then(setAudits).catch(() => {});
  }, [id, isStaff]);

  const remove = async () => {
    if (!window.confirm(`Delete asset ${asset.asset_tag}? This cannot be undone.`)) return;
    try {
      await api.deleteAsset(id);
      nav("/assets");
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="alert">{error}</div>;
  if (!asset) return <div className="muted">Loading…</div>;

  const extras = Object.entries(asset.attributes || {});

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/assets" className="muted">
            ← Assets
          </Link>
          <h1>
            {asset.name} <span className={statusClass(asset.status)}>{asset.status}</span>
          </h1>
          <span className="muted">{asset.asset_tag}</span>
        </div>
        {isStaff && (
          <div className="actions">
            <Link className="btn" to={`/assets/${id}/edit`}>
              Edit
            </Link>
            {isAdmin && (
              <button className="btn danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid2">
        <div>
          {sections(asset).map(([title, fields]) => {
            const shown = fields.filter(([, v]) => v !== null && v !== undefined && v !== "");
            if (!shown.length) return null;
            return (
              <div className="card" key={title}>
                <h3>{title}</h3>
                <dl className="details">
                  {shown.map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            );
          })}
          {extras.length > 0 && (
            <div className="card">
              <h3>Additional details</h3>
              <dl className="details">
                {extras.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}
          {asset.notes && (
            <div className="card">
              <h3>Notes</h3>
              <p>{asset.notes}</p>
            </div>
          )}
        </div>
        <div>
        {allocs.length > 0 && (
          <div className="card">
            <h3>Allocation history</h3>
            <ul className="timeline">
              {allocs.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.assignee_name}</strong>
                    {a.employee_no ? ` (${a.employee_no})` : ""}
                  </div>
                  <small className="muted">
                    {a.allocated_on} → {a.returned_on || "now"}
                    {a.return_status ? ` · returned as ${a.return_status}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isStaff && (
          <div className="card">
            <h3>Audit history</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Last audited: {asset.last_audited_on || "never"}
              {asset.next_audit_date ? ` · next due ${asset.next_audit_date}` : ""}
            </p>
            {audits.length === 0 ? (
              <span className="muted">Not part of any audit yet</span>
            ) : (
              <ul className="timeline">
                {audits.map((a) => (
                  <li key={a.audit_id}>
                    <div>
                      <Link to={`/audits/${a.audit_id}`}>{a.audit_name}</Link>{" "}
                      <span className={`pill res-${a.result}`}>
                        {a.result === "pending" ? "Not checked" : a.result === "moved" ? `Found at ${a.found_location}` : a.result === "found" ? "Found" : "Missing"}
                      </span>
                    </div>
                    <small className="muted">
                      {a.audit_status === "open" ? "In progress" : "Closed"}
                      {a.audited_by ? ` · ${a.audited_by}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="card">
          <h3>History</h3>
          <ul className="timeline">
            {asset.history.map((h) => (
              <li key={h.id}>
                <div>{h.action}</div>
                <small className="muted">
                  {h.performed_by} · {new Date(h.created_at + "Z").toLocaleString()}
                </small>
              </li>
            ))}
          </ul>
        </div>
        </div>
      </div>
    </>
  );
}
