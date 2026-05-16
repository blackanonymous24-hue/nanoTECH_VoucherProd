const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type RouterConnectionTestResult = {
  success: boolean;
  message: string;
  routerBoard?: string | null;
  version?: string | null;
};

/** Libellé court pour badge / liste (erreur détaillée, pas « Hors ligne » générique). */
export function routerConnectionStatusShortLabel(result: {
  success: boolean;
  message?: string;
}): string {
  if (result.success) return "En ligne";
  const msg = result.message?.trim();
  if (!msg) return "Échec API";
  if (msg.length <= 48) return msg;
  return `${msg.slice(0, 45)}…`;
}

/**
 * Ping TCP sur le port API (`GET /routers/:id/ping`) — même principe que Mikhmon (fsockopen).
 * Rapide (souvent < 200 ms si joignable) ; ne vérifie pas identifiants ni commandes RouterOS.
 */
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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const errMsg = body.error?.trim();
      return {
        success: false,
        message: errMsg && errMsg.length > 0 ? errMsg : "Impossible de contacter le routeur",
      };
    }
    const data = (await res.json()) as { success?: boolean };
    const ok = data.success === true;
    return {
      success: ok,
      message: ok ? "En ligne" : "Impossible de contacter le routeur",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Erreur réseau",
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
