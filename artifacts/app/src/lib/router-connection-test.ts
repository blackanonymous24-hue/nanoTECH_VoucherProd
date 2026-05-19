const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type RouterConnectionTestResult = {
  success: boolean;
  message: string;
  routerBoard?: string | null;
  version?: string | null;
};

export const ROUTER_OFFLINE_LABEL = "Hors ligne";

/** Libellé court pour badge / liste routeurs. */
export function routerConnectionStatusShortLabel(result: {
  success: boolean;
  message?: string;
}): string {
  if (result.success) return "En ligne";
  return ROUTER_OFFLINE_LABEL;
}

/**
 * Ping TCP sur le port API (`GET /routers/:id/ping`) — même principe que Mikhmon (fsockopen).
 * Rapide (souvent < 200 ms si joignable) ; ne vérifie pas identifiants ni commandes RouterOS.
 */
/** Ping TCP pour un routeur d’un admin cible (super-admin → page Administrateurs). */
export async function pingRouterForSuperAdminTenant(
  adminId: number,
  routerId: number,
  token: string | null | undefined,
): Promise<RouterConnectionTestResult> {
  try {
    const res = await fetch(`${BASE}/api/super/admins/${adminId}/routers/${routerId}/ping`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return { success: false, message: ROUTER_OFFLINE_LABEL };
    }
    const data = (await res.json()) as { success?: boolean };
    const ok = data.success === true;
    return { success: ok, message: ok ? "En ligne" : ROUTER_OFFLINE_LABEL };
  } catch {
    return { success: false, message: ROUTER_OFFLINE_LABEL };
  }
}

export async function pingRouterTcpApi(
  routerId: number,
  token: string | null | undefined,
  options?: { force?: boolean },
): Promise<RouterConnectionTestResult> {
  const q = options?.force === true ? "?force=1" : "";
  try {
    const res = await fetch(`${BASE}/api/routers/${routerId}/ping${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      await res.json().catch(() => ({}));
      return {
        success: false,
        message: ROUTER_OFFLINE_LABEL,
      };
    }
    const data = (await res.json()) as { success?: boolean };
    const ok = data.success === true;
    return {
      success: ok,
      message: ok ? "En ligne" : ROUTER_OFFLINE_LABEL,
    };
  } catch {
    return {
      success: false,
      message: ROUTER_OFFLINE_LABEL,
    };
  }
}

/**
 * Test réel RouterOS API (login + ressources) — pas un simple TCP comme `/ping`.
 */
export async function testRouterConnectionApi(
  routerId: number,
  token: string | null | undefined,
): Promise<RouterConnectionTestResult> {
  try {
    const res = await fetch(`${BASE}/api/routers/${routerId}/test`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        success: false,
        message: body.error ?? `Erreur serveur (${res.status})`,
      };
    }
    const data = (await res.json()) as RouterConnectionTestResult;
    if (!data.success && !data.message?.trim()) {
      return { ...data, message: "Connexion API impossible" };
    }
    return data;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Erreur réseau",
    };
  }
}

export function formatRouterConnectionTestLabel(result: RouterConnectionTestResult): string {
  if (!result.success) return result.message?.trim() || "Connexion API impossible";
  const parts = [result.message || "Connexion API OK"];
  if (result.version) parts.push(`RouterOS ${result.version}`);
  return parts.join(" · ");
}
