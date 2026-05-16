import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "@/lib/installAuthFetch";

installAuthFetch();

// Expo APK WebView only — SessionLifecycle uses this to skip web idle-logout (mobile browser ≠ APK)
if (/nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("native-app");
}

createRoot(document.getElementById("root")!).render(<App />);
