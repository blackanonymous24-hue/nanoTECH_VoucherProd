/**
 * Agrégation ventes par vendeur (jour / mois UTC) — alignée sur
 * `readSalesQuickFromDb` + rapport de ventes : scripts par suffixe de lot,
 * bons hors doublon script même login + même jour UTC.
 */
import { and, asc, desc, eq, gte, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { db, scriptSalesTable, vendorsTable, vouchersTable } from "@workspace/db";

/** Bornes UTC [startOfMonth, startOfNextMonth) — utilisables par les index B-tree. */
function utcMonthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end   = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

/** Ligne synthétique ventes sans suffixe reconnu (pas de fiche vendeur). */
export const UNATTRIBUTED_VENDOR_ID = 0;
export const UNATTRIBUTED_VENDOR_NAME = "Vente sans identifiant";

export type VendorPeriodAggRow = {
  vendorId: number;
  name: string;
  dailySold: number;
  monthlySold: number;
  dailyAmount: number;
  monthlyAmount: number;
};

export type VendorPeriod = "today" | "yesterday" | "week" | "month";

type VendorSuffixRow = {
  id: number;
  name: string;
  isDemo: boolean;
  commentSuffix: string | null;
  commentSuffix2: string | null;
  ticketLetter: string | null;
};

/** Tous les vendeurs du routeur (dont démo) pour l'attribution ; le classement admin n'expose que les non-démo. */
async function loadRouterVendorsForAttribution(routerId: number): Promise<VendorSuffixRow[]> {
  return db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
      isDemo: vendorsTable.isDemo,
      commentSuffix: vendorsTable.commentSuffix,
      commentSuffix2: vendorsTable.commentSuffix2,
      ticketLetter: vendorsTable.ticketLetter,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.routerId, routerId))
    .orderBy(asc(vendorsTable.name));
}

function voucherNotCoveredByScriptSameUtcDay() {
  return notExists(
    db
      .select({ id: scriptSalesTable.id })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, vouchersTable.routerId),
          sql`lower(${scriptSalesTable.username}) = lower(${vouchersTable.username})`,
          sql`((${scriptSalesTable.saleDate} AT TIME ZONE 'UTC')::date) = ((${vouchersTable.usedAt} AT TIME ZONE 'UTC')::date)`,
        ),
      ),
  );
}

function vendorSuffixes(v: VendorSuffixRow): string[] {
  return [v.commentSuffix, v.commentSuffix2]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
}

/** Attribue à un seul vendeur : suffixe le plus long qui matche (évite les chevauchements). */
function resolveVendorIdBySuffix(
  text: string | null | undefined,
  vendors: VendorSuffixRow[],
): number | null {
  if (!text?.trim()) return null;
  const t = text.trim();
  let bestId: number | null = null;
  let bestLen = 0;
  for (const v of vendors) {
    for (const s of vendorSuffixes(v)) {
      if (t.endsWith(s) && s.length > bestLen) {
        bestLen = s.length;
        bestId = v.id;
      }
    }
  }
  return bestId;
}

function utcParts(d: Date) {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isUtcDay(d: Date, y: number, m: number, day: number): boolean {
  const p = utcParts(d);
  return p.y === y && p.m === m && p.day === day;
}

function isUtcMonth(d: Date, y: number, m: number): boolean {
  const p = utcParts(d);
  return p.y === y && p.m === m;
}

export type UnattributedPeriod = "today" | "month";

export type UnattributedSaleLine = {
  id: number;
  username: string;
  password: string;
  profileName: string;
  price: string;
  salePrice: string | null;
  saleIp: string | null;
  macAddress: string | null;
  printedAt: string | null;
  usedAt: string | null;
  createdAt: string;
  /** Lot script ou commentaire bon — utile pour diagnostiquer l'attribution. */
  lotOrComment: string | null;
  source: "script" | "voucher";
};

export type UnattributedPeriodSalesResult = {
  vendorName: string;
  period: UnattributedPeriod;
  label: string;
  total: number;
  revenue: number;
  byProfile: { profileName: string; count: number; revenue: number }[];
  vouchers: UnattributedSaleLine[];
};

function parsePriceNum(price: string | null | undefined): number {
  if (!price?.trim()) return 0;
  return parseFloat(price.replace(/\s/g, "")) || 0;
}

function inPeriodUtc(d: Date, period: UnattributedPeriod, yUtc: number, mUtc: number, dUtc: number): boolean {
  if (period === "today") return isUtcDay(d, yUtc, mUtc, dUtc);
  return isUtcMonth(d, yUtc, mUtc);
}

function utcYesterdayParts(now = new Date()) {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return utcParts(prev);
}

/** Dernière semaine calendaire (lun → dim) en UTC, alignée portail admin. */
function inUtcLastWeek(d: Date, now = new Date()): boolean {
  const dow = now.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday));
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const t = d.getTime();
  return t >= lastMonday.getTime() && t < thisMonday.getTime();
}

function inVendorPeriod(d: Date, period: VendorPeriod, now = new Date()): boolean {
  const { y: yUtc, m: mUtc, day: dUtc } = utcParts(now);
  if (period === "today") return isUtcDay(d, yUtc, mUtc, dUtc);
  if (period === "yesterday") {
    const yp = utcYesterdayParts(now);
    return isUtcDay(d, yp.y, yp.m, yp.day);
  }
  if (period === "week") return inUtcLastWeek(d, now);
  return isUtcMonth(d, yUtc, mUtc);
}

const PERIOD_LABELS: Record<VendorPeriod, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "Semaine dernière",
  month: "Mois en cours",
};

/**
 * Vente rattachée au vendeur — règles strictes (évite la pollution entre vendeurs) :
 *   1. `vendorId` explicite — match parfait
 *   2. Suffixe vendeur (`commentSuffix` / `commentSuffix2`) en fin de lot OU commentaire
 *   3. `ticketLetter` (≥ 2 caractères) en fin de lot OU commentaire — JAMAIS en
 *      préfixe d'username (trop permissif : un seul caractère ferait matcher
 *      n'importe quel username commençant par cette lettre).
 */
export function saleBelongsToVendor(
  vendor: VendorSuffixRow,
  opts: {
    vendorId?: number | null;
    comment?: string | null;
    batch?: string | null;
    username?: string | null;
  },
): boolean {
  if (opts.vendorId === vendor.id) return true;
  const text = opts.comment ?? opts.batch ?? "";
  if (resolveVendorIdBySuffix(text, [vendor]) === vendor.id) return true;

  const letter = vendor.ticketLetter?.trim();
  if (!letter || letter.length < 2) return false; // exige ≥ 2 caractères
  const low = letter.toLowerCase();

  const b = opts.batch?.trim();
  if (b && b.toLowerCase().endsWith(low)) return true;
  const c = opts.comment?.trim();
  if (c && c.toLowerCase().endsWith(low)) return true;
  return false;
}

function resolveVendorIdFromSale(
  vendors: VendorSuffixRow[],
  opts: {
    vendorId?: number | null;
    comment?: string | null;
    batch?: string | null;
    username?: string | null;
  },
): number | null {
  if (opts.vendorId != null && vendors.some((v) => v.id === opts.vendorId)) return opts.vendorId;
  const bySuffix = resolveVendorIdBySuffix(opts.comment ?? opts.batch, vendors);
  if (bySuffix != null) return bySuffix;
  for (const v of vendors) {
    if (saleBelongsToVendor(v, opts)) return v.id;
  }
  return null;
}

/** Détail des ventes non rattachées à un suffixe vendeur (scripts + bons hors doublon). */
export async function fetchUnattributedPeriodSales(
  routerId: number,
  period: UnattributedPeriod,
): Promise<UnattributedPeriodSalesResult | null> {
  const now = new Date();
  const { y: yUtc, m: mUtc, day: dUtc } = utcParts(now);
  const labels: Record<UnattributedPeriod, string> = {
    today: "Aujourd'hui",
    month: "Mois en cours",
  };

  try {
    const vendors = await loadRouterVendorsForAttribution(routerId);
    const { start: monthStart, end: monthEnd } = utcMonthBounds(yUtc, mUtc);

    const lines: UnattributedSaleLine[] = [];

    const scriptRows = await db
      .select({
        id: scriptSalesTable.id,
        username: scriptSalesTable.username,
        saleDate: scriptSalesTable.saleDate,
        price: scriptSalesTable.price,
        ip: scriptSalesTable.ip,
        mac: scriptSalesTable.mac,
        validity: scriptSalesTable.validity,
        label: scriptSalesTable.label,
        batch: scriptSalesTable.batch,
        createdAt: scriptSalesTable.createdAt,
      })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, routerId),
          gte(scriptSalesTable.saleDate, monthStart),
          lt(scriptSalesTable.saleDate, monthEnd),
        ),
      )
      .orderBy(desc(scriptSalesTable.saleDate));

    for (const row of scriptRows) {
      if (resolveVendorIdFromSale(vendors, { batch: row.batch, username: row.username }) != null) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !inPeriodUtc(saleDate, period, yUtc, mUtc, dUtc)) continue;
      lines.push({
        id: -row.id,
        username: row.username,
        password: "",
        profileName: row.label?.trim() || row.validity?.trim() || "Script MikHmon",
        price: row.price ?? "",
        salePrice: row.price ?? "",
        saleIp: row.ip || null,
        macAddress: row.mac || null,
        printedAt: null,
        usedAt: saleDate.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: row.batch?.trim() || null,
        source: "script",
      });
    }

    const voucherRows = await db
      .select()
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameUtcDay(),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      )
      .orderBy(desc(vouchersTable.usedAt));

    for (const row of voucherRows) {
      const vendorId = resolveVendorIdFromSale(vendors, {
        vendorId: row.vendorId,
        comment: row.comment,
        username: row.username,
      });
      if (vendorId != null) continue;
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime()) || !inPeriodUtc(usedAt, period, yUtc, mUtc, dUtc)) continue;
      lines.push({
        id: row.id,
        username: row.username,
        password: row.password,
        profileName: row.profileName,
        price: row.price ?? "",
        salePrice: row.salePrice,
        saleIp: row.saleIp,
        macAddress: row.macAddress,
        printedAt: row.printedAt ? (row.printedAt instanceof Date ? row.printedAt : new Date(row.printedAt)).toISOString() : null,
        usedAt: usedAt.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: row.comment?.trim() || null,
        source: "voucher",
      });
    }

    lines.sort((a, b) => {
      const ta = a.usedAt ? new Date(a.usedAt).getTime() : 0;
      const tb = b.usedAt ? new Date(b.usedAt).getTime() : 0;
      return tb - ta;
    });

    const byProfileMap = new Map<string, { count: number; revenue: number }>();
    let revenue = 0;
    for (const v of lines) {
      const p = parsePriceNum(v.salePrice || v.price);
      revenue += p;
      const name = v.profileName?.trim() || "—";
      const cur = byProfileMap.get(name) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += p;
      byProfileMap.set(name, cur);
    }

    const byProfile = [...byProfileMap.entries()]
      .map(([profileName, { count, revenue: rev }]) => ({ profileName, count, revenue: rev }))
      .sort((a, b) => b.count - a.count);

    return {
      vendorName: UNATTRIBUTED_VENDOR_NAME,
      period,
      label: labels[period],
      total: lines.length,
      revenue,
      byProfile,
      vouchers: lines,
    };
  } catch {
    return null;
  }
}

export async function aggregateVendorPeriodSales(routerId: number): Promise<VendorPeriodAggRow[] | null> {
  const now = new Date();
  const { y: yUtc, m: mUtc, day: dUtc } = utcParts(now);
  const { start: monthStart, end: monthEnd } = utcMonthBounds(yUtc, mUtc);

  try {
    const vendors = await loadRouterVendorsForAttribution(routerId);
    const reportingVendors = vendors.filter((v) => !v.isDemo);
    const demoVendorIds = new Set(vendors.filter((v) => v.isDemo).map((v) => v.id));

    if (reportingVendors.length === 0 && demoVendorIds.size === 0) return [];

    const dailyByVendor = new Map<number, number>();
    const monthlyByVendor = new Map<number, number>();
    const dailyAmountByVendor = new Map<number, number>();
    const monthlyAmountByVendor = new Map<number, number>();
    let unattrDaily = 0;
    let unattrMonthly = 0;
    let unattrDailyAmount = 0;
    let unattrMonthlyAmount = 0;
    const bump = (vendorId: number, daily: boolean, monthly: boolean, amount: number) => {
      if (daily) {
        dailyByVendor.set(vendorId, (dailyByVendor.get(vendorId) ?? 0) + 1);
        dailyAmountByVendor.set(vendorId, (dailyAmountByVendor.get(vendorId) ?? 0) + amount);
      }
      if (monthly) {
        monthlyByVendor.set(vendorId, (monthlyByVendor.get(vendorId) ?? 0) + 1);
        monthlyAmountByVendor.set(vendorId, (monthlyAmountByVendor.get(vendorId) ?? 0) + amount);
      }
    };
    const bumpUnattr = (daily: boolean, monthly: boolean, amount: number) => {
      if (daily) { unattrDaily += 1; unattrDailyAmount += amount; }
      if (monthly) { unattrMonthly += 1; unattrMonthlyAmount += amount; }
    };

    const scriptRows = await db
      .select({
        batch: scriptSalesTable.batch,
        username: scriptSalesTable.username,
        saleDate: scriptSalesTable.saleDate,
        price: scriptSalesTable.price,
      })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, routerId),
          gte(scriptSalesTable.saleDate, monthStart),
          lt(scriptSalesTable.saleDate, monthEnd),
        ),
      );

    for (const row of scriptRows) {
      const vendorId = resolveVendorIdFromSale(vendors, { batch: row.batch, username: row.username });
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime())) continue;
      const daily = isUtcDay(saleDate, yUtc, mUtc, dUtc);
      const monthly = isUtcMonth(saleDate, yUtc, mUtc);
      const amount = parsePriceNum(row.price);
      if (vendorId == null) {
        bumpUnattr(daily, monthly, amount);
        continue;
      }
      if (demoVendorIds.has(vendorId)) continue;
      bump(vendorId, daily, monthly, amount);
    }

    const voucherRows = await db
      .select({
        vendorId: vouchersTable.vendorId,
        comment: vouchersTable.comment,
        username: vouchersTable.username,
        usedAt: vouchersTable.usedAt,
        salePrice: vouchersTable.salePrice,
        price: vouchersTable.price,
      })
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameUtcDay(),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      );

    for (const row of voucherRows) {
      const vendorId = resolveVendorIdFromSale(vendors, {
        vendorId: row.vendorId,
        comment: row.comment,
        username: row.username,
      });
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime())) continue;
      const daily = isUtcDay(usedAt, yUtc, mUtc, dUtc);
      const monthly = isUtcMonth(usedAt, yUtc, mUtc);
      const amount = parsePriceNum(row.salePrice ?? row.price);
      if (vendorId == null) {
        bumpUnattr(daily, monthly, amount);
        continue;
      }
      if (demoVendorIds.has(vendorId)) continue;
      bump(vendorId, daily, monthly, amount);
    }

    const rows: VendorPeriodAggRow[] = reportingVendors.map((v) => ({
      vendorId: v.id,
      name: v.name,
      dailySold: dailyByVendor.get(v.id) ?? 0,
      monthlySold: monthlyByVendor.get(v.id) ?? 0,
      dailyAmount: dailyAmountByVendor.get(v.id) ?? 0,
      monthlyAmount: monthlyAmountByVendor.get(v.id) ?? 0,
    }));
    if (unattrDaily > 0 || unattrMonthly > 0) {
      rows.push({
        vendorId: UNATTRIBUTED_VENDOR_ID,
        name: UNATTRIBUTED_VENDOR_NAME,
        dailySold: unattrDaily,
        monthlySold: unattrMonthly,
        dailyAmount: unattrDailyAmount,
        monthlyAmount: unattrMonthlyAmount,
      });
    }
    return rows;
  } catch {
    return null;
  }
}

export type VendorPeriodSalesResult = {
  vendorName: string;
  period: VendorPeriod;
  label: string;
  total: number;
  revenue: number;
  byProfile: { profileName: string; count: number; revenue: number }[];
  vouchers: UnattributedSaleLine[];
};

/** Ventes d'un vendeur (bons + scripts), alignées sur le classement admin. */
export async function fetchVendorPeriodSales(
  vendorId: number,
  routerId: number,
  period: VendorPeriod,
): Promise<VendorPeriodSalesResult | null> {
  try {
    const [vendor] = await db
      .select({
        id: vendorsTable.id,
        name: vendorsTable.name,
        isDemo: vendorsTable.isDemo,
        commentSuffix: vendorsTable.commentSuffix,
        commentSuffix2: vendorsTable.commentSuffix2,
        ticketLetter: vendorsTable.ticketLetter,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId));
    if (!vendor) return null;

    const vendorRow: VendorSuffixRow = vendor;
    const now = new Date();
    const { y: yUtc, m: mUtc } = utcParts(now);
    const { start: monthStart, end: monthEnd } = utcMonthBounds(yUtc, mUtc);
    const lines: UnattributedSaleLine[] = [];

    const scriptRows = await db
      .select({
        id: scriptSalesTable.id,
        username: scriptSalesTable.username,
        saleDate: scriptSalesTable.saleDate,
        price: scriptSalesTable.price,
        ip: scriptSalesTable.ip,
        mac: scriptSalesTable.mac,
        validity: scriptSalesTable.validity,
        label: scriptSalesTable.label,
        batch: scriptSalesTable.batch,
        createdAt: scriptSalesTable.createdAt,
      })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, routerId),
          gte(scriptSalesTable.saleDate, monthStart),
          lt(scriptSalesTable.saleDate, monthEnd),
        ),
      )
      .orderBy(desc(scriptSalesTable.saleDate));

    for (const row of scriptRows) {
      if (!saleBelongsToVendor(vendorRow, { batch: row.batch, username: row.username })) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !inVendorPeriod(saleDate, period, now)) continue;
      lines.push({
        id: -row.id,
        username: row.username,
        password: "",
        profileName: row.label?.trim() || row.validity?.trim() || "Script MikHmon",
        price: row.price ?? "",
        salePrice: row.price ?? "",
        saleIp: row.ip || null,
        macAddress: row.mac || null,
        printedAt: null,
        usedAt: saleDate.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: row.batch?.trim() || null,
        source: "script",
      });
    }

    const voucherRows = await db
      .select()
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameUtcDay(),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      )
      .orderBy(desc(vouchersTable.usedAt));

    for (const row of voucherRows) {
      if (!saleBelongsToVendor(vendorRow, {
        vendorId: row.vendorId,
        comment: row.comment,
        username: row.username,
      })) continue;
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime()) || !inVendorPeriod(usedAt, period, now)) continue;
      lines.push({
        id: row.id,
        username: row.username,
        password: row.password,
        profileName: row.profileName,
        price: row.price ?? "",
        salePrice: row.salePrice,
        saleIp: row.saleIp,
        macAddress: row.macAddress,
        printedAt: row.printedAt ? (row.printedAt instanceof Date ? row.printedAt : new Date(row.printedAt)).toISOString() : null,
        usedAt: usedAt.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: row.comment?.trim() || null,
        source: "voucher",
      });
    }

    lines.sort((a, b) => {
      const ta = a.usedAt ? new Date(a.usedAt).getTime() : 0;
      const tb = b.usedAt ? new Date(b.usedAt).getTime() : 0;
      return tb - ta;
    });

    const byProfileMap = new Map<string, { count: number; revenue: number }>();
    let revenue = 0;
    for (const v of lines) {
      const p = parsePriceNum(v.salePrice || v.price);
      revenue += p;
      const name = v.profileName?.trim() || "—";
      const cur = byProfileMap.get(name) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += p;
      byProfileMap.set(name, cur);
    }

    const byProfile = [...byProfileMap.entries()]
      .map(([profileName, { count, revenue: rev }]) => ({ profileName, count, revenue: rev }))
      .sort((a, b) => b.count - a.count);

    return {
      vendorName: vendor.name,
      period,
      label: PERIOD_LABELS[period],
      total: lines.length,
      revenue,
      byProfile,
      vouchers: lines,
    };
  } catch {
    return null;
  }
}
