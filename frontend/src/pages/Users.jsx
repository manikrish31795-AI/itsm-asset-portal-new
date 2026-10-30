import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "requester" });
  const [error, setError] = useState("");

  const load = () => api.users().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const add = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.createUser(form);
      setForm({ email: "", full_name: "", password: "", role: "requester" });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const patch = async (u, body) => {
    setError("");
    try {
      await api.updateUser(u.id, body);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
      </div>
      {error && <div className="alert">{error}</div>}
      <form className="card inline-form" onSubmit={add}>
        <input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" placeholder="Password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="requester">Requester</option>
          <option value="technician">Technician</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn primary">Add user</button>
      </form>
      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u, { role: e.target.value })}>
                    <option value="requester">Requester</option>
                    <option value="technician">Technician</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={u.is_active} disabled={u.id === me.id} onChange={(e) => patch(u, { is_active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
