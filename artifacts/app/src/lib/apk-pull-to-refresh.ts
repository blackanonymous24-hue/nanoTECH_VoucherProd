/**
 * Pull-to-refresh APK (Android) : maintien volontaire en haut de page, pas un simple flick.
 * Envoie { type: "refresh" } après ~2 s de tirage maintenu puis relâchement.
 */

/** Tirage minimal avant d’afficher l’indicateur (évite les scrolls courts). */
const PTR_ACTIVATE_PX = 40;
/** Distance de tirage minimale au relâchement. */
const PTR_READY_PULL_PX = 56;
/** Durée de maintien requise (ms). */
const PTR_HOLD_MS = 2000;
const PTR_MAX_PULL_PX = 110;
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
  el.innerHTML = [
    '<span class="apk-ptr-icon" aria-hidden="true">',
    '<span class="apk-ptr-ring" aria-hidden="true"></span>',
    '<svg class="apk-ptr-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"',
    ' stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>',
    '<path d="M21 3v5h-5"/>',
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>',
    '<path d="M8 16H3v5"/>',
    "</svg></span>",
    '<span class="apk-ptr-label"></span>',
  ].join("");
  document.body.appendChild(el);
  return el;
}

function setIndicator(pullPx: number, holdProgress: number, ready: boolean): void {
  const el = ensureIndicator();
  const icon = el.querySelector(".apk-ptr-icon") as HTMLElement | null;
  const label = el.querySelector(".apk-ptr-label") as HTMLElement | null;

  const active = pullPx >= PTR_ACTIVATE_PX;
  if (icon) icon.style.display = active ? "flex" : "none";
  if (icon) icon.style.setProperty("--ptr-progress", String(ready ? 1 : holdProgress));
  if (label) label.textContent = ready ? "Relâchez pour actualiser" : "";

  const show = ready || pullPx > 12;
  el.style.opacity = show ? String(ready ? 1 : 0.4 + Math.min(1, pullPx / PTR_READY_PULL_PX) * 0.45) : "0";
  el.style.transform = `translateX(-50%) translateY(${Math.min(pullPx * 0.4, 44)}px)`;
  el.classList.toggle("apk-ptr-ready", ready);
  el.classList.toggle("apk-ptr-holding", active && !ready);
}

function hideIndicator(): void {
  const el = document.getElementById(INDICATOR_ID);
  if (!el) return;
  el.style.opacity = "0";
  el.style.transform = "translateX(-50%) translateY(0)";
  el.classList.remove("apk-ptr-ready", "apk-ptr-holding");
}

export function installApkPullToRefresh(): void {
  if (!isNativeWebView()) return;
  if ((window as { __apkPtrInstalled?: boolean }).__apkPtrInstalled) return;
  (window as { __apkPtrInstalled?: boolean }).__apkPtrInstalled = true;

  let startY = 0;
  let pullPx = 0;
  let scrollRoot: HTMLElement | null = null;
  let armed = false;
  let pullStartedAt = 0;

  const reset = () => {
    pullPx = 0;
    scrollRoot = null;
    armed = false;
    pullStartedAt = 0;
    hideIndicator();
  };

  const holdProgress = () => {
    if (!armed || pullPx < PTR_READY_PULL_PX) return 0;
    return Math.min(1, (Date.now() - pullStartedAt) / PTR_HOLD_MS);
  };

  const isHoldSatisfied = () => armed && pullPx >= PTR_READY_PULL_PX && holdProgress() >= 1;

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      scrollRoot = getScrollRootAtTop();
      if (!scrollRoot) return;
      startY = e.touches[0].clientY;
      armed = false;
      pullPx = 0;
      pullStartedAt = 0;
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!scrollRoot || e.touches.length !== 1) return;
      if (scrollRoot.scrollTop > 1) {
        reset();
        return;
      }

      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        if (armed) reset();
        return;
      }

      if (dy < PTR_ACTIVATE_PX) {
        hideIndicator();
        return;
      }

      if (!armed) {
        armed = true;
        pullStartedAt = Date.now();
      }

      pullPx = Math.min(dy, PTR_MAX_PULL_PX);
      const ready = isHoldSatisfied();
      setIndicator(pullPx, holdProgress(), ready);

      if (armed && pullPx >= PTR_ACTIVATE_PX + 16) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (!armed) {
        reset();
        return;
      }
      const shouldRefresh = isHoldSatisfied();
      reset();
      if (shouldRefresh) postRefreshToNative();
    },
    { capture: true, passive: true },
  );

  document.addEventListener("touchcancel", reset, { capture: true, passive: true });
}
