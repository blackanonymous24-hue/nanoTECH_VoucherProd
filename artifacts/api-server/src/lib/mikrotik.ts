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
    // Normalise expmode to VoucherNet terminology
    const expiredMode  = field1 === "rem" || field1 === "remc" ? "remove"
                       : field1 === "ntf" || field1 === "ntfc" ? "disable"
                       : "nothing";
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
  private readonly queue: Array<() => void> = [];
  constructor(max: number) { this.slots = max; }

  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) { next(); } else { this.slots++; }
  }
}

const routerSemaphores = new Map<string, Semaphore>();
function getRouterSemaphore(host: string, port: number): Semaphore {
  const key = `${host}:${port}`;
  if (!routerSemaphores.has(key)) routerSemaphores.set(key, new Semaphore(2));
  return routerSemaphores.get(key)!;
}

export async function withRouter<T>(
  conn: RouterConnection,
  fn: (api: RouterOSAPI) => Promise<T>,
  timeout = 15000,
): Promise<T> {
  const sem = getRouterSemaphore(conn.host, conn.port);
  await sem.acquire();

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

export async function pingRouter(conn: RouterConnection): Promise<boolean> {
  const attempt = () =>
    withRouter(conn, async (api) => {
      await api.write("/system/identity/print");
    }, 8000);

  try {
    await attempt();
    return true;
  } catch {
    // Wait 2s for concurrent connections to free up, then retry once
    await new Promise<void>((r) => setTimeout(r, 2000));
    try {
      await attempt();
      return true;
    } catch {
      return false;
    }
  }
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
    const [res] = await api.write("/system/resource/print");

    let identity: string | null = null;
    try {
      const [idRes] = await api.write("/system/identity/print");
      identity = (idRes?.["name"] as string) ?? null;
    } catch { /* may be restricted */ }

    let model: string | null = null;
    let serialNumber: string | null = null;
    let firmwareVersion: string | null = null;
    try {
      const [board] = await api.write("/system/routerboard/print");
      model = (board?.["model"] as string) ?? null;
      serialNumber = (board?.["serial-number"] as string) ?? null;
      firmwareVersion = (board?.["current-firmware"] as string) ?? null;
    } catch { /* routerboard may be restricted */ }

    let clockDate: string | null = null;
    let clockTime: string | null = null;
    try {
      const [clock] = await api.write("/system/clock/print");
      clockDate = (clock?.["date"] as string) ?? null;
      clockTime = (clock?.["time"] as string) ?? null;
    } catch { /* clock may be restricted */ }

    return {
      identity,
      boardName: (res?.["board-name"] as string) ?? null,
      model,
      serialNumber,
      routerOsVersion: (res?.["version"] as string) ?? null,
      firmwareVersion,
      cpu: (res?.["cpu"] as string) ?? null,
      cpuCount: (res?.["cpu-count"] as string) ?? null,
      totalMemory: (res?.["total-memory"] as string) ?? null,
      freeMemory: (res?.["free-memory"] as string) ?? null,
      uptime: (res?.["uptime"] as string) ?? null,
      architecture: (res?.["architecture-name"] as string) ?? null,
      clockDate,
      clockTime,
    };
  }, 12000);
}

const EMPTY_PARSED = { price: "", validity: "", lockMac: false, sellingPrice: "", expiredMode: "", parentQueue: "" };

export async function listProfiles(conn: RouterConnection): Promise<HotspotProfile[]> {
  return withRouter(conn, async (api) => {
    const profiles = await api.write("/ip/hotspot/user/profile/print");
    return profiles.map((p) => {
      const onLogin = (p["on-login"] as string) ?? "";
      const parsed = onLogin.includes(",") ? parseProfileOnLogin(onLogin) : EMPTY_PARSED;
      return {
        mikrotikId:  (p[".id"] as string) ?? "",
        name:        fixEncoding((p["name"] as string) ?? ""),
        rateLimit:   (p["rate-limit"] as string) || null,
        validity:    parsed.validity || null,
        price:       parsed.price || null,
        sellingPrice: parsed.sellingPrice || null,
        sharedUsers: (p["shared-users"] as string) || null,
        addrPool:    (p["address-pool"] as string) || null,
        lockMac:     parsed.lockMac,
        expiredMode: parsed.expiredMode || null,
        parentQueue: (p["parent-queue"] as string) || parsed.parentQueue || null,
      };
    });
  });
}

export async function updateProfile(conn: RouterConnection, originalName: string, opts: CreateProfileOptions): Promise<void> {
  return withRouter(conn, async (api) => {
    const found = await api.write("/ip/hotspot/user/profile/print", [`?name=${originalName}`]);
    if (!found.length) throw new Error(`Profil "${originalName}" introuvable`);
    const id = found[0][".id"] as string;
    const onLogin = generateMikHmonOnLogin(opts);
    const args = [
      `=.id=${id}`,
      `=name=${opts.name}`,
      `=on-login=${onLogin}`,
      `=shared-users=${opts.sharedUsers || "1"}`,
    ];
    if (opts.rateLimit)   args.push(`=rate-limit=${opts.rateLimit}`);
    else                  args.push(`=rate-limit=`);
    if (opts.addrPool)    args.push(`=address-pool=${opts.addrPool}`);
    else                  args.push(`=address-pool=`);
    if (opts.parentQueue) args.push(`=parent-queue=${opts.parentQueue}`);
    else                  args.push(`=parent-queue=`);
    await api.write("/ip/hotspot/user/profile/set", args);
  });
}

export async function deleteProfile(conn: RouterConnection, name: string): Promise<void> {
  return withRouter(conn, async (api) => {
    const found = await api.write("/ip/hotspot/user/profile/print", [`?name=${name}`]);
    if (!found.length) throw new Error(`Profil "${name}" introuvable`);
    const id = found[0][".id"] as string;
    await api.write("/ip/hotspot/user/profile/remove", [`=.id=${id}`]);
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
  expiredMode: string;   // "nothing" | "disable" | "remove"
  lockMac: boolean;
  parentQueue: string;
}

function generateMikHmonOnLogin(opts: CreateProfileOptions): string {
  // Auto-generate short label from profile name (backend-only, not user-facing)
  const label = opts.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "profile";
  const lockMacStr = opts.lockMac ? "Enable" : "Disable";
  const macLockPart = opts.lockMac
    ? ` :if ([/ip hotspot user get [find name=$user] mac-address]="") do={ /ip hotspot user set mac-address=[/ip hotspot active get [find user=$user] mac-address] [find where name="$user"];};`
    : "";
  // :put config line format (MikHmon compatible):
  // ,label,price,validity,sharedUsers,addrPool,lockMac,sellingPrice,expiredMode,parentQueue,
  return `:put (",${label},${opts.price},${opts.validity},${opts.sharedUsers},${opts.addrPool},${lockMacStr},${opts.sellingPrice},${opts.expiredMode},${opts.parentQueue},"); {:local comment [ /ip hotspot user get [/ip hotspot user find where name="$user"] comment]; :local ucode [:pic $comment 0 2]; :if ($ucode = "vc" or $ucode = "up" or $comment = "") do={ :local date [ /system clock get date ];:local year [ :pick $date 0 4 ];:local month [ :pick $date 5 7 ]; /sys sch add name="$user" disable=no start-date=$date interval="${opts.validity}"; :delay 5s; :local exp [ /sys sch get [ /sys sch find where name="$user" ] next-run]; :local getxp [len $exp]; :if ($getxp = 15) do={ :local d [:pic $exp 0 6]; :local t [:pic $exp 7 16]; :local s ("/"); :local exp ("$d$s$year $t"); /ip hotspot user set comment="$exp" [find where name="$user"];}; :if ($getxp = 8) do={ /ip hotspot user set comment="$date $exp" [find where name="$user"];}; :if ($getxp > 15) do={ /ip hotspot user set comment="$exp" [find where name="$user"];};:delay 5s; /sys sch remove [find where name="$user"];${macLockPart} :local mac $"mac-address"; :local time [/system clock get time ]; /system script add name="$date-|-$time-|-$user-|-${opts.price}-|-$address-|-$mac-|-${opts.validity}-|-${opts.name}-|-$comment" owner="$month$year" source="$date" comment="mikhmon"}}`;
}

export async function createProfile(conn: RouterConnection, opts: CreateProfileOptions): Promise<void> {
  return withRouter(conn, async (api) => {
    const onLogin = generateMikHmonOnLogin(opts);
    const args = [
      `=name=${opts.name}`,
      `=on-login=${onLogin}`,
      `=shared-users=${opts.sharedUsers || "1"}`,
    ];
    if (opts.rateLimit)    args.push(`=rate-limit=${opts.rateLimit}`);
    if (opts.addrPool)     args.push(`=address-pool=${opts.addrPool}`);
    if (opts.parentQueue)  args.push(`=parent-queue=${opts.parentQueue}`);
    await api.write("/ip/hotspot/user/profile/add", args);
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
      username: fixEncoding((u["name"] as string) ?? ""),
      password: (u["password"] as string) ?? "",
      profile: fixEncoding((u["profile"] as string) ?? ""),
      comment: fixEncoding((u["comment"] as string) || null) || null,
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
  }, 10_000);
}

export async function listSessions(conn: RouterConnection): Promise<HotspotSession[]> {
  return withRouter(conn, async (api) => {
    const sessions = await api.write("/ip/hotspot/active/print");
    return sessions.map((s) => ({
      user: (s["user"] as string) ?? "",
      address: (s["address"] as string) ?? "",
      macAddress: (s["mac-address"] as string) || null,
      uptime: (s["uptime"] as string) ?? "00:00:00",
      bytesIn: (s["bytes-in"] as string) || null,
      bytesOut: (s["bytes-out"] as string) || null,
      server: (s["server"] as string) || null,
    }));
  });
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

export async function listLogs(conn: RouterConnection, limit = 50, topicFilter?: string): Promise<LogEntry[]> {
  return withRouter(conn, async (api) => {
    const entries = await api.write("/log/print");
    let filtered = entries;
    if (topicFilter) {
      const lc = topicFilter.toLowerCase();
      filtered = entries.filter((e) =>
        ((e["topics"] as string) ?? "").toLowerCase().includes(lc)
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
): Promise<{ done: number; notFound: string[] }> {
  if (usernames.length === 0) return { done: 0, notFound: [] };

  const target = new Set(usernames.map((u) => u.toLowerCase()));

  return withRouter(conn, async (api) => {
    // Fetch all hotspot users once
    const all = await api.write("/ip/hotspot/user/print");

    const toSet: string[] = [];   // .id values to update
    const found = new Set<string>();

    for (const u of all) {
      const name = fixEncoding((u["name"] as string) ?? "").toLowerCase();
      const id   = (u[".id"]  as string) ?? "";
      if (!name || !id) continue;
      if (target.has(name)) {
        toSet.push(id);
        found.add(name);
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

    return { done: toSet.length, notFound };
  }, 30_000);
}

/**
 * Delete all hotspot users whose comment exactly matches the given string.
 */
export async function deleteHotspotUsersByComment(
  conn: RouterConnection,
  comment: string,
): Promise<number> {
  return withRouter(conn, async (api) => {
    const all = await api.write("/ip/hotspot/user/print");
    const toDelete: string[] = [];
    for (const u of all) {
      if (fixEncoding((u["comment"] as string) ?? "") === comment) {
        const id = u[".id"] as string | undefined;
        if (id) toDelete.push(id);
      }
    }
    if (toDelete.length > 0) {
      await api.write("/ip/hotspot/user/remove", [`=.id=${toDelete.join(",")}`]);
    }
    return toDelete.length;
  }, 30_000);
}

/**
 * Delete specific hotspot users by their usernames.
 */
export async function deleteHotspotUsersByNames(
  conn: RouterConnection,
  usernames: string[],
): Promise<number> {
  if (usernames.length === 0) return 0;
  const target = new Set(usernames.map((u) => u.toLowerCase()));
  return withRouter(conn, async (api) => {
    const all = await api.write("/ip/hotspot/user/print");
    const toDelete: string[] = [];
    for (const u of all) {
      const name = fixEncoding((u["name"] as string) ?? "").toLowerCase();
      const id = u[".id"] as string | undefined;
      if (name && id && target.has(name)) toDelete.push(id);
    }
    if (toDelete.length > 0) {
      await api.write("/ip/hotspot/user/remove", [`=.id=${toDelete.join(",")}`]);
    }
    return toDelete.length;
  }, 30_000);
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
  api: { write: (path: string, params?: string[]) => Promise<Record<string, unknown>[]> },
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
  }, 15_000);
}

export async function disconnectSession(conn: RouterConnection, username: string): Promise<number> {
  return withRouter(conn, async (api) => {
    const sessions = await api.write("/ip/hotspot/active/print", [`?user=${username}`]);
    let removed = 0;
    for (const s of sessions) {
      const id = s[".id"] as string | undefined;
      if (id) {
        await api.write("/ip/hotspot/active/remove", [`=.id=${id}`]);
        removed++;
      }
    }
    return removed;
  });
}

/**
 * Reset a hotspot user — Mikhmon-style: kick session, delete user, recreate
 * with identical credentials (name, password, profile, comment, server,
 * mac-address, limit-uptime, limit-bytes-total).  This is the only reliable
 * way to zero all counters AND restore the full remaining quota on RouterOS.
 */
export async function resetHotspotUser(
  conn: RouterConnection,
  username: string,
): Promise<{ found: boolean; sessionKicked: number; salesScriptsRemoved: number; salesScriptsFailed: number }> {
  return withRouter(conn, async (api) => {
    // 1. Find user and capture all relevant fields. Use server-side query
    //    with multiple encoding variants — scanning all users is slow and
    //    fragile when names contain non-ASCII bytes that can't round-trip.
    const user = await findHotspotUserByName(api, username);
    if (!user) return { found: false, sessionKicked: 0, salesScriptsRemoved: 0, salesScriptsFailed: 0 };

    const id = user[".id"] as string | undefined;

    // Snapshot fields we need to recreate the user
    const name           = (user["name"]              as string) ?? username;
    const password       = (user["password"]          as string) ?? "";
    const profile        = (user["profile"]           as string) ?? "default";
    const rawComment     = (user["comment"]           as string) ?? "";
    // Strip any expiration timestamp written by the MikHmon on-login script —
    // otherwise the recreated user inherits the past expiry date and stays
    // marked as "Expiré" both in the UI and in the on-login script logic.
    // Date formats handled (case-insensitive): "mmm/dd/yyyy HH:mm[:ss]" and
    // "YYYY-MM-DD HH:mm[:ss]".  Any surrounding text (e.g. lot tag "vc-foo")
    // is preserved.
    const comment = rawComment
      .replace(/[a-z]{3}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?/gi, "")
      .replace(/\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const server         = (user["server"]            as string) ?? "";
    // NOTE: mac-address, limit-uptime and limit-bytes-total are intentionally
    // NOT preserved.  A reset must produce a fully blank voucher:
    //   • limit-uptime / limit-bytes-total are decremented by the on-login
    //     script as the voucher is consumed; preserving them would re-cap
    //     the user at "1s" or near-zero quota.
    //   • mac-address binds the voucher to the device that first logged in;
    //     keeping it would prevent the voucher from being handed to anyone
    //     else.  The on-login script will re-bind on next login if the
    //     profile uses lockMac.
    // By omitting all three, MikroTik recreates a pristine voucher whose
    // quota and MAC binding will be set fresh on the next authentication.
    const disabled       = (user["disabled"]          as string) === "true";

    // 2. Kick active session(s) first
    const sessions = await api.write("/ip/hotspot/active/print", [`?user=${name}`]);
    let sessionKicked = 0;
    for (const s of sessions) {
      const sid = s[".id"] as string | undefined;
      if (sid) {
        await api.write("/ip/hotspot/active/remove", [`=.id=${sid}`]);
        sessionKicked++;
      }
    }

    // 3. Delete the user
    if (id) {
      await api.write("/ip/hotspot/user/remove", [`=.id=${id}`]);
    }

    // 4. Remove MikHmon sales scripts for this username so the background
    //    usage-sync does not re-mark the voucher as used. Script names follow
    //    the pattern "date-|-time-|-username-|-..." with comment "mikhmon".
    let salesScriptsRemoved = 0;
    let salesScriptsFailed = 0;
    const usernameLower = username.toLowerCase();
    const mikhmonScripts = await api.write("/system/script/print", ["?comment=mikhmon"]).catch(() => []);
    for (const s of mikhmonScripts) {
      const sname = (s["name"] as string) ?? "";
      const parts = sname.split("-|-");
      if (parts.length >= 3 && parts[2].trim().toLowerCase() === usernameLower) {
        const sid = s[".id"] as string | undefined;
        if (sid) {
          try {
            await api.write("/system/script/remove", [`=.id=${sid}`]);
            salesScriptsRemoved++;
          } catch {
            salesScriptsFailed++;
          }
        }
      }
    }

    // 5. Recreate as a pristine voucher — same identity (name/password/
    //    profile/server) but no leftover quota, MAC binding or expiry.
    const addParams: string[] = [
      `=name=${toWin1252(name)}`,
      `=password=${toWin1252(password)}`,
      `=profile=${toWin1252(profile)}`,
    ];
    if (comment)  addParams.push(`=comment=${toWin1252(comment)}`);
    if (server)   addParams.push(`=server=${server}`);
    if (disabled) addParams.push(`=disabled=yes`);

    await api.write("/ip/hotspot/user/add", addParams);

    return { found: true, sessionKicked, salesScriptsRemoved, salesScriptsFailed };
  }, 30_000);
}

/**
 * Delete MikHmon sales scripts older than the cutoff (year, month).
 * Scripts whose parsed date is strictly before the first day of the cutoff
 * month are removed. Scripts whose date cannot be parsed are skipped.
 *
 * Returns counts of removed/failed scripts and a per-month breakdown of
 * what was removed (oldest first).
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
    const all = await api.write("/system/script/print", ["?comment=mikhmon"]).catch(() => []);

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

    for (const c of batch) {
      try {
        await api.write("/system/script/remove", [`=.id=${c.id}`]);
        removed++;
        byMonthMap.set(c.ym, (byMonthMap.get(c.ym) ?? 0) + 1);
      } catch {
        failed++;
      }
    }

    const byMonth = Array.from(byMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([yearMonth, count]) => ({ yearMonth, count }));

    return { removed, failed, scanned: total, byMonth };
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

    // Step 2 – Send writes in parallel batches.
    // node-routeros opens a separate tagged channel per api.write() call, so
    // concurrent calls are fully safe over a single connection.
    const BATCH_SIZE = 50;
    for (let i = 0; i < vouchers.length; i += BATCH_SIZE) {
      const batch = vouchers.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(({ addParams }) => api.write("/ip/hotspot/user/add", addParams)));
    }

    return vouchers.map(({ username, password }) => ({
      username,
      password,
      profile: opts.profile,
      price: opts.price,
      validity: opts.validity,
      comment: opts.comment ?? "",
    }));
  }, 120_000);
}
