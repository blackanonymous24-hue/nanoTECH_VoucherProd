import { Router } from "express";
import { isNotNull, isNull, desc } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";

const router = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [
    totalVouchers,
    unprintedVouchers,
    printedVouchers,
    routerCount,
    activeRouters,
    recentVouchers,
  ] = await Promise.all([
    db.$count(vouchersTable),
    db.$count(vouchersTable, isNull(vouchersTable.printedAt)),
    db.$count(vouchersTable, isNotNull(vouchersTable.printedAt)),
    db.$count(routersTable),
    db.$count(routersTable, isNotNull(routersTable.id)),
    db.select().from(vouchersTable).orderBy(desc(vouchersTable.createdAt)).limit(5),
  ]);

  res.json({
    totalVouchers,
    unprintedVouchers,
    printedVouchers,
    routerCount,
    activeRouters,
    recentVouchers,
  });
});

export default router;
