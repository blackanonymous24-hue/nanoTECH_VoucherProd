/**
 * Agrégation ventes par vendeur (jour / mois LOCAL) — alignée sur
 * le comportement exact de MikHmon originel.
 *
 * MikHmon utilise l'heure locale du serveur pour toutes les bornes de date.
 * Ce module fait de même pour garantir l'alignement parfait.
 *
 * Les bornes ISO sont calculées en JS (heure locale) puis converties en UTC
 * via .toISOString() pour une comparaison correcte avec les timestamps en base.
 */
import { and, asc, desc, eq, gte, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { db, scriptSalesTable, vendorsTable, vouchersTable, routersTable } from "@workspace/db";
import { decodeRouterText } from "./router-encoding.js";

/** Bornes locales [startOfMonth, startOfNextMonth) pour comparaison DB. */
function localMonthBounds(now: Date, tzOffsetMinutes = 0): { start: Date; end: Date } {
  const nowMikrotik = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const start = new Date(Date.UTC(nowMikrotik.getUTCFullYear(), nowMikrotik.getUTCMonth(), 1));
  const end = new Date(Date.UTC(nowMikrotik.getUTCFullYear(), nowMikrotik.getUTCMonth() + 1, 1));
  return {
    start: new Date(start.getTime() - tzOffsetMinutes * 60000),
    end: new Date(end.getTime() - tzOffsetMinutes * 60000),
  };
}

/** Bornes du jour local pour comparaison DB. */
function localDayBounds(now: Date, tzOffsetMinutes = 0): { start: Date; end: Date } {
  const nowMikrotik = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const start = new Date(Date.UTC(nowMikrotik.getUTCFullYear(), nowMikrotik.getUTCMonth(), nowMikrotik.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return {
    start: new Date(start.getTime() - tzOffsetMinutes * 60000),
    end: new Date(end.getTime() - tzOffsetMinutes * 60000),
  };
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

/**
 * Vérifie qu'un voucher n'est pas déjà couvert par un script pour le même
 * username le même jour LOCAL (aligné sur MikHmon).
 */
function voucherNotCoveredByScriptSameLocalDay(now: Date, tzOffsetMinutes = 0) {
  const { start: dayStart, end: dayEnd } = localDayBounds(now, tzOffsetMinutes);
  return notExists(
    db
      .select({ id: scriptSalesTable.id })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, vouchersTable.routerId),
          sql`lower(${scriptSalesTable.username}) = lower(${vouchersTable.username})`,
          sql`${scriptSalesTable.saleDate} >= ${dayStart}`,
          sql`${scriptSalesTable.saleDate} < ${dayEnd}`,
          sql`${vouchersTable.usedAt} >= ${dayStart}`,
          sql`${vouchersTable.usedAt} < ${dayEnd}`,
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

/** Parties de date locale (comme MikHmon). */
function localParts(d: Date, tzOffsetMinutes = 0) {
  const adjusted = new Date(d.getTime() + tzOffsetMinutes * 60000);
  return { y: adjusted.getUTCFullYear(), m: adjusted.getUTCMonth() + 1, day: adjusted.getUTCDate() };
}

function isLocalDay(d: Date, y: number, m: number, day: number, tzOffsetMinutes = 0): boolean {
  const p = localParts(d, tzOffsetMinutes);
  return p.y === y && p.m === m && p.day === day;
}

function isLocalMonth(d: Date, y: number, m: number, tzOffsetMinutes = 0): boolean {
  const p = localParts(d, tzOffsetMinutes);
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

function inPeriodLocal(d: Date, period: UnattributedPeriod, yLocal: number, mLocal: number, dLocal: number, tzOffsetMinutes = 0): boolean {
  if (period === "today") return isLocalDay(d, yLocal, mLocal, dLocal, tzOffsetMinutes);
  return isLocalMonth(d, yLocal, mLocal, tzOffsetMinutes);
}

function localYesterdayParts(now = new Date(), tzOffsetMinutes = 0) {
  const prev = new Date(now.getTime() + tzOffsetMinutes * 60000 - 86_400_000);
  return localParts(prev, tzOffsetMinutes);
}

function inLocalLastWeek(d: Date, now = new Date(), tzOffsetMinutes = 0): boolean {
  const adjustedNow = new Date(now.getTime() + tzOffsetMinutes * 60000);
  const dow = adjustedNow.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(Date.UTC(adjustedNow.getUTCFullYear(), adjustedNow.getUTCMonth(), adjustedNow.getUTCDate() + diffToMonday));
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const t = d.getTime();
  return t >= lastMonday.getTime() && t < thisMonday.getTime();
}

function inVendorPeriodLocal(d: Date, period: VendorPeriod, now = new Date(), tzOffsetMinutes = 0): boolean {
  const { y: yLocal, m: mLocal, day: dLocal } = localParts(now, tzOffsetMinutes);
  if (period === "today") return isLocalDay(d, yLocal, mLocal, dLocal, tzOffsetMinutes);
  if (period === "yesterday") {
    const yp = localYesterdayParts(now, tzOffsetMinutes);
    return isLocalDay(d, yp.y, yp.m, yp.day, tzOffsetMinutes);
  }
  if (period === "week") return inLocalLastWeek(d, now, tzOffsetMinutes);
  return isLocalMonth(d, yLocal, mLocal, tzOffsetMinutes);
}

const PERIOD_LABELS: Record<VendorPeriod, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "Semaine dernière",
  month: "Mois en cours",
};

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
  if (!letter || letter.length < 2) return false;
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

export async function fetchUnattributedPeriodSales(
  routerId: number,
  period: UnattributedPeriod,
): Promise<UnattributedPeriodSalesResult | null> {
  // Fetch router's timezone offset from DB
  const [routerRow] = await db
    .select({ timezoneOffsetMinutes: routersTable.timezoneOffsetMinutes })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  const tzOffset = routerRow?.timezoneOffsetMinutes ?? 0;
  const now = new Date();
  const { y: yLocal, m: mLocal, day: dLocal } = localParts(now, tzOffset);
  const { start: monthStart, end: monthEnd } = localMonthBounds(now, tzOffset);
  const labels: Record<UnattributedPeriod, string> = {
    today: "Aujourd'hui",
    month: "Mois en cours",
  };

  try {
    const vendors = await loadRouterVendorsForAttribution(routerId);
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
      const decUsername = decodeRouterText(row.username);
      const decBatch    = decodeRouterText(row.batch);
      const decLabel    = decodeRouterText(row.label);
      const decValidity = decodeRouterText(row.validity);
      if (resolveVendorIdFromSale(vendors, { batch: decBatch, username: decUsername }) != null) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !inPeriodLocal(saleDate, period, yLocal, mLocal, dLocal, tzOffset)) continue;
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

    const voucherRows = await db
      .select()
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameLocalDay(now, tzOffset),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      )
      .orderBy(desc(vouchersTable.usedAt));

    for (const row of voucherRows) {
      const decUsername    = decodeRouterText(row.username);
      const decComment     = row.comment == null ? null : decodeRouterText(row.comment);
      const decProfileName = decodeRouterText(row.profileName);
      const vendorId = resolveVendorIdFromSale(vendors, {
        vendorId: row.vendorId,
        comment: decComment,
        username: decUsername,
      });
      if (vendorId != null) continue;
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime()) || !inPeriodLocal(usedAt, period, yLocal, mLocal, dLocal, tzOffset)) continue;
      lines.push({
        id: row.id,
        username: decUsername,
        password: row.password,
        profileName: decProfileName,
        price: row.price ?? "",
        salePrice: row.salePrice,
        saleIp: row.saleIp,
        macAddress: row.macAddress,
        printedAt: row.printedAt ? (row.printedAt instanceof Date ? row.printedAt : new Date(row.printedAt)).toISOString() : null,
        usedAt: usedAt.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: decComment?.trim() || null,
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
  // Fetch router's timezone offset from DB
  const [routerRow] = await db
    .select({ timezoneOffsetMinutes: routersTable.timezoneOffsetMinutes })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  const tzOffset = routerRow?.timezoneOffsetMinutes ?? 0;
  const now = new Date();
  const { y: yLocal, m: mLocal, day: dLocal } = localParts(now, tzOffset);
  const { start: monthStart, end: monthEnd } = localMonthBounds(now, tzOffset);

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
      const vendorId = resolveVendorIdFromSale(vendors, {
        batch: decodeRouterText(row.batch),
        username: decodeRouterText(row.username),
      });
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime())) continue;
      const daily = isLocalDay(saleDate, yLocal, mLocal, dLocal, tzOffset);
      const monthly = isLocalMonth(saleDate, yLocal, mLocal, tzOffset);
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
          voucherNotCoveredByScriptSameLocalDay(now, tzOffset),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      );

    for (const row of voucherRows) {
      const vendorId = resolveVendorIdFromSale(vendors, {
        vendorId: row.vendorId,
        comment: row.comment == null ? null : decodeRouterText(row.comment),
        username: decodeRouterText(row.username),
      });
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime())) continue;
      const daily = isLocalDay(usedAt, yLocal, mLocal, dLocal, tzOffset);
      const monthly = isLocalMonth(usedAt, yLocal, mLocal, tzOffset);
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

export async function fetchVendorPeriodSales(
  vendorId: number,
  routerId: number,
  period: VendorPeriod,
): Promise<VendorPeriodSalesResult | null> {
  try {
    const [vendor, routerRow] = await Promise.all([
      db
        .select({
          id: vendorsTable.id,
          name: vendorsTable.name,
          isDemo: vendorsTable.isDemo,
          commentSuffix: vendorsTable.commentSuffix,
          commentSuffix2: vendorsTable.commentSuffix2,
          ticketLetter: vendorsTable.ticketLetter,
        })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId)),
      db
        .select({ timezoneOffsetMinutes: routersTable.timezoneOffsetMinutes })
        .from(routersTable)
        .where(eq(routersTable.id, routerId))
        .limit(1),
    ]);
    if (!vendor[0]) return null;

    const tzOffset = routerRow[0]?.timezoneOffsetMinutes ?? 0;
    const vendorRow: VendorSuffixRow = vendor[0];
    const now = new Date();
    const { start: monthStart, end: monthEnd } = localMonthBounds(now, tzOffset);
    const { y: yLocal, m: mLocal, day: dLocal } = localParts(now, tzOffset);
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
      const decUsername = decodeRouterText(row.username);
      const decBatch    = decodeRouterText(row.batch);
      const decLabel    = decodeRouterText(row.label);
      const decValidity = decodeRouterText(row.validity);
      if (!saleBelongsToVendor(vendorRow, { batch: decBatch, username: decUsername })) continue;
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime()) || !inVendorPeriodLocal(saleDate, period, now, tzOffset)) continue;
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

    const voucherRows = await db
      .select()
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameLocalDay(now, tzOffset),
          gte(vouchersTable.usedAt, monthStart),
          lt(vouchersTable.usedAt, monthEnd),
        ),
      )
      .orderBy(desc(vouchersTable.usedAt));

    for (const row of voucherRows) {
      const decUsername    = decodeRouterText(row.username);
      const decComment     = row.comment == null ? null : decodeRouterText(row.comment);
      const decProfileName = decodeRouterText(row.profileName);
      if (!saleBelongsToVendor(vendorRow, {
        vendorId: row.vendorId,
        comment: decComment,
        username: decUsername,
      })) continue;
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime()) || !inVendorPeriodLocal(usedAt, period, now, tzOffset)) continue;
      lines.push({
        id: row.id,
        username: decUsername,
        password: row.password,
        profileName: decProfileName,
        price: row.price ?? "",
        salePrice: row.salePrice,
        saleIp: row.saleIp,
        macAddress: row.macAddress,
        printedAt: row.printedAt ? (row.printedAt instanceof Date ? row.printedAt : new Date(row.printedAt)).toISOString() : null,
        usedAt: usedAt.toISOString(),
        createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        lotOrComment: decComment?.trim() || null,
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
      vendorName: vendorRow.name,
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
