import { RouterOSAPI } from "node-routeros";

export interface RouterConnection {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface HotspotProfile {
  name: string;
  rateLimit: string | null;
  validity: string | null;
  price: string | null;
  sharedUsers: string | null;
  addrPool: string | null;
  lockMac: boolean;
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

function parseProfileOnLogin(onLogin: string): { price: string; validity: string; lockMac: boolean } {
  // MikHmon embeds config in a :put ("...") line, e.g.:
  //   :put (",remc,100,3h,100,,Disable,");
  // Fields: [0]="" [1]=label [2]=price [3]=validity [4]=shared [5]=pool [6]=lockMac [7]=""
  const putMatch = onLogin.match(/:put\s*\("([^"]+)"\)/);
  const configStr = putMatch ? putMatch[1] : onLogin;
  const parts = configStr.split(",");
  const price    = (parts[2] ?? "").trim();
  const validity = (parts[3] ?? "").trim();
  const lockField = (parts[6] ?? "").trim();
  // MAC lock field is literally "Enable" when active, "Disable" when inactive
  const lockMac = lockField.toLowerCase() === "enable";
  return { price, validity, lockMac };
}

export async function withRouter<T>(
  conn: RouterConnection,
  fn: (api: RouterOSAPI) => Promise<T>,
  timeout = 15000,
): Promise<T> {
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

export async function listProfiles(conn: RouterConnection): Promise<HotspotProfile[]> {
  return withRouter(conn, async (api) => {
    const profiles = await api.write("/ip/hotspot/user/profile/print");
    return profiles.map((p) => {
      const onLogin = (p["on-login"] as string) ?? "";
      const parsed = onLogin.includes(",") ? parseProfileOnLogin(onLogin) : { price: "", validity: "", lockMac: false };
      return {
        name: fixEncoding((p["name"] as string) ?? ""),
        rateLimit: (p["rate-limit"] as string) || null,
        validity: parsed.validity || null,
        price: parsed.price || null,
        sharedUsers: (p["shared-users"] as string) || null,
        addrPool: (p["address-pool"] as string) || null,
        lockMac: parsed.lockMac,
      };
    });
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

export interface SalesReport {
  dailyCount: number;
  dailyAmount: number;
  monthlyCount: number;
  monthlyAmount: number;
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
export async function fetchSalesFromScripts(conn: RouterConnection): Promise<SalesReport> {
  return withRouter(conn, async (api) => {
    const now = new Date();
    const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const m   = MONTHS[now.getMonth()];
    const d   = String(now.getDate()).padStart(2, "0");
    const y   = now.getFullYear();
    const mm  = String(now.getMonth() + 1).padStart(2, "0");

    // Legacy labels
    const legacyDateLabel  = `${m}/${d}/${y}`;   // "mar/31/2026"
    const legacyOwner      = `${m}${y}`;          // "mar2026"

    // New (7.10+) labels
    const isoDateLabel     = `${y}-${mm}-${d}`;   // "2026-03-31"
    const isoOwner         = `${mm}${y}`;          // "032026"

    // Try new (7.10+) owner first, fall back to legacy if empty
    let allScripts = await api.write("/system/script/print", [`?owner=${isoOwner}`]).catch(() => []);
    if (allScripts.length === 0) {
      allScripts = await api.write("/system/script/print", [`?owner=${legacyOwner}`]).catch(() => []);
    }

    let dailyCount = 0;
    let dailyAmount = 0;
    let monthlyCount = 0;
    let monthlyAmount = 0;

    for (const s of allScripts) {
      const name = (s["name"] as string) ?? "";
      const parts = name.split("-|-");
      if (parts.length < 4) continue;

      const datePart = parts[0];
      const price    = parseFloat(parts[3]) || 0;

      const isToday  = datePart === legacyDateLabel || datePart === isoDateLabel;

      monthlyCount++;
      monthlyAmount += price;

      if (isToday) {
        dailyCount++;
        dailyAmount += price;
      }
    }

    return {
      dailyCount,
      dailyAmount,
      monthlyCount,
      monthlyAmount,
      dateLabel: isoDateLabel,
      monthLabel: isoOwner,
    };
  });
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
        topics: (e["topics"] as string) ?? "",
        message: (e["message"] as string) ?? "",
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
      const name = ((u["name"] as string) ?? "").toLowerCase();
      const id   = (u[".id"]  as string) ?? "";
      if (!name || !id) continue;
      if (target.has(name)) {
        toSet.push(id);
        found.add(name);
      }
    }

    const notFound = usernames.filter((u) => !found.has(u.toLowerCase()));
    const disabledVal = enable ? "no" : "yes";

    if (toSet.length > 0) {
      // Single batch command — RouterOS accepts comma-separated .id list
      // e.g. =.id=*1,*2,*3 — works for any number of users instantly
      await api.write("/ip/hotspot/user/set", [
        `=.id=${toSet.join(",")}`,
        `=disabled=${disabledVal}`,
      ]);
    }

    return { done: toSet.length, notFound };
  }, 30_000);   // 30 s is plenty — batch set is a single round-trip
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

function randomStr(length: number): string {
  const chars = "5ab2c34d";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateCode(
  length: number,
  prefix: string | undefined,
  passwordMode: "same" | "random",
): { username: string; password: string } {
  const code = randomStr(length);
  const username = prefix ? `${prefix}${code}` : code;
  const password = passwordMode === "same" ? username : randomStr(length);
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
  },
): Promise<GeneratedVoucher[]> {
  return withRouter(conn, async (api) => {
    const generated: GeneratedVoucher[] = [];

    for (let i = 0; i < opts.qty; i++) {
      const { username, password } = generateCode(opts.prefix ? 5 : 8, opts.prefix, opts.passwordMode ?? "random");
      const addParams: string[] = [
        `=name=${username}`,
        `=password=${password}`,
        `=profile=${opts.profile}`,
      ];
      if (opts.comment) {
        addParams.push(`=comment=${opts.comment}`);
      }
      if (opts.server) {
        addParams.push(`=server=${opts.server}`);
      }

      await api.write("/ip/hotspot/user/add", addParams);

      generated.push({
        username,
        password,
        profile: opts.profile,
        price: opts.price,
        validity: opts.validity,
        comment: opts.comment ?? "",
      });
    }

    return generated;
  }, 120_000);
}
