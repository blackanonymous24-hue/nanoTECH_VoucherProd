import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch, clearApiRequestPause } from "@/lib/installAuthFetch";

installAuthFetch();
// Évite un login bloqué si la pause « génération » est restée active (crash, onglet fermé).
clearApiRequestPause();

createRoot(document.getElementById("root")!).render(<App />);
