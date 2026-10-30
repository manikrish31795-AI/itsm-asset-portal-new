const TOKEN_KEY = "itsm_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = "GET", body, form, formData, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = new URLSearchParams(form);
  } else if (formData) {
    payload = formData; // browser sets the multipart Content-Type itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && token) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(msg);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== "" && v != null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", form: { username: email, password } }),
  me: () => request("/auth/me"),
  dashboard: () => request("/dashboard"),
  assetMeta: () => request("/assets/meta"),
  assets: (params) => request(`/assets${qs(params)}`),
  asset: (id) => request(`/assets/${id}`),
  createAsset: (body) => request("/assets", { method: "POST", body }),
  updateAsset: (id, body) => request(`/assets/${id}`, { method: "PUT", body }),
  deleteAsset: (id) => request(`/assets/${id}`, { method: "DELETE" }),
  exportCsv: async (params) => {
    const res = await request(`/assets/export.csv${qs(params)}`, { raw: true });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "assets.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importAssets: (file, { onDuplicate = "skip", dryRun = false } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/assets/import${qs({ on_duplicate: onDuplicate, dry_run: dryRun ? "true" : "false" })}`, {
      method: "POST",
      formData: fd,
    });
  },
  downloadImportTemplate: async () => {
    const res = await request("/assets/import-template.csv", { raw: true });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "asset-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
  allocations: (params) => request(`/allocations${qs(params)}`),
  allocationPeople: (params) => request(`/allocations/people${qs(params)}`),
  availableAssets: (q) => request(`/allocations/available${qs({ q })}`),
  allocate: (body) => request("/allocations", { method: "POST", body }),
  returnAssets: (body) => request("/allocations/return", { method: "POST", body }),
  exportAllocationsCsv: async (params) => {
    const res = await request(`/allocations/export.csv${qs(params)}`, { raw: true });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "allocations.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
  audits: (params) => request(`/audits${qs(params || {})}`),
  audit: (id) => request(`/audits/${id}`),
  auditPreview: (body) => request("/audits/preview", { method: "POST", body }),
  createAudit: (body) => request("/audits", { method: "POST", body }),
  deleteAudit: (id) => request(`/audits/${id}`, { method: "DELETE" }),
  auditItems: (id, params) => request(`/audits/${id}/items${qs(params)}`),
  updateAuditItem: (id, itemId, body) => request(`/audits/${id}/items/${itemId}`, { method: "PUT", body }),
  bulkAuditItems: (id, body) => request(`/audits/${id}/items/bulk`, { method: "POST", body }),
  scanAudit: (id, body) => request(`/audits/${id}/scan`, { method: "POST", body }),
  closeAudit: (id, body) => request(`/audits/${id}/close`, { method: "POST", body }),
  auditsOfAsset: (assetId) => request(`/audits/asset/${assetId}`),
  exportAuditCsv: async (id) => {
    const res = await request(`/audits/${id}/export.csv`, { raw: true });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (res.headers.get("content-disposition") || "").match(/filename=(.+)/)?.[1] || "audit.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
  users: () => request("/users"),
  createUser: (body) => request("/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: "PATCH", body }),
};
