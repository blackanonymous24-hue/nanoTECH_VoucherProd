import { createContext, useContext, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import { abortAllApiRequests } from "@/lib/installAuthFetch";
import { getListRoutersQueryKey } from "@workspace/api-client-react";

const TOKEN_KEY           = "vouchernet_admin_token";
const ROLE_KEY            = "vouchernet_role";
const VENDOR_KEY          = "vouchernet_vendor_info";
const ROUTER_KEY          = "vouchernet_router_id";
const MGR_ROUTER_KEY      = "vouchernet_manager_router_id";
const COLLAB_ROUTER_IDS   = "vouchernet_collab_router_ids";
const SUPER_ADMIN_KEY     = "vouchernet_is_super_admin";
const CONNECTED_NAME_KEY  = "vouchernet_connected_name";

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
  connectedName: string | null;
  login: (token: string, role: UserRole, vendorInfo?: VendorInfo, managerRouterId?: number | null, collaborateurRouterIds?: number[], remember?: boolean, isSuperAdmin?: boolean, connectedName?: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  role: null,
  vendorInfo: null,
  managerRouterId: null,
  collaborateurRouterIds: [],
  isSuperAdmin: false,
  isAuthenticated: false,
  connectedName: null,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
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
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(() => readKey(SUPER_ADMIN_KEY) === "1");
  const [connectedName, setConnectedName] = useState<string | null>(() => readKey(CONNECTED_NAME_KEY));

  const login = (
    t: string,
    r: UserRole,
    vi?: VendorInfo,
    mgrRouterId?: number | null,
    collabRouterIds?: number[],
    remember = true,
    superAdmin = false,
    name?: string | null,
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

    // Only admin tokens can be super-admin; defensively force false for others.
    const effectiveSuper = r === "admin" && superAdmin;
    if (effectiveSuper) writeKey(SUPER_ADMIN_KEY, "1", remember);
    else removeKey(SUPER_ADMIN_KEY);

    if (name) writeKey(CONNECTED_NAME_KEY, name, remember);
    else removeKey(CONNECTED_NAME_KEY);

    setToken(t);
    setRole(r);
    setVendorInfo(vi ?? null);
    setManagerRouterId(r === "manager" && mgrRouterId != null ? mgrRouterId : null);
    setCollaborateurRouterIds(r === "collaborateur" && collabRouterIds ? collabRouterIds : []);
    setIsSuperAdmin(effectiveSuper);
    setConnectedName(name ?? null);

    // La clé React Query pour GET /routers ne dépend pas du tenant : invalider
    // pour éviter d'afficher la liste du compte précédent (ex. super admin).
    if (r === "admin" || r === "manager" || r === "collaborateur") {
      void queryClient.invalidateQueries({ queryKey: getListRoutersQueryKey() });
    }
  };

  const logout = () => {
    abortAllApiRequests();
    void queryClient.cancelQueries();
    queryClient.clear();

    removeKey(TOKEN_KEY);
    removeKey(ROLE_KEY);
    removeKey(VENDOR_KEY);
    removeKey(ROUTER_KEY);
    removeKey(MGR_ROUTER_KEY);
    removeKey(COLLAB_ROUTER_IDS);
    removeKey(SUPER_ADMIN_KEY);
    removeKey(CONNECTED_NAME_KEY);
    setToken(null);
    setRole(null);
    setVendorInfo(null);
    setManagerRouterId(null);
    setCollaborateurRouterIds([]);
    setIsSuperAdmin(false);
    setConnectedName(null);
  };

  return (
    <AuthContext.Provider value={{
      token, role, vendorInfo, managerRouterId, collaborateurRouterIds,
      isSuperAdmin,
      isAuthenticated: !!token, login, logout,
      connectedName,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
