#!/usr/bin/env node
/**
 * Attend le serveur Vite, affiche les URL (LAN + tunnel), ouvre le navigateur,
 * arrête le tunnel à la sortie. Lancé en parallèle par `pnpm run dev` (concurrently).
 *
 * Variables utiles :
 *   PORT, VITE_PORT — port du front (défaut 4173, aligné sur vite.config.ts)
 *   DEV_TUNNEL — auto | ngrok | cloudflared | localtunnel | off
 *   NGROK_AUTHTOKEN — obligatoire pour le mode ngrok (https://dashboard.ngrok.com/)
 *   DEV_OPEN_BROWSER — 1 (défaut) ou 0 pour ne pas ouvrir le navigateur
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Charge `.env` / `.env.local` à la racine (sans écraser les variables déjà définies). */
function loadRootEnv() {
  for (const name of [".env", ".env.local"]) {
    const p = path.join(repoRoot, name);
    try {
      const s = fs.readFileSync(p, "utf8");
      for (const line of s.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      /* fichier absent */
    }
  }
}

loadRootEnv();

const WEB_PORT = Number(process.env.PORT || process.env.VITE_PORT || 4173);
const TUNNEL_MODE = (process.env.DEV_TUNNEL || "auto").toLowerCase();
const OPEN_BROWSER = process.env.DEV_OPEN_BROWSER !== "0" && process.env.DEV_OPEN_BROWSER !== "false";

/** @type {() => Promise<void>} */
let stopTunnel = async () => {};

function getLanIPv4() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n && n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return null;
}

async function waitForVite(maxMs = 120_000) {
  const url = `http://127.0.0.1:${WEB_PORT}/`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(undefined);
        });
        req.on("error", reject);
        req.setTimeout(2500, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch {
      await delay(400);
    }
  }
  throw new Error(`[dev-tunnel] Vite introuvable sur le port ${WEB_PORT} après ${maxMs} ms.`);
}

function banner({ lanUrl, publicUrl, tunnelLabel }) {
  const C = {
    r: "\x1b[0m",
    c: "\x1b[36m",
    y: "\x1b[33m",
    g: "\x1b[32m",
    b: "\x1b[1m",
  };
  console.log(`\n${C.c}════════════════════════════════════════════════════════════════${C.r}`);
  console.log(`${C.b}  VoucherNet — accès téléphone / Internet${C.r}`);
  if (lanUrl) console.log(`  Wi‑Fi local (même réseau) : ${C.y}${lanUrl}${C.r}`);
  if (publicUrl) console.log(`  ${tunnelLabel} : ${C.g}${publicUrl}${C.r}`);
  else if (TUNNEL_MODE !== "off")
    console.log(
      `  ${C.y}Aucun tunnel public (installez ngrok + NGROK_AUTHTOKEN, ou cloudflared dans le PATH, ou DEV_TUNNEL=localtunnel).${C.r}`,
    );
  console.log(`${C.c}════════════════════════════════════════════════════════════════${C.r}\n`);
}

/** @returns {Promise<{ url: string, stop: () => Promise<void> } | null>} */
async function tunnelLocaltunnel() {
  const { default: localtunnel } = await import("localtunnel");
  const t = await localtunnel({ port: WEB_PORT });
  return {
    url: t.url,
    stop: async () => {
      try {
        t.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** @returns {Promise<{ url: string, stop: () => Promise<void> } | null>} */
function tunnelCloudflared() {
  return new Promise((resolve) => {
    const exe = "cloudflared";
    const child = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${WEB_PORT}`], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: process.env,
    });
    let buf = "";
    let settled = false;
    const finish = (url) => {
      if (settled) return;
      settled = true;
      if (!url) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve(null);
        return;
      }
      resolve({
        url,
        stop: () =>
          new Promise((r) => {
            child.once("exit", () => r());
            try {
              child.kill("SIGTERM");
            } catch {
              r();
            }
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {
                /* ignore */
              }
              r();
            }, 3000).unref?.();
          }),
      });
    };
    const onChunk = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[\w-]+\.trycloudflare\.com\b/);
      if (m) finish(m[0]);
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", () => finish(null));
    child.on("exit", (code, sig) => {
      if (sig === "SIGTERM" || sig === "SIGKILL") return;
      if (!settled) finish(null);
    });
    setTimeout(() => finish(null), 50_000).unref?.();
  });
}

/** @returns {Promise<{ url: string, stop: () => Promise<void> } | null>} */
function tunnelNgrokCli() {
  const token = process.env.NGROK_AUTHTOKEN;
  if (!token) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn("ngrok", ["http", String(WEB_PORT), "--log=stdout"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, NGROK_AUTHTOKEN: token },
    });
    let buf = "";
    let settled = false;
    const finish = (url) => {
      if (settled) return;
      settled = true;
      if (!url) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve(null);
        return;
      }
      resolve({
        url,
        stop: () =>
          new Promise((r) => {
            child.once("exit", () => r());
            try {
              child.kill("SIGTERM");
            } catch {
              r();
            }
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {
                /* ignore */
              }
              r();
            }, 3000).unref?.();
          }),
      });
    };
    const onChunk = (chunk) => {
      buf += chunk.toString();
      const patterns = [
        /https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.app\b/,
        /https:\/\/[a-zA-Z0-9-]+\.ngrok\.io\b/,
        /https:\/\/[a-zA-Z0-9-]+\.ngrok\.app\b/,
      ];
      for (const re of patterns) {
        const m = buf.match(re);
        if (m) finish(m[0]);
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", () => finish(null));
    child.on("exit", (code, sig) => {
      if (sig === "SIGTERM" || sig === "SIGKILL") return;
      if (!settled) finish(null);
    });
    setTimeout(() => finish(null), 60_000).unref?.();
  });
}

async function pickTunnel() {
  if (TUNNEL_MODE === "off" || TUNNEL_MODE === "false") return { url: null, label: "", stop: async () => {} };

  if (TUNNEL_MODE === "localtunnel") {
    const r = await tunnelLocaltunnel().catch(() => null);
    if (r) return { ...r, label: "Tunnel public (localtunnel)" };
    return { url: null, label: "", stop: async () => {} };
  }

  if (TUNNEL_MODE === "cloudflared") {
    const r = await tunnelCloudflared();
    if (r) return { url: r.url, label: "Tunnel public (Cloudflare trycloudflare)", stop: r.stop };
    return { url: null, label: "", stop: async () => {} };
  }

  if (TUNNEL_MODE === "ngrok") {
    const r = await tunnelNgrokCli();
    if (r) return { url: r.url, label: "Tunnel public (ngrok)", stop: r.stop };
    return { url: null, label: "", stop: async () => {} };
  }

  // auto
  if (process.env.NGROK_AUTHTOKEN) {
    const r = await tunnelNgrokCli();
    if (r) return { url: r.url, label: "Tunnel public (ngrok)", stop: r.stop };
  }
  const cf = await tunnelCloudflared();
  if (cf) return { url: cf.url, label: "Tunnel public (Cloudflare trycloudflare)", stop: cf.stop };
  const lt = await tunnelLocaltunnel().catch(() => null);
  if (lt) return { url: lt.url, label: "Tunnel public (localtunnel)", stop: lt.stop };
  return { url: null, label: "", stop: async () => {} };
}

async function openBrowser(url) {
  if (!OPEN_BROWSER || !url) return;
  try {
    const { default: open } = await import("open");
    await open(url, { wait: false });
  } catch {
    /* ignore */
  }
}

async function main() {
  console.log(`[dev-tunnel] En attente de Vite sur le port ${WEB_PORT}…`);
  await waitForVite();

  const lan = getLanIPv4();
  const lanUrl = lan ? `http://${lan}:${WEB_PORT}/` : null;

  const { url: publicUrl, label, stop } = await pickTunnel();
  stopTunnel = stop;

  banner({ lanUrl, publicUrl, tunnelLabel: label || "Tunnel public" });

  const preferPublic = !!publicUrl;
  await openBrowser(preferPublic ? publicUrl : lanUrl);

  const onStop = async () => {
    await stopTunnel();
    process.exit(0);
  };
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[dev-tunnel]", err);
  process.exit(1);
});
