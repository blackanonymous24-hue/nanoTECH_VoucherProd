import { pingRouterTcpApi } from "@/lib/router-connection-test";

export const MIKHMON_PING_MAX_ATTEMPTS = 3;
export const MIKHMON_PING_RETRY_GAP_MS = 400;

/** Connexion UI : 1 ping TCP (~200 ms si en ligne), puis ×2 seulement si échec. */
export async function pingRouterMikhmonForConnect(
  routerId: number,
  token: string | null | undefined,
  onRetry?: (attempt: number) => void,
): Promise<boolean> {
  onRetry?.(1);
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
