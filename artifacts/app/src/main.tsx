import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "@/lib/installAuthFetch";
import { installApkPullToRefresh } from "@/lib/apk-pull-to-refresh";

installAuthFetch();

// Expo APK WebView — SessionLifecycle : pas de déconnexion idle si « Se souvenir de moi », pause API en arrière-plan
if (/nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent)) {
  const root = document.documentElement;
  root.classList.add("native-app");
  root.style.setProperty("-webkit-text-size-adjust", "100%");
  root.style.textSizeAdjust = "100%";
  installApkPullToRefresh();
}

createRoot(document.getElementById("root")!).render(<App />);
