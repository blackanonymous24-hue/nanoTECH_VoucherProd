import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import { pingRouterTcpApi, ROUTER_OFFLINE_LABEL } from "@/lib/router-connection-test";

/**
 * Ping TCP (`/ping?force=1`) avant connexion (3 tentatives courtes), toujours un test réel sans cache.
 * Style Mikhmon : le port API suffit pour « en ligne » ; pas de login RouterOS ici.
 * Chaque échec affiche un toast 3 s. Après 3 échecs, le routeur est quand même sélectionné
 * mais `isPingFailed` est levé pour afficher la page d'erreur MikroTik sur le tableau de bord.
 *
 * Utilisé par le **sélecteur** (Layout) et la connexion rapide (Super administrateurs) : uniquement `GET /api/routers/:id/ping?force=1`.
 *
 * `opts.routerData` — données minimales du routeur (id + name) à stocker
 *   comme "routeur emprunté" quand le super-admin se connecte au routeur
 *   d'un autre tenant depuis la page Administrateurs.
 */
export function useSelectRouterWithPing() {
  const { setSelectedRouterId, setIsPingFailed, setBorrowedRouter, setRouterOnline } = useRouterContext();
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
      setIsPingFailed(false);

      let success = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        const data = await pingRouterTcpApi(id, token, { force: true });
        if (data.success) {
          success = true;
          break;
        }

        toast.error(ROUTER_OFFLINE_LABEL, {
          duration: 3000,
          id: "router-ping-fail",
        });

        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      activeRef.current = false;
      setPingingId(null);
      setSelectedRouterId(id);
      /** Pastille du sélecteur : reflète tout de suite le ping TCP (avant dashboard / SSE). */
      setRouterOnline(success);

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
    [token, setSelectedRouterId, setIsPingFailed, setBorrowedRouter, setRouterOnline, navigate],
  );

  return { selectWithPing, pingingId };
}
