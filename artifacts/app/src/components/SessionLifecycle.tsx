import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { setApiRequestPause } from "@/lib/installAuthFetch";
import { queryClient } from "@/lib/queryClient";
import {
  AUTH_TOKEN_LS_KEY,
  broadcastSessionLogout,
  readSessionLogoutBroadcastTs,
  readSharedLastActivityTs,
  SESSION_LOGOUT_BROADCAST_LS_KEY,
  writeSharedLastActivityTs,
} from "@/lib/session-cross-tab";

/**
 * Cycle de vie session — périmètre :
 *
 * • Web : déconnexion idle après {@link SESSION_IDLE_LOGOUT_MS} ; pause API après
 *   {@link TAB_HIDE_API_PAUSE_GRACE_MS} si l’onglet est masqué ou l’app réduite (visibility hidden).
 *
 * • APK avec « Se souvenir de moi » : aucune déconnexion idle ; pause API immédiate en arrière-plan.
 *   APK sans « Se souvenir de moi » : déconnexion après {@link SESSION_IDLE_LOGOUT_MS}.
 */
/** Déconnexion auto après inactivité (web et APK sans « Se souvenir de moi » sur APK). */
export const SESSION_IDLE_LOGOUT_MS = 30 * 60 * 1000;
/** Alias historique — même délai que {@link SESSION_IDLE_LOGOUT_MS}. */
export const SESSION_IDLE_LOGOUT_REMEMBER_MS = SESSION_IDLE_LOGOUT_MS;

/** Pause API web : onglet masqué / fenêtre réduite (visibility ≠ visible). */
export const TAB_HIDE_API_PAUSE_GRACE_MS = 2 * 60 * 1000;

/** Émis par Expo (`injectJavaScript`) quand React Native AppState ≠ active. */
export const APK_APP_STATE_EVENT = "vouchernet-apk-app-state";

const BC_NAME = "vouchernet-auth-session-v1";

export function isNativeAppShell(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("native-app")) return true;
  return /nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent);
}

/** APK + jeton localStorage (« Se souvenir de moi ») → pas de déconnexion automatique. */
function isApkRememberMeNoIdleLogout(sessionPersisted: boolean): boolean {
  return isNativeAppShell() && sessionPersisted;
}

type BcMsg = { type: "activity"; t: number } | { type: "logout-all"; reason: string; t: number };

function postActivity(bc: BroadcastChannel | null, t: number) {
  writeSharedLastActivityTs(t);
  try {
    bc?.postMessage({ type: "activity", t } satisfies BcMsg);
  } catch {
    /* noop */
  }
}

function sharedLastActivityMs(localRef: number): number {
  return Math.max(localRef, readSharedLastActivityTs());
}

export function SessionLifecycle() {
  const { isAuthenticated, logout, sessionPersisted } = useAuth();
  const apkNative = isNativeAppShell();
  const apkNoIdleLogout = isApkRememberMeNoIdleLogout(sessionPersisted);
  const lastLocalPulse = useRef(0);
  const lastSharedRef = useRef(Date.now());
  const tabHidePauseTimerRef = useRef<number | null>(null);
  const apkAwayRef = useRef(false);
  const loggingOutRef = useRef(false);
  const logoutBroadcastSeenRef = useRef(0);

  useEffect(() => {
    const clearTabHidePauseTimer = () => {
      if (tabHidePauseTimerRef.current !== null) {
        window.clearTimeout(tabHidePauseTimerRef.current);
        tabHidePauseTimerRef.current = null;
      }
    };

    if (!isAuthenticated) {
      clearTabHidePauseTimer();
      apkAwayRef.current = false;
      loggingOutRef.current = false;
      setApiRequestPause(false);
      return;
    }

    const lsActivity = readSharedLastActivityTs();
    lastSharedRef.current = Math.max(Date.now(), lsActivity);
    logoutBroadcastSeenRef.current = readSessionLogoutBroadcastTs();

    let bc: BroadcastChannel | null = null;
    try {
      bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_NAME) : null;
    } catch {
      bc = null;
    }

    const bumpShared = (t: number) => {
      if (t > lastSharedRef.current) lastSharedRef.current = t;
    };

    const performIdleLogout = (opts: { revoke: boolean; showToast: boolean }) => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      broadcastSessionLogout();
      setApiRequestPause(false);
      if (opts.showToast) {
        toast.info("Session fermée (inactivité prolongée).", {
          id: "vouchernet-session-idle",
          duration: 4500,
        });
      }
      void logout(opts.revoke ? undefined : { skipRevoke: true });
    };

    const applyRemoteLogout = (broadcastTs: number, opts?: { force?: boolean }) => {
      if (!opts?.force && apkNoIdleLogout) return;
      if (broadcastTs <= logoutBroadcastSeenRef.current) return;
      logoutBroadcastSeenRef.current = broadcastTs;
      performIdleLogout({ revoke: false, showToast: true });
    };

    const checkLogoutBroadcast = () => {
      const ts = readSessionLogoutBroadcastTs();
      if (ts > 0) applyRemoteLogout(ts);
    };

    const onBcMessage = (ev: MessageEvent<BcMsg>) => {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "activity") bumpShared(data.t);
      if (data.type === "logout-all") {
        if (apkNoIdleLogout) return;
        applyRemoteLogout(typeof data.t === "number" ? data.t : readSessionLogoutBroadcastTs());
      }
    };
    bc?.addEventListener("message", onBcMessage);

    const onStorage = (ev: StorageEvent) => {
      if (ev.storageArea !== localStorage) return;
      if (ev.key === SESSION_LOGOUT_BROADCAST_LS_KEY && ev.newValue) {
        const ts = Number.parseInt(ev.newValue, 10);
        if (Number.isFinite(ts)) applyRemoteLogout(ts);
        return;
      }
      if (ev.key === AUTH_TOKEN_LS_KEY && ev.oldValue && !ev.newValue) {
        applyRemoteLogout(Date.now(), { force: true });
      }
    };
    window.addEventListener("storage", onStorage);

    const pulse = (source: "input" | "visible") => {
      const now = Date.now();
      bumpShared(now);
      if (source === "input" && now - lastLocalPulse.current < 2000) return;
      lastLocalPulse.current = now;
      postActivity(bc, now);
    };

    const onActivity = () => pulse("input");
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);

    const recomputeAwayAndPauseApi = () => {
      const awayWeb = document.visibilityState !== "visible";
      const awayNative = apkNative && apkAwayRef.current;
      const away = awayWeb || awayNative;

      if (away) {
        clearTabHidePauseTimer();
        if (awayNative) {
          setApiRequestPause(true);
        } else {
          tabHidePauseTimerRef.current = window.setTimeout(() => {
            tabHidePauseTimerRef.current = null;
            const st = typeof window !== "undefined" ? window.__vouchernetApiPause : undefined;
            if (st?.paused) return;
            setApiRequestPause(true);
          }, TAB_HIDE_API_PAUSE_GRACE_MS);
        }
      } else {
        clearTabHidePauseTimer();
        setApiRequestPause(false);
        pulse("visible");
        if (!apkNoIdleLogout) checkLogoutBroadcast();
        const lsAct = readSharedLastActivityTs();
        if (lsAct > lastSharedRef.current) lastSharedRef.current = lsAct;
        if (apkNative) {
          void queryClient.invalidateQueries();
        }
      }
    };

    const onNativeAppStateBridge = ((ev: Event) => {
      const d = (ev as CustomEvent<boolean>).detail;
      apkAwayRef.current = d === true;
      recomputeAwayAndPauseApi();
    }) as EventListener;

    const onDomVisibilityChange = () => {
      recomputeAwayAndPauseApi();
    };

    if (apkNative) {
      window.addEventListener(APK_APP_STATE_EVENT, onNativeAppStateBridge);
    }

    recomputeAwayAndPauseApi();
    document.addEventListener("visibilitychange", onDomVisibilityChange);

    const idleLogoutMs = SESSION_IDLE_LOGOUT_MS;

    let intervalId: number | undefined;
    if (!apkNoIdleLogout) {
      intervalId = window.setInterval(() => {
        checkLogoutBroadcast();
        const last = sharedLastActivityMs(lastSharedRef.current);
        if (last > lastSharedRef.current) lastSharedRef.current = last;
        if (Date.now() - last < idleLogoutMs) return;

        const ts = Date.now();
        try {
          bc?.postMessage({ type: "logout-all", reason: "idle", t: ts } satisfies BcMsg);
        } catch {
          /* noop */
        }
        performIdleLogout({ revoke: true, showToast: true });
      }, 10_000) as unknown as number;
    }

    return () => {
      clearTabHidePauseTimer();
      apkAwayRef.current = false;
      document.removeEventListener("visibilitychange", onDomVisibilityChange);
      if (apkNative) {
        window.removeEventListener(APK_APP_STATE_EVENT, onNativeAppStateBridge);
      }
      window.removeEventListener("pointerdown", onActivity, opts);
      window.removeEventListener("keydown", onActivity, opts);
      window.removeEventListener("wheel", onActivity, opts);
      window.removeEventListener("touchstart", onActivity, opts);
      window.removeEventListener("storage", onStorage);
      bc?.removeEventListener("message", onBcMessage);
      bc?.close();
      if (intervalId !== undefined) window.clearInterval(intervalId);
      setApiRequestPause(false);
    };
  }, [isAuthenticated, logout, apkNative, apkNoIdleLogout, sessionPersisted]);

  return null;
}
