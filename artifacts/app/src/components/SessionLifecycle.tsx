import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { setApiRequestPause } from "@/lib/installAuthFetch";
import { queryClient } from "@/lib/queryClient";

/**
 * Cycle de vie session — périmètre :
 *
 * • Bureau et mobile en navigation web : pause API si l’onglet / l’app reste « absents »
 *   après TAB_HIDE_API_PAUSE_GRACE_MS ; BroadcastChannel entre onglets ; déconnexion après
 *   SESSION_IDLE_LOGOUT_MS sans activité sauf si « Se souvenir de moi » (jeton localStorage) :
 *   dans ce cas pas de déconnexion idle, mais la pause API après la période de grâce s’applique toujours.
 *
 * • APK nanoTECH (WebView Expo, UA `nanoTECH-VouchersBills-Mobile` / classe `native-app`) :
 *   pas de déconnexion idle pour admin/vendeur ; même délai de grâce via l’événement
 *   {@link APK_APP_STATE_EVENT} (AppState natif, plus fiable que visibility seul).
 */
export const SESSION_IDLE_LOGOUT_MS = 10 * 60 * 1000;

/** Délai après masquage de l’onglet / passage de l’app en arrière-plan avant pause API. */
export const TAB_HIDE_API_PAUSE_GRACE_MS = 2 * 60 * 1000;

/** Émis par Expo (`injectJavaScript`) quand React Native AppState ≠ active ; `detail`: app en arrière-plan. */
export const APK_APP_STATE_EVENT = "vouchernet-apk-app-state";

const BC_NAME = "vouchernet-auth-session-v1";

export function isNativeAppShell(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("native-app")) return true;
  return /nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent);
}

function isApkRelaxedSessionMode(role: string | null): boolean {
  return isNativeAppShell() && (role === "vendor" || role === "admin");
}

type BcMsg = { type: "activity"; t: number } | { type: "logout-all"; reason: string };

function postActivity(bc: BroadcastChannel | null, t: number) {
  try {
    bc?.postMessage({ type: "activity", t } satisfies BcMsg);
  } catch {
    /* noop */
  }
}

export function SessionLifecycle() {
  const { isAuthenticated, logout, role, sessionPersisted } = useAuth();
  const apkRelaxed = isApkRelaxedSessionMode(role);
  const lastLocalPulse = useRef(0);
  const lastSharedRef = useRef(Date.now());
  /** Minuteur avant pause API lorsque la session est considérée « absente » (grâce TAB_HIDE_API_PAUSE_GRACE_MS). */
  const tabHidePauseTimerRef = useRef<number | null>(null);
  /** APK : dernier état envoyé par l’AppState natif ({@link APK_APP_STATE_EVENT}), `true` = arrière-plan / inactive. */
  const apkAwayRef = useRef(false);

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
      setApiRequestPause(false);
      return;
    }

    lastSharedRef.current = Date.now();

    let bc: BroadcastChannel | null = null;
    try {
      bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_NAME) : null;
    } catch {
      bc = null;
    }
    const bumpShared = (t: number) => {
      if (t > lastSharedRef.current) lastSharedRef.current = t;
    };

    const onBcMessage = (ev: MessageEvent<BcMsg>) => {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "activity") bumpShared(data.t);
      if (data.type === "logout-all") {
        setApiRequestPause(false);
        toast.info("Session fermée (inactivité prolongée).", { id: "vouchernet-session-idle", duration: 4500 });
        void logout({ skipRevoke: true });
      }
    };
    bc?.addEventListener("message", onBcMessage);

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
      const awayNative = isNativeAppShell() && apkAwayRef.current;
      const away = awayWeb || awayNative;

      if (away) {
        clearTabHidePauseTimer();
        tabHidePauseTimerRef.current = window.setTimeout(() => {
          tabHidePauseTimerRef.current = null;
          const st = typeof window !== "undefined" ? window.__vouchernetApiPause : undefined;
          /** Ne pas remplacer une pause déjà levée par Génération / toggle lot (allowPathPatterns). */
          if (st?.paused) return;
          setApiRequestPause(true);
        }, TAB_HIDE_API_PAUSE_GRACE_MS);
      } else {
        clearTabHidePauseTimer();
        setApiRequestPause(false);
        pulse("visible");
        if (apkRelaxed) {
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

    if (isNativeAppShell()) {
      window.addEventListener(APK_APP_STATE_EVENT, onNativeAppStateBridge);
    }

    recomputeAwayAndPauseApi();
    document.addEventListener("visibilitychange", onDomVisibilityChange);

    let intervalId: number | undefined;
    if (!apkRelaxed && !sessionPersisted) {
      intervalId = window.setInterval(() => {
        if (Date.now() - lastSharedRef.current >= SESSION_IDLE_LOGOUT_MS) {
          try {
            bc?.postMessage({ type: "logout-all", reason: "idle" } satisfies BcMsg);
          } catch {
            /* noop */
          }
          setApiRequestPause(false);
          toast.info("Session fermée (inactivité prolongée).", { id: "vouchernet-session-idle", duration: 4500 });
          void logout();
        }
      }, 10_000) as unknown as number;
    }

    return () => {
      clearTabHidePauseTimer();
      apkAwayRef.current = false;
      document.removeEventListener("visibilitychange", onDomVisibilityChange);
      if (isNativeAppShell()) {
        window.removeEventListener(APK_APP_STATE_EVENT, onNativeAppStateBridge);
      }
      window.removeEventListener("pointerdown", onActivity, opts);
      window.removeEventListener("keydown", onActivity, opts);
      window.removeEventListener("wheel", onActivity, opts);
      window.removeEventListener("touchstart", onActivity, opts);
      bc?.removeEventListener("message", onBcMessage);
      bc?.close();
      if (intervalId !== undefined) window.clearInterval(intervalId);
      setApiRequestPause(false);
    };
  }, [isAuthenticated, logout, role, apkRelaxed, sessionPersisted]);

  return null;
}
