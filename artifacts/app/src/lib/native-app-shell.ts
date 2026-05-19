/** WebView Expo (APK) — UA injecté par `artifacts/mobile/App.tsx`. */
export function isNativeAppShell(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("native-app")) return true;
  return /nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent);
}
