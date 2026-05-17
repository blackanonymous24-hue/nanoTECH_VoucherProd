import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "@/lib/installAuthFetch";
import { installApkPullToRefresh } from "@/lib/apk-pull-to-refresh";
import { lockSystemFontScale } from "@/lib/lock-system-font-scale";

installAuthFetch();

const isNativeApp = /nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent);
const isMobileViewport =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 639px)").matches;

// APK + navigateurs mobiles : taille de police système ignorée
if (isNativeApp) {
  document.documentElement.classList.add("native-app");
  lockSystemFontScale();
  installApkPullToRefresh();
} else if (isMobileViewport) {
  lockSystemFontScale();
}

createRoot(document.getElementById("root")!).render(<App />);
