import { RouterOSAPI } from "node-routeros";
import net from "net";
import iconv from "iconv-lite";

/**
 * Convert a UTF-8 string to its Windows-1252 byte sequence, then back to a
 * JS string where each character has the correct byte value (≤ 0xFF).
 * This is what node-routeros does internally before writing to the socket, so
 * we need to pre-encode any string that contains accented characters before
 * passing it to api.write() — otherwise the UTF-8 multi-byte sequences arrive
 * at RouterOS, get stored as raw bytes, and WinBox displays them as garbled
 * latin characters (è → NadÃ¨ge).
 */
function toWin1252(str: string): string {
  try {
    const buf = iconv.encode(str, "win1252");
    // Build a JS string whose char codes are the raw bytes — iconv.encode
    // returns a Buffer with the correct Windows-1252 byte values.
    return Array.from(buf as Uint8Array).map((b) => String.fromCharCode(b)).join("");
  } catch {
    return str;
  }
}

/**
 * Reverse of toWin1252: when node-routeros hands us back a string whose chars
 * are raw bytes (≤0xFF), check whether those bytes form a valid UTF-8 sequence
 * and, if so, return the proper UTF-8 string.
 *
 * Real-world case: hotspot login comments / usernames typed in WinBox as UTF-8
 * (e.g. "Famille Koné" → bytes 0xC3 0xA9 for "é") arrive here as the JS string
 * "Famille KonÃ©" (each byte mapped 1:1 to U+00xx). Decoding as UTF-8 gives the
 * correct "Famille Koné". If the bytes are NOT valid UTF-8 (e.g. lone 0xE9 from
 * legacy Win1252 storage), we fall back to the raw input untouched.
 */
function fromWin1252(str: string): string {
  if (!str) return str;
  // Quick sniff — only attempt re-decoding if the string contains characters
  // in the 0x80-0xFF range (i.e. potentially mojibake). Pure ASCII passes through.
  let needsDecode = false;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) { needsDecode = true; break; }
  }
  if (!needsDecode) return str;
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return str;
  }
}

export function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
    socket.connect(port, host);
  });
}

export interface RouterConnection {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** Mikhmon sets `status-autorefresh=1m` on profiles so session metadata tracks changes faster. */
const HOTSPOT_PROFILE_STATUS_AUTOREFRESH = "1m";

/** `/system/resource/print` is only needed for RouterOS 6 vs 7+ script quirks; cache per device to save one API round-trip per profile add/update. */
const ROUTER_OS_VERSION_CACHE_MS = 15 * 60 * 1000;
const routerOsVersionCache = new Map<string, { version: string | null; at: number }>();

async function getCachedRouterOsVersion(api: RouterOSAPI, conn: RouterConnection): Promise<string | null> {
  const key = `${conn.host}:${conn.port}`;
  const hit = routerOsVersionCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ROUTER_OS_VERSION_CACHE_MS) return hit.version;
  const sys = await api.write("/system/resource/print");
  const version = ((sys?.[0] as Record<string, unknown> | undefined)?.["version"] as string | undefined) ?? null;
  routerOsVersionCache.set(key, { version, at: now });
  return version;
}

/** Clé de tri par « ordre de création » : identifiant de ligne RouterOS (`.id`, hex après *). */
function mikrotikRowIdSortKey(id: string | undefined | null): number {
  if (!id || id[0] !== "*") return Number.MAX_SAFE_INTEGER;
  const hex = id.slice(1);
  if (!hex) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Même règle que `sortRouterProfilesByCreationOrder` dans l’app web. */
export function sortHotspotProfilesByCreationOrder<T extends { mikrotikId?: string; name?: string }>(
  profiles: T[],
): T[] {
  return [...profiles].sort((a, b) => {
    const na = mikrotikRowIdSortKey(a.mikrotikId);
    const nb = mikrotikRowIdSortKey(b.mikrotikId);
    if (na !== nb) return na - nb;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr", { sensitivity: "base" });
  });
}

export interface HotspotProfile {
  mikrotikId: string;
  name: string;
  rateLimit: string | null;
  validity: string | null;
  price: string | null;
  sellingPrice: string | null;
  sharedUsers: string | null;
  addrPool: string | null;
  lockMac: boolean;
  expiredMode: string | null;
  parentQueue: string | null;
  /** Mikhmon-style: system scheduler named like the profile, enabled → green dot in UI. */
  schedulerMonitorActive: boolean;
}

export interface HotspotSession {
  user: string;
  address: string;
  macAddress: string | null;
  uptime: string;
  bytesIn: string | null;
  bytesOut: string | null;
  server: string | null;
}

export interface HotspotCookie {
  id: string;
  user: string | null;
  macAddress: string | null;
  address: string | null;
  server: string | null;
  expiresIn: string | null;
  domain: string | null;
  path: string | null;
}

export interface RouterBoardInfo {
  model: string;
  version: string;
}

const WIN1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function fixEncoding(str: string): string {
  try {
    const bytes: number[] = [];
    for (const ch of str) {
      const code = ch.codePointAt(0)!;
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (WIN1252_REVERSE[code] !== undefined) {
        bytes.push(WIN1252_REVERSE[code]);
      } else if (code <= 0xff) {
        bytes.push(code);
      } else {
        return str;
      }
    }
    const decoded = Buffer.from(bytes).toString("utf-8");
    return decoded.includes("\uFFFD") ? str : decoded;
  } catch {
    return str;
  }
}

/**
 * Normalize text coming from RouterOS/node-routeros for UI display.
 * Handles both common mojibake forms:
 * - UTF-8 bytes interpreted as latin-1 ("NadÃ¨ge")
 * - mixed Win1252 byte mappings.
 */
function decodeRouterText(str: string | null | undefined): string {
  if (!str) return "";
  return fromWin1252(fixEncoding(str));
}

// MikhMon expmode values stored at index [1] in the original format
const MIKHMON_EXPMODES = new Set(["rem", "ntf", "remc", "ntfc", "0", ""]);

function parseProfileOnLogin(onLogin: string): {
  price: string; validity: string; lockMac: boolean;
  sellingPrice: string; expiredMode: string; parentQueue: string;
} {
  // Two known :put ("...") config formats:
  //
  // ① MikhMon original (7 commas / 8 parts):
  //     ",expmode,price,validity,sprice,,lockunlock,"
  //     [0]=""  [1]=expmode  [2]=price  [3]=validity  [4]=sprice  [5]=""  [6]=lockunlock
  //
  // ② VoucherNet extended (10 commas / 11 parts):
  //     ",label,price,validity,sharedUsers,addrPool,lockMac,sellingPrice,expiredMode,parentQueue,"
  //     [0]=""  [1]=label  [2]=price  [3]=validity  [6]=lockMac  [7]=sellingPrice  [8]=expiredMode  [9]=parentQueue

  const putMatch = onLogin.match(/:put\s*\("([^"]+)"\)/);
  const configStr = putMatch ? putMatch[1] : onLogin;
  const parts     = configStr.split(",");

  const price    = (parts[2] ?? "").trim();
  const validity = (parts[3] ?? "").trim();

  // Detect format: MikhMon has ≤8 parts, VoucherNet has ≥10.
  // Also check if parts[1] is a known MikhMon expmode keyword as extra guard.
  const field1        = (parts[1] ?? "").trim().toLowerCase();
  const isMikhmon     = parts.length < 10 || MIKHMON_EXPMODES.has(field1);

  if (isMikhmon) {
    // ① MikhMon original format
    const sellingPrice = (parts[4] ?? "").trim();
    const lockField    = (parts[6] ?? "").trim();
    const lockMac      = lockField.toLowerCase() === "enable";
    // Preserve MikhMon expmode semantics:
    // rem  = Remove
    // remc = Remove & Record
    // ntf  = Notice
    // ntfc = Notice & Record
    // 0    = None
    const expiredMode  = field1 === "remc" ? "remc"
                       : field1 === "ntfc" ? "ntfc"
                       : field1 === "rem"  ? "rem"
                       : field1 === "ntf"  ? "ntf"
                       : "none";
    return { price, validity, lockMac, sellingPrice, expiredMode, parentQueue: "" };
  }

  // ② VoucherNet extended format
  const lockField    = (parts[6] ?? "").trim();
  const lockMac      = lockField.toLowerCase() === "enable";
  const sellingPrice = (parts[7] ?? "").trim();
  const expiredMode  = (parts[8] ?? "").trim();
  const parentQueue  = (parts[9] ?? "").trim();
  return { price, validity, lockMac, sellingPrice, expiredMode, parentQueue };
}

// Per-router semaphore: max 2 concurrent API connections per router
class Semaphore {
  private slots: number;
  private readonly highQueue: Array<() => void> = [];
  private readonly normalQueue: Array<() => void> = [];
  constructor(max: number) { this.slots = max; }

  acquire(priority: "high" | "normal" = "normal"): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise((resolve) => {
      if (priority === "high") this.highQueue.push(resolve);
      else this.normalQueue.push(resolve);
    });
  }

  release(): void {
    const next = this.highQueue.shift() ?? this.normalQueue.shift();
    if (next) { next(); } else { this.slots++; }
  }
}

const routerSemaphores = new Map<string, Semaphore>();
function getRouterSemaphore(host: string, port: number): Semaphore {
  const key = `${host}:${port}`;
  if (!routerSemaphores.has(key)) routerSemaphores.set(key, new Semaphore(2));
  return routerSemaphores.get(key)!;
}

/**
 * Minimum gap (ms) between consecutive API connections to the same router.
 * Acts as a global safety net against "Rate exceeded" errors from RouterOS.
 * High-priority calls (mutations, user actions) are not throttled separately —
 * the semaphore ensures fairness, and 500ms is imperceptible for user actions.
 * Set ROUTER_MIN_GAP_MS=0 in env to disable.
 */
const ROUTER_MIN_GAP_MS = parseInt(process.env.ROUTER_MIN_GAP_MS ?? "500", 10);
const lastRouterConnectedAt = new Map<string, number>();

export async function withRouter<T>(
  conn: RouterConnection,
  fn: (api: RouterOSAPI) => Promise<T>,
  timeout = 15000,
  priority: "high" | "normal" = "normal",
): Promise<T> {
  const key = `${conn.host}:${conn.port}`;
  const sem = getRouterSemaphore(conn.host, conn.port);
  await sem.acquire(priority);

  // Rate-limit: enforce minimum gap between consecutive connections to the same router.
  // Checked AFTER semaphore acquire so the gap is per-slot (not global), which
  // means 2 slots × 500ms gap = max 4 connections/s — well within RouterOS limits.
  if (ROUTER_MIN_GAP_MS > 0) {
    const last = lastRouterConnectedAt.get(key) ?? 0;
    const wait = ROUTER_MIN_GAP_MS - (Date.now() - last);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  }
  lastRouterConnectedAt.set(key, Date.now());

  const api = new RouterOSAPI({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password,
    timeout,
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("RouterOS operation timed out")), timeout);
  });

  try {
    await Promise.race([api.connect(), timeoutPromise]);
    const result = await Promise.race([fn(api), timeoutPromise]);
    return result;
  } finally {
    if (timer !== null) clearTimeout(timer);
    try { api.close(); } catch { /* ignore close errors */ }
    sem.release();
  }
}

/**
 * Ping rapide style Mikhmon : simple test TCP sur le port RouterOS API.
 * Pas d'authentification, pas de commande — si le socket s'ouvre, le routeur
 * est en ligne. Équivalent de fsockopen($host, $port, $errno, $errstr, 3) en PHP.
 * Résultat typique : <200 ms si en ligne, ~3 s si hors ligne.
 */
export async function pingRouter(conn: RouterConnection): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(3_000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error",   () => done(false));
    socket.connect(conn.port, conn.host);
  });
}

export async function testConnection(conn: RouterConnection): Promise<{ success: boolean; message: string; routerBoard: string | null; version: string | null }> {
  try {
    return await withRouter(conn, async (api) => {
      const [board] = await api.write("/system/routerboard/print");
      const [res] = await api.write("/system/resource/print");
      return {
        success: true,
        message: "Connexion établie",
        routerBoard: (board?.["model"] as string) ?? null,
        version: (res?.["version"] as string) ?? null,
      };
    }, 8000);
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Erreur de connexion",
      routerBoard: null,
      version: null,
    };
  }
}

export interface RouterInfo {
  identity: string | null;
  boardName: string | null;
  model: string | null;
  serialNumber: string | null;
  routerOsVersion: string | null;
  firmwareVersion: string | null;
  cpu: string | null;
  cpuCount: string | null;
  totalMemory: string | null;
  freeMemory: string | null;
  uptime: string | null;
  architecture: string | null;
  clockDate: string | null;
  clockTime: string | null;
}

export async function getRouterInfo(conn: RouterConnection): Promise<RouterInfo> {
  return withRouter(conn, async (api) => {
    // Mikhmon-style : les 4 appels RouterOS lancés en parallèle (Promise.all)
    // au lieu de 4 await séquentiels → gain de ~3× sur la latence réseau.
    const [resArr, idArr, boardArr, clockArr] = await Promise.all([
      api.write("/system/resource/print"),
      api.write("/system/identity/print").catch(() => [] as Record<string, unknown>[]),
      api.write("/system/routerboard/print").catch(() => [] as Record<string, unknown>[]),
      api.write("/system/clock/print").catch(() => [] as Record<string, unknown>[]),
    ]);

    const res   = resArr[0]   ?? {};
    const idRes = idArr[0]    ?? null;
    const board = boardArr[0] ?? null;
    const clock = clockArr[0] ?? null;

    return {
      identity:       idRes?.["name"]                   ? decodeRouterText(idRes["name"] as string)  : null,
      boardName:      ((res["board-name"] as string) ?? "").trim() ? decodeRouterText(res["board-name"] as string) : null,
      model:          board?.["model"]                  ? decodeRouterText(board["model"] as string) : null,
      serialNumber:   (board?.["serial-number"]   as string) ?? null,
      firmwareVersion:(board?.["current-firmware"] as string) ?? null,
      routerOsVersion:(res["version"]             as string) ?? null,
      cpu:            (res["cpu"]                 as string) ?? null,
      cpuCount:       (res["cpu-count"]           as string) ?? null,
      totalMemory:    (res["total-memory"]        as string) ?? null,
      freeMemory:     (res["free-memory"]         as string) ?? null,
      uptime:         (res["uptime"]              as string) ?? null,
      architecture:   (res["architecture-name"]   as string) ?? null,
      clockDate:      (clock?.["date"]            as string) ?? null,
      clockTime:      (clock?.["time"]            as string) ?? null,
    };
  }, 12000);
}

/**
 * Compte rapide style Mikhmon — /ip/hotspot/active/print count-only.
 * Utilise =.proplist=.id pour ne transférer que les identifiants internes,
 * sans uptime / bytes-in / bytes-out / address / mac → ~10-50× moins de
 * données qu'un listSessions() complet sur un parc de 100+ sessions actives.
 */
export async function countSessionsFast(conn: RouterConnection): Promise<number> {
  return withRouter(conn, async (api) => {
    const result = await api.write("/ip/hotspot/active/print", ["=.proplist=.id"]);
    return result.length;
  }, 5_000, "high");
}

/**
 * Fetch minimal des vouchers pour le comptage rapide du dashboard.
 * N'interroge que name, disabled, profile, mac-address — les seuls champs
 * nécessaires à computeUsersCount(). Pas de password / comment / limits.
 * Beaucoup plus rapide sur les grands parcs (>5 000 vouchers).
 */
export async function listHotspotUsersFast(conn: RouterConnection): Promise<HotspotUser[]> {
  return withRouter(conn, async (api) => {
    const users = await api.write("/ip/hotspot/user/print", [
      "=.proplist=name,disabled,profile,mac-address",
    ]);
    return users.map((u) => ({
      username:        decodeRouterText((u["name"]        as string) ?? ""),
      password:        "",   // non récupéré, non nécessaire au comptage
      profile:         decodeRouterText((u["profile"]     as string) ?? ""),
      comment:         null,
      limitUptime:     null,
      limitBytesTotal: null,
      macAddress:      (u["mac-address"] as string) || null,
      server:          null,
      disabled:        (u["disabled"]    as string) === "true",
    }));
  }, 15_000, "high");
}

const EMPTY_PARSED = { price: "", validity: "", lockMac: false, sellingPrice: "", expiredMode: "", parentQueue: "" };

export async function listProfiles(conn: RouterConnection): Promise<HotspotProfile[]> {
  return withRouter(conn, async (api) => {
    const [profiles, schedulers] = await Promise.all([
      api.write("/ip/hotspot/user/profile/print"),
      api.write("/system/scheduler/print").catch(() => [] as Record<string, unknown>[]),
    ]);
    const schedulerByName = new Map<string, { disabled: boolean }>();
    for (const s of schedulers) {
      const rawName = (s["name"] as string) ?? "";
      const n = decodeRouterText(rawName);
      if (!n) continue;
      const disabled = String(s["disabled"] ?? "false").toLowerCase() === "true";
      schedulerByName.set(n, { disabled });
    }
    const mapped = profiles.map((p) => {
      const onLogin = (p["on-login"] as string) ?? "";
      const parsed = onLogin.includes(",") ? parseProfileOnLogin(onLogin) : EMPTY_PARSED;
      const name = decodeRouterText((p["name"] as string) ?? "");
      const sch = schedulerByName.get(name);
      const schedulerMonitorActive = !!(sch && !sch.disabled);
      return {
        mikrotikId:  (p[".id"] as string) ?? "",
        name,
        rateLimit:   (p["rate-limit"] as string) || null,
        validity:    parsed.validity || null,
        price:       parsed.price || null,
        sellingPrice: parsed.sellingPrice || null,
        sharedUsers: (p["shared-users"] as string) || null,
        addrPool:    (p["address-pool"] as string) || null,
        lockMac:     parsed.lockMac,
        expiredMode: parsed.expiredMode || null,
        parentQueue: (p["parent-queue"] as string) || parsed.parentQueue || null,
        schedulerMonitorActive,
      };
    });
    return sortHotspotProfilesByCreationOrder(mapped);
  });
}

/** RouterOS internal row id (e.g. *12). Rejects values that could break API sentence parsing. */
function looksLikeRouterOsRowId(id: string): boolean {
  return /^\*[0-9A-Fa-f]{1,16}$/i.test(id);
}

export async function updateProfile(conn: RouterConnection, originalName: string, opts: CreateProfileOptions): Promise<void> {
  return withRouter(conn, async (api) => {
    const mid = opts.mikrotikId?.trim();
    const nameChanging = originalName !== opts.name;

    // ── Étape 1 : tous les lookups en parallèle (style Mikhmon) ──────────────
    // • Si mikrotikId est fourni (cas normal), on l'utilise sans roundtrip de vérification.
    // • Les schedulers (nouveau nom + ancien si rename) sont cherchés simultanément.
    const needProfileLookup = !mid || !looksLikeRouterOsRowId(mid);
    const [profileArr, schedNew, schedOld] = await Promise.all([
      needProfileLookup
        ? api.write("/ip/hotspot/user/profile/print", [`?name=${originalName}`]).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]),
      api.write("/system/scheduler/print", [`?name=${opts.name}`]).catch(() => [] as Record<string, unknown>[]),
      nameChanging
        ? api.write("/system/scheduler/print", [`?name=${originalName}`]).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);

    // Résoudre l'ID du profil (avec fallback Win1252 si nom non trouvé)
    let profileId: string;
    if (!needProfileLookup) {
      profileId = mid!;
    } else if (profileArr.length > 0) {
      profileId = profileArr[0][".id"] as string;
    } else {
      const byEnc = await api.write("/ip/hotspot/user/profile/print", [`?name=${toWin1252(originalName)}`]).catch(() => []);
      if (!byEnc.length) throw new Error(`Profil "${originalName}" introuvable`);
      profileId = byEnc[0][".id"] as string;
    }

    const version = await getCachedRouterOsVersion(api, conn); // généralement instantané (cache)
    const expmode = toMikhmonExpmode(opts.expiredMode);
    const onLogin = generateMikHmonOnLogin(opts, version);
    const args = [
      `=.id=${profileId}`,
      `=name=${toWin1252(opts.name)}`,
      `=on-login=${toWin1252(onLogin)}`,
      `=shared-users=${opts.sharedUsers || "1"}`,
      `=status-autorefresh=${HOTSPOT_PROFILE_STATUS_AUTOREFRESH}`,
    ];
    if (opts.rateLimit)   args.push(`=rate-limit=${opts.rateLimit}`);
    else                  args.push(`=rate-limit=`);
    if (opts.addrPool)    args.push(`=address-pool=${opts.addrPool}`);
    else                  args.push(`=address-pool=`);
    if (opts.parentQueue) args.push(`=parent-queue=${toWin1252(opts.parentQueue)}`);
    else                  args.push(`=parent-queue=`);

    // ── Étape 2 : profile/set + suppression de l'ancien scheduler en parallèle ─
    const step2: Promise<unknown>[] = [api.write("/ip/hotspot/user/profile/set", args)];
    if (nameChanging) {
      for (const s of schedOld) {
        const sid = s[".id"] as string | undefined;
        if (sid) step2.push(api.write("/system/scheduler/remove", [`=.id=${sid}`]).catch(() => undefined));
      }
    }
    await Promise.all(step2);

    // ── Étape 3 : mettre à jour/créer le scheduler avec le nouveau nom ─────────
    await applyProfileScheduler(api, opts.name, expmode, schedNew, version);
  });
}

export async function deleteProfile(conn: RouterConnection, name: string): Promise<void> {
  return withRouter(conn, async (api) => {
    const target = (name ?? "").trim();
    if (!target) throw new Error("Nom de profil vide");

    const findByName = async (candidate: string) =>
      api.write("/ip/hotspot/user/profile/print", [`?name=${candidate}`]).catch(() => [] as Record<string, unknown>[]);

    // ── Étape 1 : trouver profil + scheduler en parallèle (style Mikhmon) ───
    const [found, schedulers] = await Promise.all([
      findByName(target),
      api.write("/system/scheduler/print", [`?name=${name}`]).catch(() => [] as Record<string, unknown>[]),
    ]);

    // Fallbacks encodage (séquentiels seulement si le 1er lookup échoue)
    let profile = found;
    if (!profile.length) profile = await findByName(toWin1252(target));
    if (!profile.length) {
      const all = await api.write("/ip/hotspot/user/profile/print");
      profile = all.filter((p) => {
        const raw = (p["name"] as string) ?? "";
        return raw === target || fixEncoding(raw) === target || fromWin1252(raw) === target;
      });
    }
    if (!profile.length) throw new Error(`Profil "${name}" introuvable sur MikroTik`);

    const pid = profile[0][".id"] as string;

    // ── Étape 2 : supprimer profil + scheduler(s) en parallèle ─────────────
    // Pas de vérification "hard" après suppression — comme Mikhmon, on fait
    // confiance à l'API RouterOS : si /remove n'a pas levé d'erreur, c'est fait.
    await Promise.all([
      api.write("/ip/hotspot/user/profile/remove", [`=.id=${pid}`]),
      ...schedulers.flatMap((s) => {
        const sid = s[".id"] as string | undefined;
        return sid ? [api.write("/system/scheduler/remove", [`=.id=${sid}`]).catch(() => undefined)] : [];
      }),
    ]);
  });
}

// ─── Hotspot IP-bindings (MAC bypass) ──────────────────────────────────────
//
// MikroTik's `/ip/hotspot/ip-binding` table lets specific MAC addresses
// bypass the captive portal entirely (`type=bypassed`), be blocked
// (`type=blocked`) or simply have a custom one-to-one NAT (`type=regular`).
// Most common use-case: trust a printer / smart-TV / personal device so it
// goes online without ever seeing the login page.
export interface HotspotIpBinding {
  id: string;                 // MikroTik internal id (.id)
  macAddress: string;         // empty if binding is keyed by IP only
  address: string;            // requested IP (optional)
  toAddress: string;          // 1-to-1 NAT target (optional)
  type: "bypassed" | "blocked" | "regular";
  server: string;             // hotspot server scope ("all" if any)
  comment: string;
  disabled: boolean;
}

export interface DhcpLease {
  id: string;
  address: string;
  macAddress: string;
  activeAddress: string | null;
  activeMacAddress: string | null;
  activeHostName: string | null;
  hostName: string | null;
  status: string | null;
  expiresAfter: string | null;
  server: string | null;
  comment: string | null;
  dynamic: boolean;
}

const dhcpLeaseCache = new Map<string, { rows: DhcpLease[]; exp: number }>();
const DHCP_LEASE_CACHE_TTL = 60_000;

function routerCacheKey(conn: RouterConnection): string {
  return `${conn.host}:${conn.port}`;
}

function normalizeQueueTargetIp(binding: Pick<HotspotIpBinding, "address" | "toAddress">): string | null {
  const raw = (binding.address || binding.toAddress || "").trim();
  if (!raw) return null;
  return raw.includes("/") ? raw : `${raw}/32`;
}

function normalizeMac(mac: string | null | undefined): string {
  return String(mac ?? "").trim().toUpperCase().replace(/-/g, ":");
}

function normalizeIpTarget(raw: string | null | undefined): string | null {
  const ip = String(raw ?? "").trim();
  if (!ip) return null;
  // Skip invalid / dynamic placeholders we don't want in queue target.
  if (ip === "0.0.0.0") return null;
  return ip.includes("/") ? ip : `${ip}/32`;
}

function extractLinkedUsernameFromComment(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const m = comment.match(/\(([^()]+)\)\s*$/);
  const value = m?.[1]?.trim() ?? "";
  return value || null;
}

function stripBindingStructuralTags(comment: string | null | undefined): string {
  return String(comment ?? "")
    .replace(/\s*\[Expire le:[^\]]+\]\s*/g, "")
    .replace(/\s*\[Up:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[Down:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[vnetqu:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetqd:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetbp:[^\]]+\]\s*/g, "")
    .trim();
}

function stripLinkedSuffix(comment: string): string {
  return comment.replace(/\s*\([^()]+\)\s*$/, "").trim();
}

function buildLegacyBypassQueueName(binding: Pick<HotspotIpBinding, "macAddress" | "address" | "id">): string {
  const key = (binding.macAddress || binding.address || binding.id || "binding")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `bpq-${key.slice(0, 40)}`;
}

function normalizeQueueLabelPart(value: string | null | undefined, fallback: string): string {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  return v || fallback;
}

function buildPreferredBypassQueueName(
  binding: Pick<HotspotIpBinding, "macAddress" | "comment">,
  hostName: string | null,
): string {
  const baseComment = stripLinkedSuffix(stripBindingStructuralTags(binding.comment));
  const device = normalizeQueueLabelPart(baseComment || hostName, "Bypass");
  const username = extractLinkedUsernameFromComment(binding.comment);
  const identity = normalizeQueueLabelPart(username, normalizeMac(binding.macAddress) || "Unknown");
  // Keep names readable and bounded.
  return `${device} (${identity})`.slice(0, 63);
}

async function resolveQueueTargetIp(
  api: RouterOSAPI,
  conn: RouterConnection,
  binding: Pick<HotspotIpBinding, "address" | "toAddress" | "macAddress">,
): Promise<{ target: string | null; hostName: string | null }> {
  const direct = normalizeQueueTargetIp(binding);
  if (direct) return { target: direct, hostName: null };

  const mac = normalizeMac(binding.macAddress);
  if (!mac) return { target: null, hostName: null };

  const cacheKey = routerCacheKey(conn);
  const cached = dhcpLeaseCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    const bound = cached.rows.find((x) => normalizeMac(x.macAddress) === mac && x.status?.toLowerCase() === "bound");
    if (bound) {
      const candidate = normalizeIpTarget(bound.activeAddress || bound.address);
      if (candidate) return { target: candidate, hostName: bound.activeHostName || bound.hostName || null };
    }
    const any = cached.rows.find((x) => normalizeMac(x.macAddress) === mac);
    if (any) {
      const candidate = normalizeIpTarget(any.activeAddress || any.address);
      if (candidate) return { target: candidate, hostName: any.activeHostName || any.hostName || null };
    }
  }

  const leaseRows = await api.write("/ip/dhcp-server/lease/print", [
    "?mac-address=" + mac,
    "=.proplist=address,status,active-address,active-host-name,host-name",
  ]).catch(() => []);
  for (const row of leaseRows) {
    const status = String(row["status"] ?? "").toLowerCase();
    const address = ((row["active-address"] as string | undefined) ?? (row["address"] as string | undefined) ?? "");
    // Prefer bound lease first, but fall back to any valid lease address.
    if (status === "bound") {
      const candidate = normalizeIpTarget(address);
      if (candidate) {
        return {
          target: candidate,
          hostName: ((row["active-host-name"] as string | undefined) ?? (row["host-name"] as string | undefined) ?? null),
        };
      }
    }
  }
  for (const row of leaseRows) {
    const candidate = normalizeIpTarget(
      ((row["active-address"] as string | undefined) ?? (row["address"] as string | undefined) ?? ""),
    );
    if (candidate) {
      return {
        target: candidate,
        hostName: ((row["active-host-name"] as string | undefined) ?? (row["host-name"] as string | undefined) ?? null),
      };
    }
  }
  return { target: null, hostName: null };
}

export async function resolveBindingAddressFromDhcp(
  conn: RouterConnection,
  binding: Pick<HotspotIpBinding, "address" | "toAddress" | "macAddress">,
): Promise<string | null> {
  return withRouter(conn, async (api) => {
    const resolved = await resolveQueueTargetIp(api, conn, binding);
    const target = resolved.target ?? "";
    if (!target) return null;
    return target.replace(/\/\d+$/, "");
  }, 3000, "high");
}

export async function upsertIpBindingQueue(
  conn: RouterConnection,
  binding: HotspotIpBinding,
  upLimit: string,
  downLimit: string,
): Promise<void> {
  return withRouter(conn, async (api) => {
    const up = upLimit.trim();
    const down = downLimit.trim();
    const marker = `bpq:${binding.id}`;
    const legacyName = buildLegacyBypassQueueName(binding);
    const resolved = await resolveQueueTargetIp(api, conn, binding);
    const preferredName = buildPreferredBypassQueueName(binding, resolved.hostName);
    const existingByMarker = await api.write("/queue/simple/print", [`?comment=${marker}`]).catch(() => []);
    let existing = existingByMarker[0] ?? null;
    if (!existing) {
      // Lightweight fallback for pre-marker queues; if found, we migrate it by setting the marker.
      const byPreferred = await api.write("/queue/simple/print", [`?name=${preferredName}`]).catch(() => []);
      const byLegacy = preferredName === legacyName ? [] : await api.write("/queue/simple/print", [`?name=${legacyName}`]).catch(() => []);
      existing = byPreferred[0] ?? byLegacy[0] ?? null;
    }

    // No limits configured OR no usable target IP => remove existing queue.
    const target = resolved.target;
    if ((!up && !down) || !target) {
      const exId = (existing?.[".id"] as string | undefined) ?? "";
      if (exId) await api.write("/queue/simple/remove", [`=.id=${exId}`]).catch(() => undefined);
      return;
    }

    const maxLimit = `${up || "0"}/${down || "0"}`;
    const disabled = binding.disabled ? "yes" : "no";
    const exId = (existing?.[".id"] as string | undefined) ?? "";
    if (exId) {
      await api.write("/queue/simple/set", [
        `=.id=${exId}`,
        `=name=${preferredName}`,
        `=target=${target}`,
        `=max-limit=${maxLimit}`,
        `=disabled=${disabled}`,
        `=comment=${marker}`,
      ]);
      return;
    }
    await api.write("/queue/simple/add", [
      `=name=${preferredName}`,
      `=target=${target}`,
      `=max-limit=${maxLimit}`,
      `=disabled=${disabled}`,
      `=comment=${marker}`,
    ]);
  }, 4000, "high");
}

export async function removeIpBindingQueue(
  conn: RouterConnection,
  binding: Pick<HotspotIpBinding, "id">,
): Promise<void> {
  return withRouter(conn, async (api) => {
    const marker = `bpq:${binding.id}`;
    const existing = await api.write("/queue/simple/print", [`?comment=${marker}`]).catch(() => []);
    const exId = (existing[0]?.[".id"] as string | undefined) ?? "";
    if (exId) await api.write("/queue/simple/remove", [`=.id=${exId}`]).catch(() => undefined);
  }, 4000, "high");
}

export async function setIpBindingQueueDisabledByBindingId(
  conn: RouterConnection,
  bindingId: string,
  disabled: boolean,
): Promise<void> {
  return withRouter(conn, async (api) => {
    const marker = `bpq:${bindingId}`;
    const existing = await api.write("/queue/simple/print", [`?comment=${marker}`]).catch(() => []);
    const exId = (existing[0]?.[".id"] as string | undefined) ?? "";
    if (!exId) return;
    await api.write("/queue/simple/set", [`=.id=${exId}`, `=disabled=${disabled ? "yes" : "no"}`]).catch(() => undefined);
  }, 3000, "high");
}

export async function listDhcpLeases(conn: RouterConnection): Promise<DhcpLease[]> {
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/dhcp-server/lease/print");
    const mapped = rows.map((r): DhcpLease => ({
      id: (r[".id"] as string) ?? "",
      address: (r["address"] as string) ?? "",
      macAddress: normalizeMac((r["mac-address"] as string) ?? ""),
      activeAddress: ((r["active-address"] as string) ?? "").trim() || null,
      activeMacAddress: normalizeMac((r["active-mac-address"] as string) ?? "") || null,
      activeHostName: decodeRouterText(((r["active-host-name"] as string) ?? "").trim()) || null,
      hostName: decodeRouterText(((r["host-name"] as string) ?? "").trim()) || null,
      status: ((r["status"] as string) ?? "").trim() || null,
      expiresAfter: ((r["expires-after"] as string) ?? "").trim() || null,
      server: ((r["server"] as string) ?? "").trim() || null,
      comment: decodeRouterText(((r["comment"] as string) ?? "").trim()) || null,
      dynamic: ((r["dynamic"] as string) ?? "") === "true",
    }));
    dhcpLeaseCache.set(routerCacheKey(conn), { rows: mapped, exp: Date.now() + DHCP_LEASE_CACHE_TTL });
    return mapped;
  });
}

export async function listIpBindings(conn: RouterConnection): Promise<HotspotIpBinding[]> {
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/hotspot/ip-binding/print");
    return rows.map((b): HotspotIpBinding => {
      const t = ((b["type"] as string) || "regular").toLowerCase();
      const type: HotspotIpBinding["type"] =
        t === "bypassed" || t === "blocked" ? t : "regular";
      return {
        id:         (b[".id"]        as string) ?? "",
        macAddress: ((b["mac-address"] as string) ?? "").toUpperCase(),
        address:    (b["address"]    as string) ?? "",
        toAddress:  (b["to-address"] as string) ?? "",
        type,
        server:     (b["server"]     as string) ?? "all",
        comment:    decodeRouterText((b["comment"] as string) ?? ""),
        disabled:   (b["disabled"]   as string) === "true",
      };
    });
  });
}

function mapIpBindingRow(b: Record<string, unknown>): HotspotIpBinding {
  const t = ((b["type"] as string) || "regular").toLowerCase();
  const type: HotspotIpBinding["type"] =
    t === "bypassed" || t === "blocked" ? t : "regular";
  return {
    id:         (b[".id"]        as string) ?? "",
    macAddress: ((b["mac-address"] as string) ?? "").toUpperCase(),
    address:    (b["address"]    as string) ?? "",
    toAddress:  (b["to-address"] as string) ?? "",
    type,
    server:     (b["server"]     as string) ?? "all",
    comment:    decodeRouterText((b["comment"] as string) ?? ""),
    disabled:   (b["disabled"]   as string) === "true",
  };
}

export async function getIpBindingById(conn: RouterConnection, id: string): Promise<HotspotIpBinding | null> {
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/hotspot/ip-binding/print", [`?.id=${id}`]).catch(() => []);
    if (!rows.length) return null;
    return mapIpBindingRow(rows[0] as Record<string, unknown>);
  }, 3000, "high");
}

export async function findIpBindingFast(
  conn: RouterConnection,
  opts: { macAddress?: string; address?: string },
): Promise<HotspotIpBinding | null> {
  return withRouter(conn, async (api) => {
    const mac = (opts.macAddress ?? "").trim().toUpperCase();
    const addr = (opts.address ?? "").trim();
    if (mac) {
      const rows = await api.write("/ip/hotspot/ip-binding/print", [`?mac-address=${mac}`]).catch(() => []);
      if (rows.length) return mapIpBindingRow(rows[0] as Record<string, unknown>);
    }
    if (addr) {
      const rows = await api.write("/ip/hotspot/ip-binding/print", [`?address=${addr}`]).catch(() => []);
      if (rows.length) return mapIpBindingRow(rows[0] as Record<string, unknown>);
    }
    return null;
  }, 3000, "high");
}

export interface AddIpBindingOpts {
  macAddress?: string;
  address?: string;
  toAddress?: string;
  type?: "bypassed" | "blocked" | "regular";
  server?: string;
  comment?: string;
  disabled?: boolean;
}

export async function addIpBinding(conn: RouterConnection, opts: AddIpBindingOpts): Promise<void> {
  return withRouter(conn, async (api) => {
    const mac = (opts.macAddress ?? "").trim().toUpperCase();
    const addr = (opts.address ?? "").trim();
    if (!mac && !addr) {
      throw new Error("Adresse MAC ou IP requise");
    }
    const args: string[] = [`=type=${opts.type ?? "bypassed"}`];
    if (mac)            args.push(`=mac-address=${mac}`);
    if (addr)           args.push(`=address=${addr}`);
    if (opts.toAddress) args.push(`=to-address=${opts.toAddress.trim()}`);
    if (opts.server && opts.server !== "all") args.push(`=server=${opts.server}`);
    if (opts.comment)   args.push(`=comment=${toWin1252(opts.comment)}`);
    if (opts.disabled)  args.push(`=disabled=yes`);
    await api.write("/ip/hotspot/ip-binding/add", args);
  }, 4000, "high");
}

export async function updateIpBinding(
  conn: RouterConnection,
  id: string,
  opts: Partial<AddIpBindingOpts>,
): Promise<void> {
  return withRouter(conn, async (api) => {
    const args: string[] = [`=.id=${id}`];
    const mac = opts.macAddress?.trim().toUpperCase();
    const addr = opts.address?.trim();
    const toAddr = opts.toAddress?.trim();
    const srv = opts.server?.trim();

    // RouterOS rejects empty address fields ("value of address expects range of ip adress").
    // For partial updates, skip empty strings instead of sending clear operations.
    if (mac)           args.push(`=mac-address=${mac}`);
    if (addr)          args.push(`=address=${addr}`);
    if (toAddr)        args.push(`=to-address=${toAddr}`);
    if (opts.type)     args.push(`=type=${opts.type}`);
    if (srv)           args.push(`=server=${srv}`);
    if (opts.comment !== undefined) args.push(`=comment=${toWin1252(opts.comment)}`);
    if (opts.disabled   !== undefined) args.push(`=disabled=${opts.disabled ? "yes" : "no"}`);
    await api.write("/ip/hotspot/ip-binding/set", args);
  }, 4000, "high");
}

export async function deleteIpBinding(conn: RouterConnection, id: string): Promise<void> {
  return withRouter(conn, async (api) => {
    await api.write("/ip/hotspot/ip-binding/remove", [`=.id=${id}`]);
  }, 4000, "high");
}

// ─── Hotspot servers (instances) ────────────────────────────────────────────
//
// Listed via `/ip/hotspot/print`. Used by IP-binding UI to populate a
// "Server" dropdown — instead of asking the user to type the name manually.
export interface HotspotServer {
  name: string;
  interface: string;
  profile: string;
  disabled: boolean;
}

export async function listHotspotServers(conn: RouterConnection): Promise<HotspotServer[]> {
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/hotspot/print");
    return rows.map((s): HotspotServer => ({
      name:      decodeRouterText((s["name"] as string) ?? ""),
      interface: decodeRouterText((s["interface"] as string) ?? ""),
      profile:   decodeRouterText((s["profile"] as string) ?? ""),
      disabled:  (s["disabled"]  as string) === "true",
    }));
  });
}

export async function listAddressPools(conn: RouterConnection): Promise<string[]> {
  return withRouter(conn, async (api) => {
    const pools = await api.write("/ip/pool/print");
    return pools.map((p) => (p["name"] as string) ?? "").filter(Boolean);
  });
}

export interface CreateProfileOptions {
  name: string;
  validity: string;
  price: string;
  sellingPrice: string;
  sharedUsers: string;
  addrPool: string;
  rateLimit: string;
  expiredMode: string;   // "None" | "Remove" | "Notice" | "Remove & Record" | "Notice & Record"
  lockMac: boolean;
  parentQueue: string;
  /** Internal RouterOS `.id` (from list profiles). Used on update to resolve by id instead of by name. */
  mikrotikId?: string;
}

function toMikhmonExpmode(mode: string): string {
  const m = mode.trim().toLowerCase();
  if (m === "remc" || m === "remove & record" || m === "remove and record") return "remc";
  if (m === "ntfc" || m === "notice & record" || m === "notice and record") return "ntfc";
  if (m === "rem" || m === "remove") return "rem";
  if (m === "ntf" || m === "notice" || m === "disable") return "ntf";
  return "0";
}

function isRouterOsBefore710(version: string | null | undefined): boolean {
  if (!version) return false;
  const m = String(version).match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major < 7 || (major === 7 && minor <= 9);
}

function generateMikHmonOnLogin(opts: CreateProfileOptions, routerVersion?: string | null): string {
  const expmode = toMikhmonExpmode(opts.expiredMode);
  const lockMacStr = opts.lockMac ? "Enable" : "Disable";
  const macLockPart = opts.lockMac
    ? ` :if ([/ip hotspot user get [find name=$user] mac-address]="") do={ /ip hotspot user set mac-address=[/ip hotspot active get [find user=$user] mac-address] [find where name="$user"];};`
    : "";
  const legacyDate = isRouterOsBefore710(routerVersion);
  const yearExpr = legacyDate ? `:local year [ :pick $date 7 11 ];` : `:local year [ :pick $date 0 4 ];`;
  const monthExpr = legacyDate ? `:local month [ :pick $date 0 3 ];` : `:local month [ :pick $date 5 7 ];`;
  // Mikhmon-compatible legacy format:
  // :put(",expmode,price,validity,sprice,,lockunlock,")
  return `:put (",${expmode},${opts.price},${opts.validity},${opts.sellingPrice},,${lockMacStr},"); {:local comment [ /ip hotspot user get [/ip hotspot user find where name="$user"] comment]; :local ucode [:pic $comment 0 2]; :if ($ucode = "vc" or $ucode = "up" or $comment = "") do={ :local date [ /system clock get date ];${yearExpr}${monthExpr} /sys sch add name="$user" disable=no start-date=$date interval="${opts.validity}"; :delay 5s; :local exp [ /sys sch get [ /sys sch find where name="$user" ] next-run]; :local getxp [len $exp]; :if ($getxp = 15) do={ :local d [:pic $exp 0 6]; :local t [:pic $exp 7 16]; :local s ("/"); :local exp ("$d$s$year $t"); /ip hotspot user set comment="$exp" [find where name="$user"];}; :if ($getxp = 8) do={ /ip hotspot user set comment="$date $exp" [find where name="$user"];}; :if ($getxp > 15) do={ /ip hotspot user set comment="$exp" [find where name="$user"];};:delay 5s; /sys sch remove [find where name="$user"];${macLockPart} :local mac $"mac-address"; :local time [/system clock get time ]; /system script add name="$date-|-$time-|-$user-|-${opts.price}-|-$address-|-$mac-|-${opts.validity}-|-${opts.name}-|-$comment" owner="$month$year" source="$date" comment="mikhmon"}}`;
}

function generateProfileSchedulerOnEvent(profileName: string, expmode: string, routerVersion?: string | null): string {
  const action = expmode === "ntf" || expmode === "ntfc"
    ? `[ /ip hotspot user disable $i ];`
    : `[ /ip hotspot user remove $i ];`;
  if (isRouterOsBefore710(routerVersion)) {
    return `:local dateint do={:local montharray ( "jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec" );:local days [ :pick $d 4 6 ];:local month [ :pick $d 0 3 ];:local year [ :pick $d 7 11 ];:local monthint ([ :find $montharray $month]);:local month ($monthint + 1);:if ( [len $month] = 1) do={:local zero ("0");:return [:tonum ("$year$zero$month$days")];} else={:return [:tonum ("$year$month$days")];}}; :local timeint do={ :local hours [ :pick $t 0 2 ]; :local minutes [ :pick $t 3 5 ]; :return ($hours * 60 + $minutes) ; }; :local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [$dateint d=$date] ; :local curtime [$timeint t=$time] ; :foreach i in [ /ip hotspot user find where profile="${profileName}" ] do={ :local comment [ /ip hotspot user get $i comment]; :local name [ /ip hotspot user get $i name]; :local gettime [:pic $comment 12 20]; :if ([:pic $comment 3] = "/" and [:pic $comment 6] = "/") do={:local expd [$dateint d=$comment] ; :local expt [$timeint t=$gettime] ; :if (($expd < $today and $expt < $curtime) or ($expd < $today and $expt > $curtime) or ($expd = $today and $expt < $curtime)) do={ ${action} [ /ip hotspot active remove [find where user=$name] ];}}}`;
  }
  return `:local dateint do={:local montharray ( "01","02","03","04","05","06","07","08","09","10","11","12" );:local days [ :pick $d 8 10 ];:local month [ :pick $d 5 7 ];:local year [ :pick $d 0 4 ];:local monthint ([ :find $montharray $month]);:local month ($monthint + 1);:if ( [len $month] = 1) do={:local zero ("0");:return [:tonum ("$year$zero$month$days")];} else={:return [:tonum ("$year$month$days")];}}; :local timeint do={ :local hours [ :pick $t 0 2 ]; :local minutes [ :pick $t 3 5 ]; :return ($hours * 60 + $minutes) ; }; :local date [ /system clock get date ]; :local time [ /system clock get time ]; :local today [$dateint d=$date] ; :local curtime [$timeint t=$time] ; :foreach i in [ /ip hotspot user find where profile="${profileName}" ] do={ :local comment [ /ip hotspot user get $i comment]; :local name [ /ip hotspot user get $i name]; :local gettime [:pic $comment 11 19]; :if ([:pic $comment 4] = "-" and [:pic $comment 7] = "-") do={:local expd [$dateint d=$comment] ; :local expt [$timeint t=$gettime] ; :if (($expd < $today and $expt < $curtime) or ($expd < $today and $expt > $curtime) or ($expd = $today and $expt < $curtime)) do={ ${action} [ /ip hotspot active remove [find where user=$name] ];}}}`;
}

async function upsertProfileScheduler(
  api: RouterOSAPI,
  profileName: string,
  expmode: string,
  routerVersion?: string | null,
): Promise<void> {
  const existing = await api.write("/system/scheduler/print", [`?name=${profileName}`]).catch(() => []);
  await applyProfileScheduler(api, profileName, expmode, existing, routerVersion);
}

/**
 * Applique la gestion du scheduler d'un profil à partir d'une liste
 * de schedulers pré-chargés (permet de paralléliser le find avec d'autres appels).
 * Style Mikhmon : pas de re-fetch, on utilise le résultat déjà disponible.
 */
async function applyProfileScheduler(
  api: RouterOSAPI,
  profileName: string,
  expmode: string,
  existing: Record<string, unknown>[],
  routerVersion?: string | null,
): Promise<void> {
  if (expmode === "0") {
    for (const s of existing) {
      const id = s[".id"] as string | undefined;
      if (id) await api.write("/system/scheduler/remove", [`=.id=${id}`]).catch(() => undefined);
    }
    return;
  }
  const onEvent = generateProfileSchedulerOnEvent(profileName, expmode, routerVersion);
  if (existing.length > 0) {
    const id = existing[0][".id"] as string | undefined;
    if (!id) return;
    await api.write("/system/scheduler/set", [
      `=.id=${id}`,
      "=disabled=no",
      "=interval=00:02:54",
      `=on-event=${onEvent}`,
    ]);
    return;
  }
  await api.write("/system/scheduler/add", [
    `=name=${profileName}`,
    "=disabled=no",
    "=interval=00:02:54",
    `=on-event=${onEvent}`,
  ]);
}

export async function createProfile(conn: RouterConnection, opts: CreateProfileOptions): Promise<void> {
  return withRouter(conn, async (api) => {
    const version = await getCachedRouterOsVersion(api, conn);
    const expmode = toMikhmonExpmode(opts.expiredMode);
    const onLogin = generateMikHmonOnLogin(opts, version);
    const args = [
      `=name=${toWin1252(opts.name)}`,
      `=on-login=${toWin1252(onLogin)}`,
      `=shared-users=${opts.sharedUsers || "1"}`,
      `=status-autorefresh=${HOTSPOT_PROFILE_STATUS_AUTOREFRESH}`,
    ];
    if (opts.rateLimit)   args.push(`=rate-limit=${opts.rateLimit}`);
    if (opts.addrPool)    args.push(`=address-pool=${opts.addrPool}`);
    if (opts.parentQueue) args.push(`=parent-queue=${toWin1252(opts.parentQueue)}`);
    await api.write("/ip/hotspot/user/profile/add", args);
    // Nouveau profil → aucun scheduler existant, on applique directement sans find préalable.
    await applyProfileScheduler(api, opts.name, expmode, [], version);
  });
}

export interface HotspotUser {
  username: string;
  password: string;
  profile: string;
  comment: string | null;
  limitUptime: string | null;
  limitBytesTotal: string | null;
  macAddress: string | null;
  server: string | null;
  disabled: boolean;
}

export async function listHotspotUsers(conn: RouterConnection, timeout = 15000): Promise<HotspotUser[]> {
  return withRouter(conn, async (api) => {
    const users = await api.write("/ip/hotspot/user/print");
    return users.map((u) => ({
      username: decodeRouterText((u["name"] as string) ?? ""),
      password: (u["password"] as string) ?? "",
      profile: decodeRouterText((u["profile"] as string) ?? ""),
      comment: decodeRouterText((u["comment"] as string) ?? "") || null,
      limitUptime: (u["limit-uptime"] as string) || null,
      limitBytesTotal: (u["limit-bytes-total"] as string) || null,
      macAddress: (u["mac-address"] as string) || null,
      server: (u["server"] as string) || null,
      disabled: (u["disabled"] as string) === "true",
    }));
  }, timeout);
}

export interface AddHotspotUserOpts {
  name: string;
  password: string;
  profile: string;
  comment?: string;
  server?: string;
  limitUptime?: string;
  limitBytesTotal?: string;
  macAddress?: string;
}

export async function addHotspotUser(conn: RouterConnection, opts: AddHotspotUserOpts): Promise<void> {
  return withRouter(conn, async (api) => {
    const params: string[] = [
      `=name=${toWin1252(opts.name)}`,
      `=password=${toWin1252(opts.password)}`,
      `=profile=${toWin1252(opts.profile)}`,
    ];
    if (opts.comment)         params.push(`=comment=${toWin1252(opts.comment)}`);
    if (opts.server)          params.push(`=server=${opts.server}`);
    if (opts.limitUptime)     params.push(`=limit-uptime=${opts.limitUptime}`);
    if (opts.limitBytesTotal) params.push(`=limit-bytes-total=${opts.limitBytesTotal}`);
    if (opts.macAddress)      params.push(`=mac-address=${opts.macAddress}`);
    await api.write("/ip/hotspot/user/add", params);
  }, 10_000, "high");
}

export async function listSessions(conn: RouterConnection): Promise<HotspotSession[]> {
  return withRouter(conn, async (api) => {
    const sessions = await api.write("/ip/hotspot/active/print");
    return sessions.map((s) => ({
      user: decodeRouterText((s["user"] as string) ?? ""),
      address: (s["address"] as string) ?? "",
      macAddress: (s["mac-address"] as string) || null,
      uptime: (s["uptime"] as string) ?? "00:00:00",
      bytesIn: (s["bytes-in"] as string) || null,
      bytesOut: (s["bytes-out"] as string) || null,
      server: decodeRouterText((s["server"] as string) || "") || null,
    }));
  });
}

export async function listHotspotCookies(conn: RouterConnection): Promise<HotspotCookie[]> {
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/hotspot/cookie/print");
    return rows.map((c): HotspotCookie => ({
      id: (c[".id"] as string) ?? "",
      user: decodeRouterText((c["user"] as string) ?? "") || null,
      macAddress: ((c["mac-address"] as string) ?? "").toUpperCase() || null,
      address: (c["address"] as string) || null,
      server: decodeRouterText((c["server"] as string) ?? "") || null,
      expiresIn: (c["expires-in"] as string) || null,
      domain: decodeRouterText((c["domain"] as string) ?? "") || null,
      path: (c["path"] as string) || null,
    }));
  }, 10_000, "high");
}

export async function deleteHotspotCookie(conn: RouterConnection, id: string): Promise<void> {
  return withRouter(conn, async (api) => {
    await api.write("/ip/hotspot/cookie/remove", [`=.id=${id}`]);
  }, 8_000, "high");
}

export async function deleteHotspotCookiesByUser(conn: RouterConnection, username: string): Promise<number> {
  if (!username.trim()) return 0;
  return withRouter(conn, async (api) => {
    const rows = await api.write("/ip/hotspot/cookie/print");
    const target = username.trim().toLowerCase();
    const ids = rows
      .filter((c) => decodeRouterText((c["user"] as string) ?? "").toLowerCase() === target)
      .map((c) => (c[".id"] as string) ?? "")
      .filter(Boolean);
    for (const id of ids) {
      await api.write("/ip/hotspot/cookie/remove", [`=.id=${id}`]);
    }
    return ids.length;
  }, 15_000, "high");
}

export interface RouterInterface {
  name: string;
  type: string;
  disabled: boolean;
}

export interface InterfaceTraffic {
  rxBps: number;
  txBps: number;
  name: string | null;
}

export async function listInterfaces(conn: RouterConnection): Promise<RouterInterface[]> {
  return withRouter(conn, async (api) => {
    const ifaces = await api.write("/interface/print", [
      "=.proplist=name,type,disabled",
    ]);
    return ifaces.map((i) => ({
      name:     (i["name"] as string) || "",
      type:     (i["type"] as string) || "",
      disabled: i["disabled"] === "true",
    }));
  }, 8000);
}

export async function fetchInterfaceTraffic(conn: RouterConnection, ifaceName?: string): Promise<InterfaceTraffic> {
  return withRouter(conn, async (api) => {
    let targetIface = ifaceName;

    if (!targetIface) {
      // Find the first non-disabled interface (same logic as MikHmon)
      const ifaces = await api.write("/interface/print", ["=.proplist=name,disabled"]);
      const first = ifaces.find((i) => i["disabled"] !== "true") ?? ifaces[0];
      if (!first) return { rxBps: 0, txBps: 0, name: null };
      targetIface = (first["name"] as string) || "";
    }

    // Use /interface/monitor-traffic with once — same as MikHmon PHP code
    const [traffic] = await api.write("/interface/monitor-traffic", [
      `=interface=${targetIface}`,
      "=once=",
    ]);

    return {
      rxBps: parseInt((traffic?.["rx-bits-per-second"] as string) || "0", 10),
      txBps: parseInt((traffic?.["tx-bits-per-second"] as string) || "0", 10),
      name:  targetIface || null,
    };
  }, 8000);
}

export interface SalesReport {
  dailyCount: number;    dailyAmount: number;
  yesterdayCount: number; yesterdayAmount: number;
  weekCount: number;     weekAmount: number;
  lastWeekCount: number; lastWeekAmount: number;
  monthlyCount: number;  monthlyAmount: number;
  lastMonthCount: number; lastMonthAmount: number;
  totalCount: number;    totalAmount: number;
  dateLabel: string;
  monthLabel: string;
}

/** Reproduces MikHmon's live-report logic, compatible with both formats:
 *
 *  Legacy (RouterOS < 7.10):
 *    name:  "mar/31/2026-|-10:30:00-|-username-|-500"
 *    owner: "mar2026"
 *
 *  New (RouterOS 7.10+):
 *    name:  "2025-11-01-|-07:46:47-|-username-|-300-|-ip-|-mac-|-validity-|-label-|-batch"
 *    owner: "112025"  (mmYYYY based on the date field)
 *
 *  Price is always at index 3.
 */
export async function fetchSalesFromScripts(conn: RouterConnection, timeoutMs = 60000): Promise<SalesReport> {
  return withRouter(conn, async (api) => {
    const now = new Date();
    const mm  = String(now.getMonth() + 1).padStart(2, "0");
    const y   = now.getFullYear();
    const d   = String(now.getDate()).padStart(2, "0");

    const isoDateLabel    = `${y}-${mm}-${d}`;
    const legacyDateLabel = `${MIKHMON_MONTH_ABBR[now.getMonth()]}/${d}/${y}`;
    const isoOwner        = `${mm}${y}`;

    // ── Period boundaries (local dates, time-zeroed) ──────────────────────
    const todayMidnight    = new Date(y, now.getMonth(), now.getDate());
    const yestMidnight     = new Date(todayMidnight.getTime() - 86400_000);
    const tomorrowMidnight = new Date(todayMidnight.getTime() + 86400_000);

    // Week: Mon–Sun
    const dayOfWeek        = (todayMidnight.getDay() + 6) % 7; // 0=Mon..6=Sun
    const startOfWeek      = new Date(todayMidnight.getTime() - dayOfWeek * 86400_000);
    const startOfLastWeek  = new Date(startOfWeek.getTime()  - 7 * 86400_000);
    const endOfLastWeek    = startOfWeek;

    const startOfMonth     = new Date(y, now.getMonth(), 1);
    const startOfLastMonth = new Date(y, now.getMonth() - 1, 1);
    const endOfLastMonth   = startOfMonth;

    // ── Fetch ALL mikhmon sales scripts in one call ───────────────────────
    // Using comment=mikhmon filter to get all months at once
    let allScripts = await api.write("/system/script/print", [
      "=.proplist=name",
      "?comment=mikhmon",
    ]).catch(() => [] as Record<string, unknown>[]);

    // Fallback: if comment filter returns nothing (older RouterOS), scan last 13 months
    if (allScripts.length === 0) {
      const ownerSet = new Set<string>();
      for (let i = 0; i <= 12; i++) {
        const dt  = new Date(y, now.getMonth() - i, 1);
        const mm2 = String(dt.getMonth() + 1).padStart(2, "0");
        const y2  = dt.getFullYear();
        ownerSet.add(`${mm2}${y2}`);                                    // ISO: "022026"
        ownerSet.add(`${MIKHMON_MONTH_ABBR[dt.getMonth()]}${y2}`);     // legacy: "feb2026"
      }
      for (const owner of ownerSet) {
        const chunk = await api.write("/system/script/print", [
          "=.proplist=name",
          `?owner=${owner}`,
        ]).catch(() => [] as Record<string, unknown>[]);
        allScripts.push(...chunk);
      }
    }

    // ── Parse & bucket each script ────────────────────────────────────────
    let dailyCount = 0,     dailyAmount = 0;
    let yesterdayCount = 0, yesterdayAmount = 0;
    let weekCount = 0,      weekAmount = 0;
    let lastWeekCount = 0,  lastWeekAmount = 0;
    let monthlyCount = 0,   monthlyAmount = 0;
    let lastMonthCount = 0, lastMonthAmount = 0;
    let totalCount = 0,     totalAmount = 0;

    for (const s of allScripts) {
      const name = (s["name"] as string) ?? "";
      const parts = name.split("-|-");
      if (parts.length < 4) continue;

      const datePart = parts[0].trim();
      const price    = parseFloat(parts[3]) || 0;

      // Parse date — handles both ISO and legacy formats
      const parsedDate = parseMikhmonDate(datePart);
      if (!parsedDate) continue;
      const saleTs = parsedDate.getTime();

      totalCount++;
      totalAmount += price;

      const isToday     = datePart === isoDateLabel || datePart === legacyDateLabel;
      const isYesterday = saleTs >= yestMidnight.getTime()     && saleTs < todayMidnight.getTime();
      const isThisWeek  = saleTs >= startOfWeek.getTime()      && saleTs < tomorrowMidnight.getTime();
      const isLastWeek  = saleTs >= startOfLastWeek.getTime()  && saleTs < endOfLastWeek.getTime();
      const isThisMonth = saleTs >= startOfMonth.getTime()     && saleTs < tomorrowMidnight.getTime();
      const isLastMonth = saleTs >= startOfLastMonth.getTime() && saleTs < endOfLastMonth.getTime();

      if (isToday)     { dailyCount++;     dailyAmount     += price; }
      if (isYesterday) { yesterdayCount++; yesterdayAmount += price; }
      if (isThisWeek)  { weekCount++;      weekAmount      += price; }
      if (isLastWeek)  { lastWeekCount++;  lastWeekAmount  += price; }
      if (isThisMonth) { monthlyCount++;   monthlyAmount   += price; }
      if (isLastMonth) { lastMonthCount++; lastMonthAmount += price; }
    }

    return {
      dailyCount, dailyAmount,
      yesterdayCount, yesterdayAmount,
      weekCount, weekAmount,
      lastWeekCount, lastWeekAmount,
      monthlyCount, monthlyAmount,
      lastMonthCount, lastMonthAmount,
      totalCount, totalAmount,
      dateLabel: isoDateLabel,
      monthLabel: isoOwner,
    };
  }, timeoutMs);
}

export interface LogEntry {
  id: string;
  time: string;
  topics: string;
  message: string;
}

/** Hotspot log lines that reflect user session activity (not DHCP, scripts, etc.). */
function isHotspotUserSessionLogMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (/\blogged in\b/.test(m)) return true;
  if (/\blogged out\b/.test(m)) return true;
  if (/\blogin failed\b/.test(m)) return true;
  if (/\btrying to log in\b/.test(m)) return true;
  if (/\blogging out\b/.test(m)) return true;
  if (/\bchap-login failure\b/.test(m)) return true;
  if (/\bpap-login failure\b/.test(m)) return true;
  if (/\binternal login failed\b/.test(m)) return true;
  if (/\btrying to log out\b/.test(m)) return true;
  return false;
}

export async function listLogs(
  conn: RouterConnection,
  limit = 50,
  topicFilter?: string,
  hotspotUserEventsOnly = false,
): Promise<LogEntry[]> {
  return withRouter(conn, async (api) => {
    const entries = await api.write("/log/print");
    let filtered = entries;
    if (hotspotUserEventsOnly) {
      filtered = filtered.filter((e) => {
        const topics = ((e["topics"] as string) ?? "").toLowerCase();
        if (!topics.includes("hotspot")) return false;
        const message = (e["message"] as string) ?? "";
        return isHotspotUserSessionLogMessage(message);
      });
    } else if (topicFilter) {
      const topics = topicFilter
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      filtered = entries.filter((e) =>
        topics.some((t) => ((e["topics"] as string) ?? "").toLowerCase().includes(t))
      );
    }
    return filtered
      .slice(-limit)
      .reverse()
      .map((e) => ({
        id: (e[".id"] as string) ?? "",
        time: (e["time"] as string) ?? "",
        topics: fromWin1252((e["topics"] as string) ?? ""),
        // Hotspot messages frequently embed user-typed names (comments, full names).
        // node-routeros decodes the socket bytes 1:1 as latin-1, so UTF-8 names
        // (e.g. "Famille Koné") arrive mojibake'd ("Famille KonÃ©") and need to be
        // re-decoded as UTF-8 before being shipped to the browser.
        message: fromWin1252((e["message"] as string) ?? ""),
      }));
  });
}

/**
 * Fetches all usernames that have been "used" from MikroTik.
 * Sources:
 *   1. Hotspot logs — lines with topic "hotspot" and message containing "logged in"
 *   2. MikHmon sales scripts — script names like "date-|-time-|-username-|-price-..."
 *      (new format: "2025-11-01-|-07:46:47-|-user-|-300-...", owner mmYYYY)
 *      (legacy: "mar/31/2026-|-time-|-user-|-price", owner marYYYY)
 * Returns a Set of lowercase usernames seen in either source.
 */
export async function fetchUsedUsernames(conn: RouterConnection): Promise<Set<string>> {
  const used = new Set<string>();

  await withRouter(conn, async (api) => {
    // — Source 1: hotspot logs —
    const logs = await api.write("/log/print").catch(() => []);
    for (const entry of logs) {
      const topics  = ((entry["topics"]  as string) ?? "").toLowerCase();
      const message = ((entry["message"] as string) ?? "").toLowerCase();
      if (!topics.includes("hotspot")) continue;
      // MikroTik hotspot login message: "<username> logged in"
      const loginMatch = message.match(/^(.+?) logged in/);
      if (loginMatch) {
        used.add(loginMatch[1].trim());
        continue;
      }
      // Also match "user <username> logged in by ..."
      const userMatch = message.match(/user (.+?) logged in/);
      if (userMatch) {
        used.add(userMatch[1].trim());
      }
    }

    // — Source 2: MikHmon sales scripts —
    const now    = new Date();
    const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const m  = MONTHS[now.getMonth()];
    const y  = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const isoOwner    = `${mm}${y}`;   // "032026"
    const legacyOwner = `${m}${y}`;    // "mar2026"

    let scripts = await api.write("/system/script/print", [`?owner=${isoOwner}`]).catch(() => []);
    if (scripts.length === 0) {
      scripts = await api.write("/system/script/print", [`?owner=${legacyOwner}`]).catch(() => []);
    }

    for (const s of scripts) {
      const name = (s["name"] as string) ?? "";
      const parts = name.split("-|-");
      // format: date-|-time-|-username-|-price-...
      if (parts.length >= 3) {
        const username = parts[2].trim().toLowerCase();
        if (username) used.add(username);
      }
    }
  }, 30_000);

  return used;
}

export interface SaleDetail {
  saleDate: Date;
  salePrice: string;
  ip: string;
  mac: string;
}

// ─── Raw sales entries (for the Selling Report page) ──────────────────────────

export interface SaleEntry {
  date: string;   // normalized ISO "YYYY-MM-DD"
  time: string;
  username: string;
  price: number;
  ip: string;
  mac: string;
  validity: string;
  label: string;
  batch: string;
}

// ─── MikHMon date helpers (shared by fetchScriptSales & fetchSaleDetails) ────

const MIKHMON_MONTH_ABBR = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/** Parse both ISO ("2026-02-02") and legacy ("nov/04/2025") date parts into a Date. */
function parseMikhmonDate(datePart: string, timePart?: string): Date | null {
  const time = timePart && /^\d{1,2}:\d{2}:\d{2}$/.test(timePart) ? timePart : "00:00:00";
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const d = new Date(`${datePart}T${time}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const leg = datePart.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i);
  if (leg) {
    const mIdx = MIKHMON_MONTH_ABBR.indexOf(leg[1].toLowerCase());
    if (mIdx < 0) return null;
    const [hh = 0, mm = 0, ss = 0] = time.split(":").map(Number);
    return new Date(Number(leg[3]), mIdx, Number(leg[2]), hh, mm, ss);
  }
  return null;
}

/** Convert either date format to a canonical "YYYY-MM-DD" string. */
function toIsoDateStr(datePart: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const leg = datePart.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i);
  if (leg) {
    const mIdx = MIKHMON_MONTH_ABBR.indexOf(leg[1].toLowerCase());
    if (mIdx >= 0) {
      return `${leg[3]}-${String(mIdx + 1).padStart(2, "0")}-${String(Number(leg[2])).padStart(2, "0")}`;
    }
  }
  return datePart;
}

/**
 * Fetches MikHMon sales scripts and returns raw sale entries.
 * Mirrors the three filter modes used by MikHMon's selling.php:
 *   filter = 'all'   → ?comment=mikhmon  (all history)
 *   filter = 'month' → ?owner=<mmYYYY>  (monthly)
 *   filter = 'day'   → fetches by month + filters to the requested day in JS
 *                       (supports both ISO "2026-03-31" and legacy "mar/31/2026")
 */
export async function fetchScriptSales(
  conn: RouterConnection,
  filter: { type: "all" } | { type: "month"; year: number; month: number } | { type: "day"; year: number; month: number; day: number },
  timeoutMs = 45000,
): Promise<SaleEntry[]> {
  return withRouter(conn, async (api) => {
    let scripts: Record<string, unknown>[] = [];

    if (filter.type === "all") {
      scripts = await api.write("/system/script/print", [
        "=.proplist=name",
        "?comment=mikhmon",
      ]).catch(() => []);

      // Fallback for older RouterOS: scan last 13 months by owner (both formats)
      if (scripts.length === 0) {
        const now = new Date();
        const ownerSet = new Set<string>();
        for (let i = 0; i <= 12; i++) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mm2 = String(dt.getMonth() + 1).padStart(2, "0");
          ownerSet.add(`${mm2}${dt.getFullYear()}`);                                  // ISO: "022026"
          ownerSet.add(`${MIKHMON_MONTH_ABBR[dt.getMonth()]}${dt.getFullYear()}`);   // legacy: "feb2026"
        }
        for (const owner of ownerSet) {
          const chunk = await api.write("/system/script/print", [
            "=.proplist=name",
            `?owner=${owner}`,
          ]).catch(() => []);
          scripts.push(...chunk);
        }
      }
    } else {
      // month or day: fetch by ISO owner first, fallback to legacy
      const { year, month } = filter;
      const mm = String(month).padStart(2, "0");
      const isoOwner    = `${mm}${year}`;
      const legacyOwner = `${MIKHMON_MONTH_ABBR[month - 1]}${year}`;

      scripts = await api.write("/system/script/print", [
        "=.proplist=name",
        `?owner=${isoOwner}`,
      ]).catch(() => []);

      if (scripts.length === 0) {
        scripts = await api.write("/system/script/print", [
          "=.proplist=name",
          `?owner=${legacyOwner}`,
        ]).catch(() => []);
      }
    }

    // Day filtering in JS
    const dayFilter = filter.type === "day" ? filter.day : null;

    const entries: (SaleEntry & { _ts: number })[] = [];
    for (const s of scripts) {
      const name = (s["name"] as string) ?? "";
      const p = name.split("-|-");
      if (p.length < 4) continue;

      const rawDate  = (p[0] ?? "").trim();
      const rawTime  = (p[1] ?? "").trim();
      const username = (p[2] ?? "").trim();
      if (!username) continue;

      // Day filter: works for both ISO (ends with -DD) and legacy (contains /DD/)
      if (dayFilter !== null) {
        const dd = String(dayFilter).padStart(2, "0");
        if (!rawDate.endsWith(`-${dd}`) && !rawDate.match(new RegExp(`^[a-z]{3}\\/${dd}\\/`, "i"))) continue;
      }

      const parsed = parseMikhmonDate(rawDate, rawTime);
      if (!parsed) continue;

      entries.push({
        date:     toIsoDateStr(rawDate),   // always "YYYY-MM-DD"
        time:     rawTime,
        username,
        price:    parseFloat(p[3]) || 0,
        ip:       (p[4] ?? "").trim(),
        mac:      (p[5] ?? "").trim(),
        validity: (p[6] ?? "").trim(),
        label:    (p[7] ?? "").trim(),
        batch:    (p[8] ?? "").trim(),
        _ts:      parsed.getTime(),
      });
    }

    // Sort descending by actual timestamp (handles mixed ISO + legacy correctly)
    entries.sort((a, b) => b._ts - a._ts);

    return entries.map(({ _ts: _ignored, ...e }) => e);
  }, timeoutMs);
}

/**
 * Fetches sale details from MikHMon scripts.
 * Returns a Map<username_lowercase, SaleDetail> with the most recent entry per user.
 *
 * Handles both RouterOS formats:
 *   >= 7.10 (ISO):    "2026-02-02-|-15:12:24-|-user-|-100-|-ip-|-mac-|-..."  owner="022026"
 *   <  7.10 (legacy): "nov/04/2025-|-15:34:23-|-user-|-500-|-ip-|-mac-|-..."  owner="nov2025"
 *
 * Strategy:
 *   1. Try ?comment=mikhmon (one call, all scripts — works on RouterOS >= 7.x)
 *   2. Fall back to per-owner scan covering last monthsBack months with both owner formats
 */
export async function fetchSaleDetails(conn: RouterConnection, monthsBack = 13): Promise<Map<string, SaleDetail>> {
  const details = new Map<string, SaleDetail>();

  function processScript(name: string) {
    const parts = name.split("-|-");
    if (parts.length < 4) return;

    const datePart = parts[0].trim();
    const timePart = parts[1].trim();
    const username = parts[2].trim().toLowerCase();
    const priceStr = parts[3].trim();
    const ip       = parts.length >= 5 ? parts[4].trim() : "";
    const mac      = parts.length >= 6 ? parts[5].trim() : "";

    if (!username) return;

    const saleDate = parseMikhmonDate(datePart, timePart);
    if (!saleDate || isNaN(saleDate.getTime())) return;

    const existing = details.get(username);
    if (!existing || saleDate > existing.saleDate) {
      details.set(username, { saleDate, salePrice: priceStr, ip, mac });
    }
  }

  await withRouter(conn, async (api) => {
    const now = new Date();

    // ── Strategy 1: single call with comment=mikhmon ─────────────────────────
    const byComment = await api.write("/system/script/print", [
      "=.proplist=name",
      "?comment=mikhmon",
    ]).catch(() => [] as Record<string, unknown>[]);

    if (byComment.length > 0) {
      for (const s of byComment) processScript((s["name"] as string) ?? "");
      return;
    }

    // ── Strategy 2: fallback — per-owner scan (monthsBack months × 2 formats) ─
    const ownerSet = new Set<string>();
    for (let i = 0; i <= monthsBack; i++) {
      const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yr = d.getFullYear();
      ownerSet.add(`${mm}${yr}`);                                 // ISO owner: "022026"
      ownerSet.add(`${MIKHMON_MONTH_ABBR[d.getMonth()]}${yr}`);  // legacy owner: "feb2026"
    }

    for (const owner of ownerSet) {
      const scripts = await api.write("/system/script/print", [
        "=.proplist=name",
        `?owner=${owner}`,
      ]).catch(() => [] as Record<string, unknown>[]);
      for (const s of scripts) processScript((s["name"] as string) ?? "");
    }
  }, 45_000);

  return details;
}

/**
 * Enable or disable a list of hotspot users on a MikroTik router.
 * Fetches all users in one shot, then sends one set-command per target user.
 * Uses a long timeout (120 s) to handle large vendor voucher batches.
 * Users not found on the router are silently skipped.
 */
export async function enableDisableHotspotUsers(
  conn: RouterConnection,
  usernames: string[],
  enable: boolean,
): Promise<{ done: number; notFound: string[]; sessionsKicked: number; cookiesRemoved: number }> {
  if (usernames.length === 0) return { done: 0, notFound: [], sessionsKicked: 0, cookiesRemoved: 0 };

  const target = new Set(usernames.map((u) => u.toLowerCase()));

  return withRouter(conn, async (api) => {
    // Fetch all hotspot users once
    const all = await api.write("/ip/hotspot/user/print");

    const toSet: string[] = [];
    const found = new Set<string>();
    const foundNames: string[] = []; // original casing for session/cookie matching

    for (const u of all) {
      const decoded = fixEncoding((u["name"] as string) ?? "");
      const nameLower = decoded.toLowerCase();
      const id = (u[".id"] as string) ?? "";
      if (!nameLower || !id) continue;
      if (target.has(nameLower)) {
        toSet.push(id);
        found.add(nameLower);
        foundNames.push(decoded);
      }
    }

    const notFound = usernames.filter((u) => !found.has(u.toLowerCase()));
    const disabledVal = enable ? "no" : "yes";

    // RouterOS 7.x API requires one set command per item; comma-separated IDs
    // in a single command are unreliable across versions.
    for (const id of toSet) {
      await api.write("/ip/hotspot/user/set", [
        `=.id=${id}`,
        `=disabled=${disabledVal}`,
      ]);
    }

    let sessionsKicked = 0;
    let cookiesRemoved = 0;

    // When DISABLING: kick active sessions and remove cookies for affected users
    if (!enable && foundNames.length > 0) {
      const disabledSet = new Set(foundNames.map((u) => u.toLowerCase()));

      // 1. Kick active sessions
      const sessions = await api.write("/ip/hotspot/active/print");
      for (const s of sessions) {
        const rawUser = fixEncoding((s["user"] as string) ?? "").trim();
        if (disabledSet.has(rawUser.toLowerCase())) {
          const sid = (s[".id"] as string) ?? "";
          if (sid) {
            await api.write("/ip/hotspot/active/remove", [`=.id=${sid}`]);
            sessionsKicked++;
          }
        }
      }

      // 2. Remove hotspot cookies
      const cookies = await api.write("/ip/hotspot/cookie/print");
      for (const c of cookies) {
        const rawUser = fixEncoding((c["user"] as string) ?? "").trim();
        if (disabledSet.has(rawUser.toLowerCase())) {
          const cid = (c[".id"] as string) ?? "";
          if (cid) {
            await api.write("/ip/hotspot/cookie/remove", [`=.id=${cid}`]);
            cookiesRemoved++;
          }
        }
      }
    }

    return { done: toSet.length, notFound, sessionsKicked, cookiesRemoved };
  }, 60_000, "high");
}

/**
 * Delete all hotspot users whose comment exactly matches the given string.
 */
export async function deleteHotspotUsersByComment(
  conn: RouterConnection,
  comment: string,
): Promise<number> {
  return withRouter(conn, async (api) => {
    const toDelete: string[] = [];

    // Try targeted query filter first (avoids full scan) — try both
    // UTF-8 and Win1252-encoded variants of the comment to handle any encoding.
    for (const variant of [comment, toWin1252(comment)]) {
      const filtered = await api.write("/ip/hotspot/user/print", [`?comment=${variant}`]);
      if (filtered.length > 0) {
        for (const u of filtered) {
          const id = u[".id"] as string | undefined;
          if (id) toDelete.push(id);
        }
        break;
      }
    }

    // Fallback: full scan (handles edge-cases with unusual encodings)
    if (toDelete.length === 0) {
      const all = await api.write("/ip/hotspot/user/print");
      for (const u of all) {
        if (fixEncoding((u["comment"] as string) ?? "") === comment) {
          const id = u[".id"] as string | undefined;
          if (id) toDelete.push(id);
        }
      }
    }

    if (toDelete.length > 0) {
      await api.write("/ip/hotspot/user/remove", [`=.id=${toDelete.join(",")}`]);
    }
    return toDelete.length;
  }, 30_000, "high");
}

/**
 * Delete specific hotspot users by their usernames.
 */
export async function deleteHotspotUsersByNames(
  conn: RouterConnection,
  usernames: string[],
): Promise<number> {
  if (usernames.length === 0) return 0;
  return withRouter(conn, async (api) => {
    const toDelete: string[] = [];

    if (usernames.length <= 50) {
      // Targeted per-name queries: much faster than fetching all users when
      // deleting a small selection. Try exact name then Win1252-encoded variant.
      for (const username of usernames) {
        let found = false;
        for (const variant of [username, toWin1252(username)]) {
          const results = await api.write("/ip/hotspot/user/print", [`?name=${variant}`]);
          if (results.length > 0) {
            const id = results[0][".id"] as string | undefined;
            if (id && !toDelete.includes(id)) toDelete.push(id);
            found = true;
            break;
          }
        }
        // Last-resort: if both variants returned nothing, it might be a
        // double-encoded name — the full-scan fallback below will catch it.
        if (!found) {
          // Mark for fallback by breaking and letting the scan handle it
        }
      }
      // If targeted queries found all usernames, skip the scan
      if (toDelete.length < usernames.length) {
        // Some usernames weren't found via filter — fall back to full scan
        const alreadyFound = new Set(toDelete);
        const target = new Set(usernames.map((u) => u.toLowerCase()));
        const all = await api.write("/ip/hotspot/user/print");
        for (const u of all) {
          const id = u[".id"] as string | undefined;
          if (!id || alreadyFound.has(id)) continue;
          const name = fixEncoding((u["name"] as string) ?? "").toLowerCase();
          if (name && target.has(name)) toDelete.push(id);
        }
      }
    } else {
      // Large batch: single full scan is more efficient than N targeted queries
      const target = new Set(usernames.map((u) => u.toLowerCase()));
      const all = await api.write("/ip/hotspot/user/print");
      for (const u of all) {
        const name = fixEncoding((u["name"] as string) ?? "").toLowerCase();
        const id = u[".id"] as string | undefined;
        if (name && id && target.has(name)) toDelete.push(id);
      }
    }

    if (toDelete.length > 0) {
      await api.write("/ip/hotspot/user/remove", [`=.id=${toDelete.join(",")}`]);
    }
    return toDelete.length;
  }, 30_000, "high");
}

/**
 * Server-side lookup of a hotspot user by name. Tries the MikroTik query
 * filter `?name=<value>` with several encoding variants (toWin1252, raw,
 * trimmed, NBSP-normalised) so a name created in any context (Mikhmon,
 * VoucherNet, WinBox) can be located without scanning the entire user list.
 *
 * Falls back to a full scan with case-insensitive normalised compare only
 * if every direct query returns nothing — needed for legacy users whose
 * names contain mojibake bytes that no single encoding will reproduce.
 */
async function findHotspotUserByName(
  api: { write: (path: string | string[], ...params: (string | string[])[]) => Promise<Record<string, unknown>[]> },
  username: string,
): Promise<Record<string, unknown> | null> {
  const UNICODE_SPACES = /[\u00A0\u2007\u202F\u2009\u200A\u2008\u2006\u2005\u2004\u2003\u2002]/g;

  // Build an ordered list of variants — exact raw first (preserves leading/
  // trailing spaces if any), then trimmed/encoded forms.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const addVariant = (v: string) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    ordered.push(v);
  };

  addVariant(username);                                       // raw, no trim
  const trimmed = username.trim();
  addVariant(trimmed);                                        // trimmed
  addVariant(toWin1252(username));                            // raw + win1252
  addVariant(toWin1252(trimmed));                             // trimmed + win1252
  const ascii = trimmed.replace(UNICODE_SPACES, " ");
  if (ascii !== trimmed) {
    addVariant(ascii);
    addVariant(toWin1252(ascii));
  }
  const nbsp = trimmed.replace(/ /g, "\u00A0");
  if (nbsp !== trimmed) {
    addVariant(nbsp);
    addVariant(toWin1252(nbsp));
  }

  for (const v of ordered) {
    try {
      const rows = await api.write("/ip/hotspot/user/print", [`?name=${v}`]);
      if (rows.length > 0) return rows[0];
    } catch {
      // ignore — try next variant
    }
  }

  // Last resort: full scan with normalisation on both sides.
  const norm = (s: string) => s.replace(UNICODE_SPACES, " ").trim().toLowerCase();
  const target = norm(username);
  const all = await api.write("/ip/hotspot/user/print");
  for (const u of all) {
    const raw = (u["name"] as string) ?? "";
    if (norm(raw) === target) return u;
    if (norm(fixEncoding(raw)) === target) return u;
  }
  return null;
}

/**
 * Rename a hotspot user on MikroTik (changes the `name` field).
 * Returns false if the user is not found.
 */
export async function renameHotspotUser(
  conn: RouterConnection,
  oldUsername: string,
  newUsername: string,
): Promise<boolean> {
  return withRouter(conn, async (api) => {
    const user = await findHotspotUserByName(api, oldUsername);
    if (!user) return false;
    const id = user[".id"] as string | undefined;
    if (!id) return false;
    await api.write("/ip/hotspot/user/set", [
      `=.id=${id}`,
      `=name=${toWin1252(newUsername)}`,
    ]);
    return true;
  }, 15_000, "high");
}

export interface UpdateHotspotUserOpts {
  newUsername?: string;
  password?: string;
  profile?: string;
  comment?: string;
}

export async function updateHotspotUser(
  conn: RouterConnection,
  username: string,
  opts: UpdateHotspotUserOpts,
): Promise<{ found: boolean; username: string; comment: string | null }> {
  return withRouter(conn, async (api) => {
    const user = await findHotspotUserByName(api, username);
    if (!user) return { found: false, username, comment: null };
    const id = user[".id"] as string | undefined;
    if (!id) return { found: false, username, comment: null };

    const nextUsername = opts.newUsername?.trim() || fixEncoding((user["name"] as string) ?? username);
    const args: string[] = [`=.id=${id}`];
    if (opts.newUsername !== undefined) args.push(`=name=${toWin1252(nextUsername)}`);
    if (opts.password !== undefined) args.push(`=password=${toWin1252(opts.password.trim())}`);
    if (opts.profile !== undefined) args.push(`=profile=${toWin1252(opts.profile.trim())}`);
    if (opts.comment !== undefined) args.push(`=comment=${toWin1252(opts.comment.trim())}`);
    await api.write("/ip/hotspot/user/set", args);

    return {
      found: true,
      username: nextUsername,
      comment: user["comment"] ? fixEncoding(user["comment"] as string) || null : null,
    };
  }, 20_000, "high");
}

/**
 * Déconnecter une session active — procédé exact de Mikhmon removeuseractive.php :
 * 1) /ip/hotspot/active/print ?user=username → récupérer l'ID de session
 * 2) /ip/hotspot/cookie/print ?user=username → récupérer le cookie
 * 3) /ip/hotspot/cookie/remove
 * 4) /ip/hotspot/active/remove
 */
export async function disconnectSession(
  conn: RouterConnection,
  username: string,
): Promise<{ removed: number; cookiesRemoved: number }> {
  return withRouter(conn, async (api) => {
    const target = username.trim();
    if (!target) return { removed: 0, cookiesRemoved: 0 };

    // Variantes d'encodage pour MikroTik 7.x (accents, caractères spéciaux)
    const candidates = Array.from(new Set([
      target,
      toWin1252(target),
      fixEncoding(target),
      decodeRouterText(target),
    ].map((v) => v.trim()).filter(Boolean)));

    // 1) Trouver la session active — requête ciblée comme Mikhmon ?.id=...
    const sessionIds = new Map<string, string>(); // id → user
    for (const cand of candidates) {
      const rows = await api.write("/ip/hotspot/active/print", [`?user=${cand}`]).catch(() => []);
      for (const row of rows) {
        const sid = String(row[".id"] ?? "");
        const user = String(row["user"] ?? cand);
        if (sid) sessionIds.set(sid, user);
      }
      if (sessionIds.size > 0) break;
    }

    // 2) Pour chaque session trouvée : supprimer cookie puis session (ordre Mikhmon)
    let removed = 0;
    let cookiesRemoved = 0;

    for (const [sid, sessionUser] of sessionIds) {
      // Cookie par username (Mikhmon : /ip/hotspot/cookie/print ?user=username)
      for (const cand of Array.from(new Set([target, toWin1252(sessionUser), sessionUser]))) {
        const cookies = await api.write("/ip/hotspot/cookie/print", [`?user=${cand}`]).catch(() => []);
        for (const c of cookies) {
          const cid = String(c[".id"] ?? "");
          if (!cid) continue;
          await api.write("/ip/hotspot/cookie/remove", [`=.id=${cid}`]).catch(() => undefined);
          cookiesRemoved++;
        }
        if (cookies.length > 0) break;
      }
      // Supprimer la session active
      await api.write("/ip/hotspot/active/remove", [`=.id=${sid}`]).catch(() => undefined);
      removed++;
    }

    return { removed, cookiesRemoved };
  }, 10_000, "high");
}

/**
 * Reset a hotspot user — procédé exact de Mikhmon resethotspotuser.php :
 * 1) /ip/hotspot/user/set (limit-uptime=0, comment="")
 * 2) /ip/hotspot/user/reset-counters
 * 3) /system/scheduler/print ?name=username → remove
 *
 * Pas de déconnexion de session ni de cookie : Mikhmon gère ça séparément
 * via removeuseractive. Garder le reset minimal = réponse instantanée.
 */
export async function resetHotspotUser(
  conn: RouterConnection,
  username: string,
): Promise<{ found: boolean; schedulerRemoved: number }> {
  return withRouter(conn, async (api) => {
    // 1) Récupérer l'utilisateur par nom pour obtenir son .id
    const user = await findHotspotUserByName(api, username);
    if (!user) return { found: false, schedulerRemoved: 0 };

    const id = user[".id"] as string | undefined;
    const name = (user["name"] as string) ?? username;
    if (!id) return { found: false, schedulerRemoved: 0 };

    // 2) Reset quota — identique à Mikhmon
    await api.write("/ip/hotspot/user/set", [`=.id=${id}`, "=limit-uptime=0", "=comment="]);
    await api.write("/ip/hotspot/user/reset-counters", [`=.id=${id}`]);

    // 3) Supprimer le scheduler par nom — identique à Mikhmon
    let schedulerRemoved = 0;
    const schedulers = await api.write("/system/scheduler/print", [`?name=${name}`]).catch(() => []);
    for (const sch of schedulers) {
      const sid = sch[".id"] as string | undefined;
      if (!sid) continue;
      await api.write("/system/scheduler/remove", [`=.id=${sid}`]).catch(() => undefined);
      schedulerRemoved++;
    }

    return { found: true, schedulerRemoved };
  }, 8_000, "high");
}

/**
 * Delete MikHmon sales scripts older than the cutoff (year, month).
 * Scripts whose parsed date is strictly before the first day of the cutoff
 * month are removed. Scripts whose date cannot be parsed are skipped.
 *
 * Same discovery strategy as MikHmon `clean_selling.php` + our month purge:
 *   1) One `/system/script/print` with `?comment=mikhmon` and **only** `.id` + `name`
 *      (avoids huge rows / timeouts vs a full print).
 *   2) If empty (older RouterOS), same owner-month scan fallback as `fetchScriptSales`.
 *   3) Removes in small parallel chunks (reliable on busy routers).
 */
export async function purgeOldMikhmonScripts(
  conn: RouterConnection,
  cutoffYear: number,
  cutoffMonth: number, // 1-12
  options: { limit?: number } = {},
): Promise<{
  removed: number;
  failed: number;
  scanned: number;   // total candidates found *before* deletion (to compute progress)
  byMonth: Array<{ yearMonth: string; count: number }>;
}> {
  return withRouter(conn, async (api) => {
    const cutoff = new Date(cutoffYear, cutoffMonth - 1, 1, 0, 0, 0);
    const SCRIPT_PROPLIST = "=.proplist=.id,name";

    let all = await api.write("/system/script/print", [SCRIPT_PROPLIST, "?comment=mikhmon"]).catch(() => []);

    if (all.length === 0) {
      const byId = new Map<string, Record<string, unknown>>();
      const addRows = (rows: Record<string, unknown>[]) => {
        for (const r of rows) {
          const id = String(r[".id"] ?? "");
          if (id) byId.set(id, r);
        }
      };
      const now = new Date();
      for (let i = 0; i <= 12; i++) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mm2 = String(dt.getMonth() + 1).padStart(2, "0");
        const y2 = dt.getFullYear();
        addRows(await api.write("/system/script/print", [SCRIPT_PROPLIST, `?owner=${mm2}${y2}`]).catch(() => []));
        addRows(await api.write("/system/script/print", [
          SCRIPT_PROPLIST,
          `?owner=${MIKHMON_MONTH_ABBR[dt.getMonth()]}${y2}`,
        ]).catch(() => []));
      }
      all = [...byId.values()];
    }

    type Candidate = { id: string; date: Date; ym: string };
    const candidates: Candidate[] = [];
    for (const s of all) {
      const sname = (s["name"] as string) ?? "";
      const sid   = s[".id"] as string | undefined;
      if (!sid) continue;
      const parts = sname.split("-|-");
      if (parts.length < 3) continue;
      const dt = parseMikhmonDate(parts[0], parts[1]);
      if (!dt) continue;
      if (dt.getTime() >= cutoff.getTime()) continue;
      const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      candidates.push({ id: sid, date: dt, ym });
    }

    // Oldest first
    candidates.sort((a, b) => a.date.getTime() - b.date.getTime());

    const total = candidates.length;
    const batch = options.limit && options.limit > 0
      ? candidates.slice(0, options.limit)
      : candidates;

    let removed = 0;
    let failed = 0;
    const byMonthMap = new Map<string, number>();

    const CHUNK = 20;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const part = batch.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        part.map((c) => api.write("/system/script/remove", [`=.id=${c.id}`])),
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]!;
        const c = part[j]!;
        if (r.status === "fulfilled") {
          removed++;
          byMonthMap.set(c.ym, (byMonthMap.get(c.ym) ?? 0) + 1);
        } else {
          failed++;
        }
      }
    }

    const byMonth = Array.from(byMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([yearMonth, count]) => ({ yearMonth, count }));

    return { removed, failed, scanned: total, byMonth };
  }, 240_000);
}

/**
 * Delete MikHmon sales scripts for an exact month (year + month).
 *
 * MikHmon (`delete_selling_by_month.php`) uses a single `/system/script/print`
 * with `?comment=mikhmon`, then filters by parsed date in PHP — one list fetch.
 * We do the same for speed (one round-trip + minimal columns), with:
 *   - ISO + legacy date parts via `parseMikhmonDate` (PHP only matched legacy),
 *   - optional DB `rawName` hints + encoding variants,
 *   - parallel `/system/script/remove` chunks (faster than PHP write/read per row).
 */
export async function purgeMikhmonScriptsForMonth(
  conn: RouterConnection,
  year: number,
  month: number, // 1-12
  options: { preferredRawNames?: string[] } = {},
): Promise<{
  removed: number;
  failed: number;
  scanned: number;
}> {
  return withRouter(conn, async (api) => {
    const mm = String(month).padStart(2, "0");
    const isoOwner = `${mm}${year}`;
    const legacyOwner = `${MIKHMON_MONTH_ABBR[month - 1]}${year}`;

    const SCRIPT_PROPLIST = "=.proplist=.id,name";

    /** Same bytes represented different ways (DB vs live API) must still match. */
    const nameKeySet = (name: string): Set<string> => {
      const t = (name ?? "").trim();
      const s = new Set<string>();
      if (!t) return s;
      s.add(t);
      s.add(decodeRouterText(t));
      s.add(fixEncoding(t));
      s.add(decodeRouterText(fixEncoding(t)));
      return s;
    };

    const preferredUnion = new Set<string>();
    for (const raw of options.preferredRawNames ?? []) {
      for (const k of nameKeySet(raw)) preferredUnion.add(k);
    }

    const scriptMatchesPreferred = (sname: string): boolean => {
      if (preferredUnion.size === 0) return false;
      const keys = nameKeySet(sname);
      for (const k of keys) {
        if (preferredUnion.has(k)) return true;
      }
      return false;
    };

    const inSelectedMonth = (sname: string): boolean => {
      const parts = sname.split("-|-");
      if (parts.length < 3) return false;
      const dt = parseMikhmonDate(parts[0], parts[1]);
      if (!dt) return false;
      return dt.getFullYear() === year && dt.getMonth() + 1 === month;
    };

    // MikHmon: one `?comment=mikhmon` print — fastest consistent discovery path.
    let allRows = await api.write("/system/script/print", [SCRIPT_PROPLIST, "?comment=mikhmon"]).catch(() => []);

    // Older RouterOS: no comment tag → same fallback as fetchScriptSales (owner scan).
    if (allRows.length === 0) {
      const byId = new Map<string, Record<string, unknown>>();
      const addRows = (rows: Record<string, unknown>[]) => {
        for (const r of rows) {
          const id = String(r[".id"] ?? "");
          if (id) byId.set(id, r);
        }
      };
      addRows(await api.write("/system/script/print", [SCRIPT_PROPLIST, `?owner=${isoOwner}`]).catch(() => []));
      addRows(await api.write("/system/script/print", [SCRIPT_PROPLIST, `?owner=${legacyOwner}`]).catch(() => []));
      allRows = [...byId.values()];
    }
    const all = allRows;

    // Targets = union(DB name match, calendar month match). Never skip date match
    // just because preferred matched something unrelated (old bug).
    const targetIdSet = new Set<string>();
    for (const s of all) {
      const sid = (s[".id"] as string | undefined) ?? "";
      if (!sid) continue;
      const sname = (s["name"] as string) ?? "";
      if (scriptMatchesPreferred(sname) || inSelectedMonth(sname)) {
        targetIdSet.add(sid);
      }
    }
    const targetIds = [...targetIdSet];

    let removed = 0;
    let failed = 0;
    // Moderate parallelism: large batches caused silent failures on some routers.
    const CHUNK = 20;
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const part = targetIds.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        part.map((id) => api.write("/system/script/remove", [`=.id=${id}`])),
      );
      for (const r of settled) {
        if (r.status === "fulfilled") removed++;
        else failed++;
      }
    }

    return { removed, failed, scanned: targetIds.length };
  }, 240_000);
}

/**
 * Remove specific MikHMon script rows by their raw sale names once they have
 * been persisted to the local DB cache.
 *
 * This is used by the auto-clean flow: fetch -> store locally -> delete router scripts.
 */
export async function removeMikhmonScriptsByRawNames(
  conn: RouterConnection,
  rawNames: string[],
): Promise<{ removed: number; failed: number; scanned: number }> {
  if (rawNames.length === 0) return { removed: 0, failed: 0, scanned: 0 };

  return withRouter(conn, async (api) => {
    const target = new Set(rawNames.map((n) => n.trim()).filter(Boolean));
    if (target.size === 0) return { removed: 0, failed: 0, scanned: 0 };

    // Pull all mikhmon scripts once, then remove only exact matches.
    const rows = await api.write("/system/script/print", [
      "=.proplist=.id,name",
      "?comment=mikhmon",
    ]).catch(() => [] as Record<string, unknown>[]);

    const ids: string[] = [];
    for (const r of rows) {
      const id = String(r[".id"] ?? "");
      const name = String(r["name"] ?? "").trim();
      if (id && name && target.has(name)) ids.push(id);
    }
    if (ids.length === 0) return { removed: 0, failed: 0, scanned: 0 };

    let removed = 0;
    let failed = 0;
    const CHUNK = 20;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        part.map((id) => api.write("/system/script/remove", [`=.id=${id}`])),
      );
      for (const s of settled) {
        if (s.status === "fulfilled") removed++;
        else failed++;
      }
    }

    return { removed, failed, scanned: ids.length };
  }, 120_000);
}

// ─── Character sets (MikHMon-compatible) ─────────────────────────────────────
export type CharType = "lower" | "upper" | "upplow" | "mix" | "mix1" | "mix2" | "num";

const CHAR_SETS: Record<CharType, string> = {
  lower:  "abcdefghijklmnopqrstuvwxyz",
  upper:  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  upplow: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  mix:    "abcdefghijklmnopqrstuvwxyz",
  mix1:   "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  mix2:   "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  num:    "0123456789",
};

// Digits used in mix codes (exclude 0 and 1 to avoid visual confusion)
const MIX_DIGITS = "23456789";
const DIGIT_CHARS = "0123456789";

function randomFrom(chars: string, length: number): string {
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * For mix types: place exactly floor(length/2) digits at random positions,
 * rest are letters — matching the PHP randN() pattern:
 *   length 3 → 1 digit
 *   length 4–5 → 2 digits
 *   length 6–7 → 3 digits
 *   length 8 → 4 digits
 */
function generateMixCode(length: number, letterSet: string): string {
  const numDigits = Math.floor(length / 2);
  // Fisher-Yates shuffle to pick digit positions
  const positions = Array.from({ length }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const digitPositions = new Set(positions.slice(0, numDigits));
  return Array.from({ length }, (_, i) =>
    digitPositions.has(i)
      ? MIX_DIGITS[Math.floor(Math.random() * MIX_DIGITS.length)]
      : letterSet[Math.floor(Math.random() * letterSet.length)],
  ).join("");
}

function generateCode(
  length: number,
  prefix: string | undefined,
  passwordMode: "same" | "random",
  charType: CharType = "mix",
): { username: string; password: string } {
  let code: string;
  if (charType === "mix" || charType === "mix1" || charType === "mix2") {
    code = generateMixCode(length, CHAR_SETS[charType]);
  } else {
    code = randomFrom(CHAR_SETS[charType], length);
  }
  const username = prefix ? `${prefix}${code}` : code;
  // "same" (Mode Voucher / vc): password = username
  // "random" (Mode Compte / up): password = random digits of same length
  const password = passwordMode === "same" ? username : randomFrom(DIGIT_CHARS, length);
  return { username, password };
}

export interface GeneratedVoucher {
  username: string;
  password: string;
  profile: string;
  price: string;
  validity: string;
  comment: string;
}

export async function generateVouchers(
  conn: RouterConnection,
  opts: {
    qty: number;
    profile: string;
    prefix?: string;
    comment?: string;
    server?: string;
    price: string;
    validity: string;
    passwordMode?: "same" | "random";
    charType?: CharType;
    userLength?: number;
    timelimit?: string;
    datalimit?: number;
  },
): Promise<GeneratedVoucher[]> {
  return withRouter(conn, async (api) => {
    const length = Math.min(Math.max(opts.userLength ?? (opts.prefix ? 5 : 8), 3), 8);
    const charType: CharType = opts.charType ?? "mix";

    // Pre-encode text fields that may contain accented characters so MikroTik /
    // WinBox sees Windows-1252 bytes, matching node-routeros's internal encoding.
    const encodedPrefix  = opts.prefix  ? toWin1252(opts.prefix)  : opts.prefix;
    const encodedComment = opts.comment ? toWin1252(opts.comment) : opts.comment;
    const encodedProfile = toWin1252(opts.profile);

    // Step 1 – Generate all username/password pairs locally (pure JS, instant).
    // Ensure uniqueness within this batch by tracking already-generated codes.
    const seen = new Set<string>();
    const vouchers: Array<{ username: string; password: string; addParams: string[] }> = [];
    while (vouchers.length < opts.qty) {
      const { username, password } = generateCode(length, encodedPrefix, opts.passwordMode ?? "same", charType);
      if (seen.has(username)) continue;
      seen.add(username);

      const addParams: string[] = [
        `=name=${username}`,
        `=password=${password}`,
        `=profile=${encodedProfile}`,
      ];
      if (encodedComment) addParams.push(`=comment=${encodedComment}`);
      if (opts.server)    addParams.push(`=server=${opts.server}`);
      if (opts.timelimit) addParams.push(`=limit-uptime=${opts.timelimit}`);
      if (opts.datalimit) addParams.push(`=limit-bytes-total=${opts.datalimit}`);

      vouchers.push({ username, password, addParams });
    }

    // Step 2 – Send writes with a continuous worker pool (no batch barriers).
    // This keeps the RouterOS pipeline saturated while avoiding huge spikes.
    const PARALLEL_WRITES = 64;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(PARALLEL_WRITES, vouchers.length) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= vouchers.length) break;
        await api.write("/ip/hotspot/user/add", vouchers[idx].addParams);
      }
    });
    await Promise.all(workers);

    return vouchers.map(({ username, password }) => ({
      username,
      password,
      profile: opts.profile,
      price: opts.price,
      validity: opts.validity,
      comment: opts.comment ?? "",
    }));
  }, 120_000, "high");
}

export async function rebootRouter(conn: RouterConnection): Promise<void> {
  try {
    await withRouter(conn, async (api) => {
      await api.write("/system/reboot");
    }, 15_000, "high");
  } catch {
    // La connexion est coupée dès que le routeur redémarre — c'est attendu
  }
}

export async function shutdownRouter(conn: RouterConnection): Promise<void> {
  try {
    await withRouter(conn, async (api) => {
      await api.write("/system/shutdown");
    }, 15_000, "high");
  } catch {
    // La connexion est coupée dès que le routeur s'éteint — c'est attendu
  }
}
