import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Ping-avant-connexion : tente 2 fois de pinguer le routeur avant de le
 * sélectionner. Chaque échec affiche un toast 3 s. Après 2 échecs, le
 * routeur est quand même sélectionné mais `isPingFailed` est levé pour que
 * le tableau de bord affiche la page d'erreur.
 *
 * `opts.routerData` — données minimales du routeur (id + name) à stocker
 *   comme "routeur emprunté" quand le super-admin se connecte au routeur
 *   d'un autre tenant depuis la page Administrateurs.
 */
export function useSelectRouterWithPing() {
  const { setSelectedRouterId, setIsPingFailed, setBorrowedRouter } = useRouterContext();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [pingingId, setPingingId] = useState<number | null>(null);
  const activeRef = useRef(false);

  const selectWithPing = useCallback(
    async (
      id: number,
      opts?: { navigateTo?: string | false; routerData?: BorrowedRouter | null },
    ) => {
      if (activeRef.current) return;
      activeRef.current = true;
      setPingingId(id);

      let success = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`${BASE}/api/routers/${id}/ping?force=1`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const data = (await res.json()) as { success: boolean };
            if (data.success) {
              success = true;
              break;
            }
          }
        } catch {}

        toast.error("Impossible de se connecter au Router !", {
          description: "Nouvelle tentative en cours...",
          duration: 3000,
          id: "router-ping-fail",
        });

        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      activeRef.current = false;
      setPingingId(null);
      setSelectedRouterId(id);

      if (!success) {
        setIsPingFailed(true);
      }

      // Stocker le routeur comme "emprunté" uniquement si des données sont
      // fournies (cas super-admin → routeur d'un autre tenant).
      if (opts?.routerData !== undefined) {
        setBorrowedRouter(opts.routerData);
      }

      const dest = opts?.navigateTo;
      if (dest !== false) {
        navigate(dest ?? "/");
      }
    },
    [token, setSelectedRouterId, setIsPingFailed, setBorrowedRouter, navigate],
  );

  return { selectWithPing, pingingId };
}
