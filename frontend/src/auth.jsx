import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    setToken(res.access_token);
    setUser(res.user);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const isStaff = user && (user.role === "admin" || user.role === "technician");
  const isAdmin = user && user.role === "admin";

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isStaff, isAdmin }}>{children}</AuthContext.Provider>
  );
}
