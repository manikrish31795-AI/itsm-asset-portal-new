import React from "react";
import { NavLink, Navigate, Route, Routes, Outlet } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Assets from "./pages/Assets.jsx";
import AssetForm from "./pages/AssetForm.jsx";
import AssetDetail from "./pages/AssetDetail.jsx";
import ImportAssets from "./pages/ImportAssets.jsx";
import Allocation from "./pages/Allocation.jsx";
import Audits from "./pages/Audits.jsx";
import AuditDetail from "./pages/AuditDetail.jsx";
import Users from "./pages/Users.jsx";

function Protected({ roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/assets" replace />;
  return <Layout />;
}

function Layout() {
  const { user, logout, isStaff, isAdmin } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">▣</span> AssetDesk
        </div>
        <nav>
          {isStaff && <NavLink to="/dashboard">Dashboard</NavLink>}
          <NavLink to="/assets">Assets</NavLink>
          {isStaff && <NavLink to="/allocation">Allocation</NavLink>}
          {isStaff && <NavLink to="/audits">Audit</NavLink>}
          {isAdmin && <NavLink to="/users">Users</NavLink>}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{user.full_name}</strong>
            <span className="badge">{user.role}</span>
          </div>
          <button className="btn ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  const home = user && (user.role === "requester" ? "/assets" : "/dashboard");
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login />} />
      <Route element={<Protected roles={["admin", "technician"]} />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assets/new" element={<AssetForm />} />
        <Route path="/assets/import" element={<ImportAssets />} />
        <Route path="/allocation" element={<Allocation />} />
        <Route path="/audits" element={<Audits />} />
        <Route path="/audits/:id" element={<AuditDetail />} />
        <Route path="/assets/:id/edit" element={<AssetForm />} />
      </Route>
      <Route element={<Protected roles={["admin"]} />}>
        <Route path="/users" element={<Users />} />
      </Route>
      <Route element={<Protected />}>
        <Route path="/assets" element={<Assets />} />
        <Route path="/assets/:id" element={<AssetDetail />} />
      </Route>
      <Route path="*" element={<Navigate to={home || "/login"} replace />} />
    </Routes>
  );
}
