import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import { abortAllApiRequests } from "@/lib/installAuthFetch";
import { clearAllSavedPrintLots } from "@/lib/voucher-print-lot-persist";
import { getListRoutersQueryKey, VOUCHERNET_SESSION_REVOKED_EVENT } from "@workspace/api-client-react";
import { useAppNavigate } from "@/hooks/use-app-navigate";

const TOKEN_KEY           = "vouchernet_admin_token";
const ROLE_KEY            = "vouchernet_role";
const VENDOR_KEY          = "vouchernet_vendor_info";
const ROUTER_KEY          = "vouchernet_router_id";
const MGR_ROUTER_KEY      = "vouchernet_manager_router_id";
const COLLAB_ROUTER_IDS   = "vouchernet_collab_router_ids";
const SUPER_ADMIN_KEY     = "vouchernet_is_super_admin";
const CONNECTED_NAME_KEY  = "vouchernet_connected_name";
const CONNECTED_USER_KEY  = "vouchernet_connected_username";

function readKey(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

function writeKey(key: string, value: string, remember: boolean) {
  if (remember) {
    localStorage.setItem(key, value);
    sessionStorage.removeItem(key);
  } else {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  }
}

function removeKey(key: string) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

export type UserRole = "admin" | "manager" | "vendor" | "collaborateur";
export type VendorInfo = { id: number; name: string; email: string | null; username: string };

interface AuthContextValue {
  token: string | null;
  role: UserRole | null;
  vendorInfo: VendorInfo | null;
  managerRouterId: number | null;
  collaborateurRouterIds: number[];
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
  /** Jeton en localStorage (« Se souvenir de moi »). Sur APK : pas de déconnexion idle si vrai. */
  sessionPersisted: boolean;
  connectedName: string | null;
  connectedUsername: string | null;
  login: (
    token: string,
    role: UserRole,
    vendorInfo?: VendorInfo,
    managerRouterId?: number | null,
    collaborateurRouterIds?: number[],
    remember?: boolean,
    isSuperAdmin?: boolean,
    connectedName?: string | null,
    connectedUsername?: string | null,
  ) => void;
  logout: (opts?: { skipRevoke?: boolean }) => void | Promise<void>;
  updateConnectedInfo: (info: { name?: string; username?: string }) => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  role: null,
  vendorInfo: null,
  managerRouterId: null,
  collaborateurRouterIds: [],
  isSuperAdmin: false,
  isAuthenticated: false,
  sessionPersisted: false,
  connectedName: null,
  connectedUsername: null,
  login: () => {},
  logout: () => {},
  updateConnectedInfo: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useAppNavigate();
  const [token,                  setToken]                  = useState<string | null>(() => readKey(TOKEN_KEY));
  const [role,                   setRole]                   = useState<UserRole | null>(() => (readKey(ROLE_KEY) as UserRole | null));
  const [vendorInfo,             setVendorInfo]             = useState<VendorInfo | null>(() => {
    try { const v = readKey(VENDOR_KEY); return v ? JSON.parse(v) : null; }
    catch { return null; }
  });
  const [managerRouterId,        setManagerRouterId]        = useState<number | null>(() => {
    const v = readKey(MGR_ROUTER_KEY);
    return v ? parseInt(v, 10) : null;
  });
  const [collaborateurRouterIds, setCollaborateurRouterIds] = useState<number[]>(() => {
    try { const v = readKey(COLLAB_ROUTER_IDS); return v ? JSON.parse(v) : []; }
    catch { return []; }
  });
  const [isSuperAdmin,    setIsSuperAdmin]    = useState<boolean>(() => readKey(SUPER_ADMIN_KEY) === "1");
  const [connectedName,   setConnectedName]   = useState<string | null>(() => readKey(CONNECTED_NAME_KEY));
  const [connectedUsername, setConnectedUsername] = useState<string | null>(() => readKey(CONNECTED_USER_KEY));

  // Backfill connectedName/connectedUsername for sessions created before these
  // keys were introduced (user already logged in, page refresh).
  useEffect(() => {
    const t = readKey(TOKEN_KEY);
    const r = readKey(ROLE_KEY) as UserRole | null;
    if (!t || !r || (readKey(CONNECTED_NAME_KEY) && readKey(CONNECTED_USER_KEY))) return;

    const remember = !!localStorage.getItem(TOKEN_KEY);
    const headers = { Authorization: `Bearer ${t}` };

    if (r === "admin") {
      fetch("/api/admin/me", { headers })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!data) return;
          const name     = data.displayName || data.login || null;
          const username = data.login || null;
          if (name)     { writeKey(CONNECTED_NAME_KEY, name, remember);     setConnectedName(name); }
          if (username) { writeKey(CONNECTED_USER_KEY, username, remember); setConnectedUsername(username); }
        })
        .catch(() => {});
    } else if (r === "manager") {
      fetch("/api/managers/me", { headers })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!data) return;
          const name     = data.name     || null;
          const username = data.username || null;
          if (name)     { writeKey(CONNECTED_NAME_KEY, name, remember);     setConnectedName(name); }
          if (username) { writeKey(CONNECTED_USER_KEY, username, remember); setConnectedUsername(username); }
        })
        .catch(() => {});
    } else if (r === "collaborateur") {
      fetch("/api/collaborateurs/me", { headers })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!data) return;
          const name     = data.name     || null;
          const username = data.username || null;
          if (name)     { writeKey(CONNECTED_NAME_KEY, name, remember);     setConnectedName(name); }
          if (username) { writeKey(CONNECTED_USER_KEY, username, remember); setConnectedUsername(username); }
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (
    t: string,
    r: UserRole,
    vi?: VendorInfo,
    mgrRouterId?: number | null,
    collabRouterIds?: number[],
    remember = true,
    superAdmin = false,
    name?: string | null,
    username?: string | null,
  ) => {
    writeKey(TOKEN_KEY, t, remember);
    writeKey(ROLE_KEY, r, remember);
    if (vi) writeKey(VENDOR_KEY, JSON.stringify(vi), remember);
    else     removeKey(VENDOR_KEY);

    if (r === "manager" && mgrRouterId != null) {
      writeKey(MGR_ROUTER_KEY, String(mgrRouterId), remember);
      writeKey(ROUTER_KEY, String(mgrRouterId), remember);
    } else {
      removeKey(MGR_ROUTER_KEY);
      if (r !== "manager") removeKey(ROUTER_KEY);
    }

    if (r === "collaborateur" && collabRouterIds && collabRouterIds.length > 0) {
      writeKey(COLLAB_ROUTER_IDS, JSON.stringify(collabRouterIds), remember);
    } else {
      removeKey(COLLAB_ROUTER_IDS);
    }

    const effectiveSuper = r === "admin" && superAdmin;
    if (effectiveSuper) writeKey(SUPER_ADMIN_KEY, "1", remember);
    else removeKey(SUPER_ADMIN_KEY);

    if (name) writeKey(CONNECTED_NAME_KEY, name, remember);
    else removeKey(CONNECTED_NAME_KEY);

    if (username) writeKey(CONNECTED_USER_KEY, username, remember);
    else removeKey(CONNECTED_USER_KEY);

    setToken(t);
    setRole(r);
    setVendorInfo(vi ?? null);
    setManagerRouterId(r === "manager" && mgrRouterId != null ? mgrRouterId : null);
    setCollaborateurRouterIds(r === "collaborateur" && collabRouterIds ? collabRouterIds : []);
    setIsSuperAdmin(effectiveSuper);
    setConnectedName(name ?? null);
    setConnectedUsername(username ?? null);

    if (r === "admin" || r === "manager" || r === "collaborateur") {
      void queryClient.invalidateQueries({ queryKey: getListRoutersQueryKey() });
    }
  };

  const logout = useCallback(async (opts?: { skipRevoke?: boolean }) => {
    const previousRole = role;
    const t = readKey(TOKEN_KEY);
    if (!opts?.skipRevoke && t) {
      try {
        await fetch("/api/session/revoke", {
          method: "POST",
          headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        });
      } catch {
        /* réseau : on déconnecte quand même côté client */
      }
    }
    abortAllApiRequests();
    void queryClient.cancelQueries();
    queryClient.clear();
    clearAllSavedPrintLots();

    removeKey(TOKEN_KEY);
    removeKey(ROLE_KEY);
    removeKey(VENDOR_KEY);
    removeKey(ROUTER_KEY);
    removeKey(MGR_ROUTER_KEY);
    removeKey(COLLAB_ROUTER_IDS);
    removeKey(SUPER_ADMIN_KEY);
    removeKey(CONNECTED_NAME_KEY);
    removeKey(CONNECTED_USER_KEY);
    setToken(null);
    setRole(null);
    setVendorInfo(null);
    setManagerRouterId(null);
    setCollaborateurRouterIds([]);
    setIsSuperAdmin(false);
    setConnectedName(null);
    setConnectedUsername(null);

    if (previousRole === "vendor") {
      navigate("/vendeur");
    } else if (previousRole) {
      navigate("/admin");
    }
  }, [role, navigate]);

  useEffect(() => {
    const onRevoked = () => {
      void logout({ skipRevoke: true });
    };
    window.addEventListener(VOUCHERNET_SESSION_REVOKED_EVENT, onRevoked);
    return () => window.removeEventListener(VOUCHERNET_SESSION_REVOKED_EVENT, onRevoked);
  }, [logout]);

  const updateConnectedInfo = (info: { name?: string; username?: string }) => {
    const remember = !!localStorage.getItem(TOKEN_KEY);
    if (info.name !== undefined) {
      setConnectedName(info.name);
      if (info.name) writeKey(CONNECTED_NAME_KEY, info.name, remember);
      else removeKey(CONNECTED_NAME_KEY);
    }
    if (info.username !== undefined) {
      setConnectedUsername(info.username);
      if (info.username) writeKey(CONNECTED_USER_KEY, info.username, remember);
      else removeKey(CONNECTED_USER_KEY);
    }
  };

  let sessionPersisted = false;
  try {
    sessionPersisted = Boolean(token && localStorage.getItem(TOKEN_KEY));
  } catch {
    sessionPersisted = false;
  }

  return (
    <AuthContext.Provider value={{
      token, role, vendorInfo, managerRouterId, collaborateurRouterIds,
      isSuperAdmin, isAuthenticated: !!token, sessionPersisted, login, logout,
      connectedName, connectedUsername, updateConnectedInfo,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
