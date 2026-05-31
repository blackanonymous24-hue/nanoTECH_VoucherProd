import { pingRouterTcpApi } from "@/lib/router-connection-test";

export const MIKHMON_PING_MAX_ATTEMPTS = 3;
export const MIKHMON_PING_RETRY_GAP_MS = 400;

/** Sélecteur sidebar : 1 ping, puis ×2 vérifications si échec avant hors ligne. */
export async function pingRouterMikhmonSelectorVerify(
  routerId: number,
  token: string | null | undefined,
  onRetry?: (attempt: number) => void,
): Promise<boolean> {
  const first = await pingRouterTcpApi(routerId, token, { force: true });
  if (first.success) return true;

  for (let attempt = 2; attempt <= MIKHMON_PING_MAX_ATTEMPTS; attempt++) {
    onRetry?.(attempt);
    await new Promise((r) => setTimeout(r, MIKHMON_PING_RETRY_GAP_MS));
    const result = await pingRouterTcpApi(routerId, token, { force: true });
    if (result.success) return true;
  }
  return false;
}

/** Ping TCP unique (page Routeurs, surveillance, etc.). */
export async function pingRouterMikhmonOnce(
  routerId: number,
  token: string | null | undefined,
): Promise<boolean> {
  const result = await pingRouterTcpApi(routerId, token, { force: true });
  return result.success;
}

/** @deprecated Utiliser pingRouterMikhmonSelectorVerify ou pingRouterMikhmonOnce. */
export async function pingRouterMikhmonForConnect(
  routerId: number,
  token: string | null | undefined,
  onRetry?: (attempt: number) => void,
): Promise<boolean> {
  return pingRouterMikhmonSelectorVerify(routerId, token, onRetry);
}

/** Ping TCP MikHmon : 3 tentatives consécutives (fsockopen ~3 s chacune). */
export async function pingRouterMikhmonSequence(
  routerId: number,
  token: string | null | undefined,
  onAttempt?: (attempt: number) => void,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MIKHMON_PING_MAX_ATTEMPTS; attempt++) {
    onAttempt?.(attempt);
    const result = await pingRouterTcpApi(routerId, token, { force: true });
    if (result.success) return true;
    if (attempt < MIKHMON_PING_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, MIKHMON_PING_RETRY_GAP_MS));
    }
  }
  return false;
}
