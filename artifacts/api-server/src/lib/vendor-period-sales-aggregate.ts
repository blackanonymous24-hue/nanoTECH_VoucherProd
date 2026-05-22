/**
 * Agrégation ventes par vendeur — alignée MikHmon :
 * - scripts `comment=mikhmon` en base (pas de double comptage bons SQL)
 * - calendrier routeur (/system clock) comme live-report + tableau de bord
 */
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db, scriptSalesTable, vendorsTable } from "@workspace/db";
import { decodeRouterText } from "./router-encoding.js";
import {
  getMikhmonCalendar,
  mikhmonMonthRange,
  saleInMikhmonPeriod,
  type MikhmonVendorPeriod,
} from "./mikhmon-calendar.js";
import { scriptSaleLogicalKey } from "./script-sales-dedup.js";

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

/** Détail des ventes non rattachées à un suffixe vendeur (scripts MikHmon uniquement). */
export async function fetchUnattributedPeriodSales(
  routerId: number,
  period: UnattributedPeriod,
  routerClockDate?: string | null,
): Promise<UnattributedPeriodSalesResult | null> {
  const cal = getMikhmonCalendar(routerClockDate);
  const labels: Record<UnattributedPeriod, string> = {
    today: "Aujourd'hui",
    month: "Mois en cours",
  };

  try {
    const vendors = await loadRouterVendorsForAttribution(routerId);
    const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);

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
        rawName: scriptSalesTable.rawName,
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
      // Décodage défensif (idempotent) : corrige les lignes legacy stockées
      // mojibakées avant le fix d'encodage à l'ingestion.
      const decUsername = decodeRouterText(row.username);
      const decBatch    = decodeRouterText(row.batch);
      const decLabel    = decodeRouterText(row.label);
      const decValidity = decodeRouterText(row.validity);
      if (resolveVendorIdFromSale(vendors, { batch: decBatch, username: decUsername }) != null) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !saleInMikhmonPeriod(saleDate, period, cal, row.rawName)) continue;
      lines.push({
        id: -row.id,
        username: decUsername,
        password: "",
        profileName: decLabel.trim() || decValidity.trim() || "Script MikHmon",
        price: row.price ?? "",
        salePrice: row.price ?? "",
        saleIp: row.ip || null,
        macAddress: row.mac || null,
        printedAt: null,
        usedAt: saleDate.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: decBatch.trim() || null,
        source: "script",
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

export async function aggregateVendorPeriodSales(
  routerId: number,
  routerClockDate?: string | null,
): Promise<VendorPeriodAggRow[] | null> {
  const cal = getMikhmonCalendar(routerClockDate);
  const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);

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
        ip: scriptSalesTable.ip,
        mac: scriptSalesTable.mac,
        rawName: scriptSalesTable.rawName,
      })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, routerId),
          gte(scriptSalesTable.saleDate, monthStart),
          lt(scriptSalesTable.saleDate, monthEnd),
        ),
      );

    const countedKeys = new Set<string>();
    for (const row of scriptRows) {
      const vendorId = resolveVendorIdFromSale(vendors, {
        batch: decodeRouterText(row.batch),
        username: decodeRouterText(row.username),
      });
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime())) continue;
      const dedupKey = scriptSaleLogicalKey(
        decodeRouterText(row.username),
        saleDate,
        row.price,
        row.ip,
        row.mac,
        row.rawName,
      );
      if (countedKeys.has(dedupKey)) continue;
      countedKeys.add(dedupKey);
      const daily = saleInMikhmonPeriod(saleDate, "today", cal, row.rawName);
      const monthly = saleInMikhmonPeriod(saleDate, "month", cal, row.rawName);
      const amount = parsePriceNum(row.price);
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

/** Ventes d'un vendeur (scripts MikHmon), alignées sur le classement admin. */
export async function fetchVendorPeriodSales(
  vendorId: number,
  routerId: number,
  period: VendorPeriod,
  routerClockDate?: string | null,
): Promise<VendorPeriodSalesResult | null> {
  try {
    const cal = getMikhmonCalendar(routerClockDate);
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
    const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);
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
        rawName: scriptSalesTable.rawName,
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
      const decUsername = decodeRouterText(row.username);
      const decBatch    = decodeRouterText(row.batch);
      const decLabel    = decodeRouterText(row.label);
      const decValidity = decodeRouterText(row.validity);
      if (!saleBelongsToVendor(vendorRow, { batch: decBatch, username: decUsername })) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !saleInMikhmonPeriod(saleDate, period as MikhmonVendorPeriod, cal, row.rawName)) continue;
      lines.push({
        id: -row.id,
        username: decUsername,
        password: "",
        profileName: decLabel.trim() || decValidity.trim() || "Script MikHmon",
        price: row.price ?? "",
        salePrice: row.price ?? "",
        saleIp: row.ip || null,
        macAddress: row.mac || null,
        printedAt: null,
        usedAt: saleDate.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: decBatch.trim() || null,
        source: "script",
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
