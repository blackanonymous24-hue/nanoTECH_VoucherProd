/** Clés partagées entre onglets (localStorage = même origine pour tous les onglets). */
export const SESSION_LAST_ACTIVITY_LS_KEY = "vouchernet_last_activity_ts";
export const SESSION_LOGOUT_BROADCAST_LS_KEY = "vouchernet_session_logout_broadcast";
export const AUTH_TOKEN_LS_KEY = "vouchernet_admin_token";

export function readSharedLastActivityTs(): number {
  try {
    const raw = localStorage.getItem(SESSION_LAST_ACTIVITY_LS_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeSharedLastActivityTs(ts: number): void {
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_LS_KEY, String(ts));
  } catch {
    /* quota / mode privé */
  }
}

export function broadcastSessionLogout(): void {
  try {
    localStorage.setItem(SESSION_LOGOUT_BROADCAST_LS_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

export function readSessionLogoutBroadcastTs(): number {
  try {
    const raw = localStorage.getItem(SESSION_LOGOUT_BROADCAST_LS_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
