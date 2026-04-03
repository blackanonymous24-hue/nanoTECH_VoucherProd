import { createContext, useContext, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";

const TOKEN_KEY    = "vouchernet_admin_token";
const ROLE_KEY     = "vouchernet_role";
const VENDOR_KEY   = "vouchernet_vendor_info";
const ROUTER_KEY   = "vouchernet_router_id";

export type UserRole = "admin" | "manager" | "vendor";
export type VendorInfo = { id: number; name: string; email: string | null; username: string };

interface AuthContextValue {
  token: string | null;
  role: UserRole | null;
  vendorInfo: VendorInfo | null;
  isAuthenticated: boolean;
  login: (token: string, role: UserRole, vendorInfo?: VendorInfo) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  role: null,
  vendorInfo: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token,      setToken]      = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [role,       setRole]       = useState<UserRole | null>(() => (localStorage.getItem(ROLE_KEY) as UserRole | null));
  const [vendorInfo, setVendorInfo] = useState<VendorInfo | null>(() => {
    try { const v = localStorage.getItem(VENDOR_KEY); return v ? JSON.parse(v) : null; }
    catch { return null; }
  });

  const login = (t: string, r: UserRole, vi?: VendorInfo) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(ROLE_KEY, r);
    if (vi) localStorage.setItem(VENDOR_KEY, JSON.stringify(vi));
    else     localStorage.removeItem(VENDOR_KEY);
    localStorage.removeItem(ROUTER_KEY);
    setToken(t);
    setRole(r);
    setVendorInfo(vi ?? null);
  };

  const logout = () => {
    // Stop all in-flight & scheduled React Query requests immediately
    // (avoids unnecessary CPU load on MikroTik while no user is logged in)
    void queryClient.cancelQueries();
    queryClient.clear();

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(VENDOR_KEY);
    localStorage.removeItem(ROUTER_KEY);
    setToken(null);
    setRole(null);
    setVendorInfo(null);
  };

  return (
    <AuthContext.Provider value={{ token, role, vendorInfo, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
