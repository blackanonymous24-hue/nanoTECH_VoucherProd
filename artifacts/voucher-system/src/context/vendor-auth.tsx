import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface VendorSession {
  id: number;
  name: string;
  phone: string;
  status: string;
}

interface VendorAuthContextValue {
  vendor: VendorSession | null;
  login: (session: VendorSession) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const STORAGE_KEY = "vendor_session";

function loadSession(): VendorSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const VendorAuthContext = createContext<VendorAuthContextValue>({
  vendor: null,
  login: () => {},
  logout: () => {},
  isLoggedIn: false,
});

export function VendorAuthProvider({ children }: { children: ReactNode }) {
  const [vendor, setVendor] = useState<VendorSession | null>(loadSession);

  const login = useCallback((session: VendorSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setVendor(session);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setVendor(null);
  }, []);

  return (
    <VendorAuthContext.Provider value={{ vendor, login, logout, isLoggedIn: vendor !== null }}>
      {children}
    </VendorAuthContext.Provider>
  );
}

export function useVendorAuth() {
  return useContext(VendorAuthContext);
}
