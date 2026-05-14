import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "@/lib/installAuthFetch";

installAuthFetch();

// Expo APK WebView → add class for CSS/JS targeting
if (/nanoTECH-Vouchers(?:Bills)?-Mobile/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("native-app");
}

createRoot(document.getElementById("root")!).render(<App />);
