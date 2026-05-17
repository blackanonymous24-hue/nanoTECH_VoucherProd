/**
 * Pull-to-refresh pour l’APK (Android) : `pullToRefreshEnabled` de react-native-webview est iOS uniquement.
 * Envoie { type: "refresh" } à React Native quand l’utilisateur tire vers le bas en haut de page.
 */

const PTR_THRESHOLD_PX = 72;
const PTR_MAX_PULL_PX = 120;
const INDICATOR_ID = "apk-ptr-indicator";

function isNativeWebView(): boolean {
  return (
    document.documentElement.classList.contains("native-app") ||
    /nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent)
  );
}

function postRefreshToNative(): void {
  const bridge = (window as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
  bridge?.postMessage(JSON.stringify({ type: "refresh" }));
}

/** Conteneur scrollable actif en haut de page (Layout admin ou page vendeur). */
function getScrollRootAtTop(): HTMLElement | null {
  const layoutMain = document.querySelector("main.flex-1.overflow-y-auto") as HTMLElement | null;
  if (layoutMain && layoutMain.scrollTop <= 1) return layoutMain;

  const anyMain = document.querySelector("main") as HTMLElement | null;
  if (anyMain) {
    const oy = getComputedStyle(anyMain).overflowY;
    if ((oy === "auto" || oy === "scroll") && anyMain.scrollTop <= 1) return anyMain;
  }

  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  if (root.scrollTop <= 1) return root;
  return null;
}

function ensureIndicator(): HTMLElement {
  let el = document.getElementById(INDICATOR_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = INDICATOR_ID;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<span class="apk-ptr-spinner"></span><span class="apk-ptr-label">Relâcher pour actualiser</span>';
  document.body.appendChild(el);
  return el;
}

function setIndicatorVisible(pullPx: number, ready: boolean): void {
  const el = ensureIndicator();
  const progress = Math.min(1, pullPx / PTR_THRESHOLD_PX);
  el.style.opacity = pullPx > 8 ? String(0.35 + progress * 0.65) : "0";
  el.style.transform = `translateX(-50%) translateY(${Math.min(pullPx * 0.45, 48)}px)`;
  el.classList.toggle("apk-ptr-ready", ready);
}

function hideIndicator(): void {
  const el = document.getElementById(INDICATOR_ID);
  if (!el) return;
  el.style.opacity = "0";
  el.style.transform = "translateX(-50%) translateY(0)";
  el.classList.remove("apk-ptr-ready");
}

export function installApkPullToRefresh(): void {
  if (!isNativeWebView()) return;
  if ((window as { __apkPtrInstalled?: boolean }).__apkPtrInstalled) return;
  (window as { __apkPtrInstalled?: boolean }).__apkPtrInstalled = true;

  let startY = 0;
  let pulling = false;
  let pullPx = 0;
  let scrollRoot: HTMLElement | null = null;

  const reset = () => {
    pulling = false;
    pullPx = 0;
    scrollRoot = null;
    hideIndicator();
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      scrollRoot = getScrollRootAtTop();
      if (!scrollRoot) return;
      startY = e.touches[0].clientY;
      pulling = true;
      pullPx = 0;
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || !scrollRoot || e.touches.length !== 1) return;
      if (scrollRoot.scrollTop > 1) {
        reset();
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        pullPx = 0;
        hideIndicator();
        return;
      }
      pullPx = Math.min(dy, PTR_MAX_PULL_PX);
      setIndicatorVisible(pullPx, pullPx >= PTR_THRESHOLD_PX);
      if (pullPx > 12) e.preventDefault();
    },
    { capture: true, passive: false },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (!pulling) return;
      const shouldRefresh = pullPx >= PTR_THRESHOLD_PX;
      reset();
      if (shouldRefresh) postRefreshToNative();
    },
    { capture: true, passive: true },
  );

  document.addEventListener("touchcancel", reset, { capture: true, passive: true });
}
