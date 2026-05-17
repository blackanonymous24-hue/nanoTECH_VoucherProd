import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "@/lib/installAuthFetch";
import { installApkPullToRefresh } from "@/lib/apk-pull-to-refresh";

installAuthFetch();

// Expo APK WebView — SessionLifecycle : pas de déconnexion idle si « Se souvenir de moi », pause API en arrière-plan
if (/nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("native-app");
  installApkPullToRefresh();
}

createRoot(document.getElementById("root")!).render(<App />);
