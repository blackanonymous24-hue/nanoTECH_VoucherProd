import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { notifyAppResume, readSelectedRouterIdFromStorage, refreshDashboardDataOnResume } from "@/lib/dashboard-resume";
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
import { isNativeAppShell } from "@/lib/native-app-shell";

export { isNativeAppShell } from "@/lib/native-app-shell";

/**
 * Cycle de vie session — périmètre :
 *
 * • Web (tous rôles : admin / manager / collaborateur / vendeur) :
 *   déconnexion automatique après {@link SESSION_IDLE_LOGOUT_MS} d'inactivité,
 *   **indépendamment** de « Se souvenir de moi » (cette option n'agit que sur la persistance
 *   du jeton entre fermetures de navigateur). Pause API web après {@link TAB_HIDE_API_PAUSE_GRACE_MS}
 *   si l'onglet est masqué (`visibilityState !== "visible"`).
 *
 * • APK (WebView) :
 *   - Vendeur (rôle `vendor`) → **jamais** d'auto-logout, peu importe « Se souvenir de moi »
 *     (les vendeurs utilisent l'app en boutique, on veut éviter de les sortir au milieu d'une vente).
 *   - Autres rôles (admin / manager / collaborateur) :
 *     - « Se souvenir de moi » coché → aucune déconnexion automatique (session persistante).
 *     - « Se souvenir de moi » décoché → même règle d'inactivité que le web.
 *   Pause API toujours active en arrière-plan, peu importe l'option.
 */
/** Déconnexion auto après inactivité (web ; APK uniquement quand « Se souvenir de moi » est décoché). */
export const SESSION_IDLE_LOGOUT_MS = 30 * 60 * 1000;
/** Alias historique — même délai que {@link SESSION_IDLE_LOGOUT_MS}. */
export const SESSION_IDLE_LOGOUT_REMEMBER_MS = SESSION_IDLE_LOGOUT_MS;

/** Pause API web : onglet masqué / fenêtre réduite (visibility ≠ visible). */
export const TAB_HIDE_API_PAUSE_GRACE_MS = 2 * 60 * 1000;

/** Émis par Expo (`injectJavaScript`) quand React Native AppState ≠ active. */
export const APK_APP_STATE_EVENT = "vouchernet-apk-app-state";

const BC_NAME = "vouchernet-auth-session-v1";

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
  const { isAuthenticated, logout, rememberMe, role } = useAuth();
  const apkNative = isNativeAppShell();
  /**
   * Cas où la déconnexion automatique est désactivée :
   *  1. APK + vendeur : jamais d'auto-logout (workflow boutique).
   *  2. APK + autre rôle avec « Se souvenir de moi » coché : session persistante.
   * Sinon (web tout court, APK admin/manager/collab sans remember-me) → auto-logout après
   * {@link SESSION_IDLE_LOGOUT_MS} d'inactivité.
   */
  const skipAutoLogout = apkNative && (role === "vendor" || rememberMe);
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

    // On respecte le timestamp d'activité partagé s'il existe (recharge de l'onglet ou
    // autre onglet déjà ouvert). Un nouveau login le réinitialise via `AuthContext.login()`,
    // donc on n'a pas besoin de l'overrider à `Date.now()` ici — sinon chaque rechargement
    // de la page remettrait à zéro le compteur d'inactivité.
    const lsActivity = readSharedLastActivityTs();
    lastSharedRef.current = lsActivity > 0 ? lsActivity : Date.now();
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
      if (!opts?.force && skipAutoLogout) return;
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
        if (skipAutoLogout) return;
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
        if (skipAutoLogout) return;
        applyRemoteLogout(Date.now(), { force: true });
      }
    };
    window.addEventListener("storage", onStorage);

    /**
     * Bumpe le timestamp d'activité partagé (cross-tab + ref local).
     * N'est appelé QUE sur de vraies interactions utilisateur (input/keydown/touchstart),
     * *pas* sur les changements de visibilité — sinon le compteur d'inactivité serait
     * remis à zéro à chaque fois qu'on revient sur l'onglet, et le seuil de 30 min
     * ne serait jamais atteint en pratique.
     */
    const bumpActivity = () => {
      const now = Date.now();
      bumpShared(now);
      if (now - lastLocalPulse.current < 2000) return;
      lastLocalPulse.current = now;
      postActivity(bc, now);
    };

    const onActivity = () => bumpActivity();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);

    /**
     * À la reprise (onglet redevient visible, app APK revient en avant-plan), on vérifie
     * immédiatement si le seuil d'inactivité a été franchi pendant l'arrière-plan.
     * Le setInterval peut être suspendu par le navigateur/WebView en arrière-plan ; ce
     * check explicite garantit que l'utilisateur tombe sur l'écran de connexion sans
     * délai supplémentaire au retour.
     */
    const checkIdleAfterResume = () => {
      if (skipAutoLogout || loggingOutRef.current) return;
      const lsAct = readSharedLastActivityTs();
      if (lsAct > lastSharedRef.current) lastSharedRef.current = lsAct;
      const last = lastSharedRef.current;
      if (Date.now() - last < SESSION_IDLE_LOGOUT_MS) return;

      const ts = Date.now();
      try {
        bc?.postMessage({ type: "logout-all", reason: "idle", t: ts } satisfies BcMsg);
      } catch {
        /* noop */
      }
      performIdleLogout({ revoke: true, showToast: true });
    };

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
        // IMPORTANT : ne PAS bumper l'activité au retour — sinon le compteur d'inactivité
        // est remis à zéro à chaque fois qu'on revient sur l'onglet et l'auto-logout ne se
        // déclenche jamais. On contrôle d'abord si le seuil a été franchi en arrière-plan,
        // puis on synchronise le timestamp partagé sans le faire avancer.
        if (!skipAutoLogout) {
          checkLogoutBroadcast();
          checkIdleAfterResume();
        }
        const lsAct = readSharedLastActivityTs();
        if (lsAct > lastSharedRef.current) lastSharedRef.current = lsAct;
        const resumeRouterId = readSelectedRouterIdFromStorage();
        notifyAppResume();
        if (resumeRouterId != null) {
          void refreshDashboardDataOnResume(resumeRouterId);
        } else {
          void queryClient.invalidateQueries({ queryKey: ["router-dashboard-priority"] });
        }
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
    if (!skipAutoLogout) {
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
  }, [isAuthenticated, logout, apkNative, skipAutoLogout, rememberMe, role]);

  return null;
}
