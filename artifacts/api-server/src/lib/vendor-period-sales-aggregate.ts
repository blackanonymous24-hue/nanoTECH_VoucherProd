/**
 * Agrégation ventes par vendeur (jour / mois UTC) — alignée sur
 * `readSalesQuickFromDb` + rapport de ventes : scripts par suffixe de lot,
 * bons hors doublon script même login + même jour UTC.
 */
import { and, desc, eq, isNotNull, notExists, sql } from "drizzle-orm";
import { db, scriptSalesTable, vendorsTable, vouchersTable } from "@workspace/db";

/** Ligne synthétique « Non attribué » dans le classement (pas de fiche vendeur). */
export const UNATTRIBUTED_VENDOR_ID = 0;
export const UNATTRIBUTED_VENDOR_NAME = "Non attribué";

export type VendorPeriodAggRow = {
  vendorId: number;
  name: string;
  dailySold: number;
  monthlySold: number;
};

type VendorSuffixRow = {
  id: number;
  name: string;
  commentSuffix: string | null;
  commentSuffix2: string | null;
};

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
    const vendors = await db
      .select({
        id: vendorsTable.id,
        name: vendorsTable.name,
        commentSuffix: vendorsTable.commentSuffix,
        commentSuffix2: vendorsTable.commentSuffix2,
      })
      .from(vendorsTable)
      .where(and(eq(vendorsTable.routerId, routerId), eq(vendorsTable.isDemo, false)));

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
          sql`EXTRACT(YEAR FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}`,
          sql`EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}`,
        ),
      )
      .orderBy(desc(scriptSalesTable.saleDate));

    for (const row of scriptRows) {
      if (resolveVendorIdBySuffix(row.batch, vendors) != null) continue;
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
          sql`EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}`,
          sql`EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}`,
        ),
      )
      .orderBy(desc(vouchersTable.usedAt));

    for (const row of voucherRows) {
      const vendorId = row.vendorId ?? resolveVendorIdBySuffix(row.comment, vendors);
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

  try {
    const vendors = await db
      .select({
        id: vendorsTable.id,
        name: vendorsTable.name,
        commentSuffix: vendorsTable.commentSuffix,
        commentSuffix2: vendorsTable.commentSuffix2,
      })
      .from(vendorsTable)
      .where(and(eq(vendorsTable.routerId, routerId), eq(vendorsTable.isDemo, false)))
      .orderBy(vendorsTable.name);

    if (vendors.length === 0) return [];

    const dailyByVendor = new Map<number, number>();
    const monthlyByVendor = new Map<number, number>();
    let unattrDaily = 0;
    let unattrMonthly = 0;
    const bump = (vendorId: number, daily: boolean, monthly: boolean) => {
      if (daily) dailyByVendor.set(vendorId, (dailyByVendor.get(vendorId) ?? 0) + 1);
      if (monthly) monthlyByVendor.set(vendorId, (monthlyByVendor.get(vendorId) ?? 0) + 1);
    };
    const bumpUnattr = (daily: boolean, monthly: boolean) => {
      if (daily) unattrDaily += 1;
      if (monthly) unattrMonthly += 1;
    };

    const scriptRows = await db
      .select({
        batch: scriptSalesTable.batch,
        saleDate: scriptSalesTable.saleDate,
      })
      .from(scriptSalesTable)
      .where(
        and(
          eq(scriptSalesTable.routerId, routerId),
          sql`EXTRACT(YEAR FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}`,
          sql`EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}`,
        ),
      );

    for (const row of scriptRows) {
      const vendorId = resolveVendorIdBySuffix(row.batch, vendors);
      const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
      if (Number.isNaN(saleDate.getTime())) continue;
      const daily = isUtcDay(saleDate, yUtc, mUtc, dUtc);
      const monthly = isUtcMonth(saleDate, yUtc, mUtc);
      if (vendorId == null) {
        bumpUnattr(daily, monthly);
        continue;
      }
      bump(vendorId, daily, monthly);
    }

    const voucherRows = await db
      .select({
        vendorId: vouchersTable.vendorId,
        comment: vouchersTable.comment,
        usedAt: vouchersTable.usedAt,
      })
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameUtcDay(),
          sql`EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}`,
          sql`EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}`,
        ),
      );

    for (const row of voucherRows) {
      const vendorId = row.vendorId ?? resolveVendorIdBySuffix(row.comment, vendors);
      const usedAt = row.usedAt instanceof Date ? row.usedAt : new Date(row.usedAt!);
      if (Number.isNaN(usedAt.getTime())) continue;
      const daily = isUtcDay(usedAt, yUtc, mUtc, dUtc);
      const monthly = isUtcMonth(usedAt, yUtc, mUtc);
      if (vendorId == null) {
        bumpUnattr(daily, monthly);
        continue;
      }
      bump(vendorId, daily, monthly);
    }

    const rows: VendorPeriodAggRow[] = vendors.map((v) => ({
      vendorId: v.id,
      name: v.name,
      dailySold: dailyByVendor.get(v.id) ?? 0,
      monthlySold: monthlyByVendor.get(v.id) ?? 0,
    }));
    if (unattrDaily > 0 || unattrMonthly > 0) {
      rows.push({
        vendorId: UNATTRIBUTED_VENDOR_ID,
        name: UNATTRIBUTED_VENDOR_NAME,
        dailySold: unattrDaily,
        monthlySold: unattrMonthly,
      });
    }
    return rows;
  } catch {
    return null;
  }
}
