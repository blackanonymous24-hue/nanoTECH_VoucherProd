import { useLocation } from "wouter";

/**
 * Navigation hook compatible WebView Android (nanoTECH APK).
 *
 * In the React Native WebView, `history.pushState` fires `onLoadStart`
 * but never `onLoadEnd`, causing the loading overlay to stay forever.
 * When running inside the APK we fall back to a real HTTP navigation
 * (`window.location.href`) so that both events fire correctly.
 */
const WEBVIEW_UA = "nanoTECH-VouchersBills-Mobile";

function isInsideWebView(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes(WEBVIEW_UA);
}

export function useAppNavigate() {
  const [, navigate] = useLocation();

  return (path: string) => {
    if (isInsideWebView()) {
      window.location.href = path;
    } else {
      navigate(path);
    }
  };
}
