/**
 * Agrégation ventes par vendeur (jour / mois UTC) — alignée sur
 * `readSalesQuickFromDb` + rapport de ventes : scripts par suffixe de lot,
 * bons hors doublon script même login + même jour UTC.
 */
import { and, eq, isNotNull, notExists, sql } from "drizzle-orm";
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
