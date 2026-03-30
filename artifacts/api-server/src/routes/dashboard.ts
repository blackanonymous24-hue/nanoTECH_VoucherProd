import { Router, type IRouter } from "express";
import { eq, count, sum, gte, desc, and } from "drizzle-orm";
import { db, salesTable, vouchersTable, profilesTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentSalesResponse,
  GetVouchersByProfileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalRevenueRow] = await db
    .select({ total: sum(salesTable.amount) })
    .from(salesTable);

  const [revenueTodayRow] = await db
    .select({ total: sum(salesTable.amount) })
    .from(salesTable)
    .where(gte(salesTable.createdAt, today));

  const [soldTotalRow] = await db
    .select({ total: count() })
    .from(salesTable);

  const [soldTodayRow] = await db
    .select({ total: count() })
    .from(salesTable)
    .where(gte(salesTable.createdAt, today));

  const [availableRow] = await db
    .select({ total: count() })
    .from(vouchersTable)
    .where(eq(vouchersTable.status, "available"));

  const [profilesCountRow] = await db
    .select({ total: count() })
    .from(profilesTable);

  res.json(
    GetDashboardStatsResponse.parse({
      totalRevenue: Number(totalRevenueRow?.total ?? 0),
      revenueToday: Number(revenueTodayRow?.total ?? 0),
      vouchersSoldTotal: Number(soldTotalRow?.total ?? 0),
      vouchersSoldToday: Number(soldTodayRow?.total ?? 0),
      vouchersAvailable: Number(availableRow?.total ?? 0),
      totalProfiles: Number(profilesCountRow?.total ?? 0),
    })
  );
});

router.get("/dashboard/recent-sales", async (_req, res): Promise<void> => {
  const sales = await db
    .select()
    .from(salesTable)
    .orderBy(desc(salesTable.createdAt))
    .limit(10);

  res.json(GetRecentSalesResponse.parse(sales));
});

router.get("/dashboard/vouchers-by-profile", async (_req, res): Promise<void> => {
  const profiles = await db.select().from(profilesTable);

  const result = await Promise.all(
    profiles.map(async (profile) => {
      const [availableRow] = await db
        .select({ total: count() })
        .from(vouchersTable)
        .where(and(
          eq(vouchersTable.profileId, profile.id),
          eq(vouchersTable.status, "available")
        ));

      const [soldRow] = await db
        .select({ total: count() })
        .from(vouchersTable)
        .where(and(
          eq(vouchersTable.profileId, profile.id),
          eq(vouchersTable.status, "sold")
        ));

      return {
        profileId: profile.id,
        profileName: profile.name,
        price: profile.price,
        durationMinutes: profile.durationMinutes,
        available: Number(availableRow?.total ?? 0),
        sold: Number(soldRow?.total ?? 0),
      };
    })
  );

  res.json(GetVouchersByProfileResponse.parse(result));
});

export default router;
