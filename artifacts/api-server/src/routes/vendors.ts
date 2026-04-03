import { Router } from "express";
import { eq, desc, and, count, sql, isNotNull, ilike } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable } from "@workspace/db";
import { hashPassword } from "../lib/vendor-auth.js";
import { enableDisableHotspotUsers, type RouterConnection } from "../lib/mikrotik.js";
import { getCachedProfilePrices } from "../lib/profile-cache.js";
import { logger } from "../lib/logger.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";

const router = Router();

function buildTotals(vendorId: number) {
  return db.select({
    total:   count(),
    printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
    used:    sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
  })
  .from(vouchersTable)
  .where(eq(vouchersTable.vendorId, vendorId));
}

const priceNum = sql<number>`nullif(regexp_replace(${vouchersTable.price}, '[^0-9.]', '', 'g'), '')::numeric`;

function buildSalesStats(vendorId: number) {
  return db.select({
    todaySold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= current_date
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      )`,
    todayAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= current_date
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      ), 0)`,
    yesterdaySold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= current_date - interval '1 day'
        and ${vouchersTable.printedAt} < current_date
      )`,
    yesterdayAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= current_date - interval '1 day'
        and ${vouchersTable.printedAt} < current_date
      ), 0)`,
    weekSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('week', current_date)
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      )`,
    weekAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= date_trunc('week', current_date)
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      ), 0)`,
    lastMonthSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date - interval '1 month')
        and ${vouchersTable.printedAt} < date_trunc('month', current_date)
      )`,
    lastMonthAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date - interval '1 month')
        and ${vouchersTable.printedAt} < date_trunc('month', current_date)
      ), 0)`,
    thisMonthSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date)
        and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'
      )`,
    thisMonthAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date)
        and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'
      ), 0)`,
    lastWeekSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week')
        and ${vouchersTable.printedAt} < date_trunc('week', current_date)
      )`,
    lastWeekAmount: sql<number>`
      coalesce(sum(${priceNum}) filter (where
        ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week')
        and ${vouchersTable.printedAt} < date_trunc('week', current_date)
      ), 0)`,
  })
  .from(vouchersTable)
  .where(eq(vouchersTable.vendorId, vendorId));
}

function safeVendor(v: typeof vendorsTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = v;
  return rest;
}

/** Attribute existing vouchers whose comment ends with commentSuffix to the vendor.
 *  Updates ALL matching rows on the vendor's router, regardless of current vendorId,
 *  so pre-existing tickets and wrongly-assigned tickets are both fixed. */
async function attributeVouchersBySuffix(vendorId: number, routerId: number, commentSuffix: string) {
  if (!commentSuffix || !commentSuffix.trim()) return;
  const suffix = commentSuffix.trim();
  try {
    const result = await db
      .update(vouchersTable)
      .set({ vendorId })
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          sql`${vouchersTable.comment} LIKE ${'%' + suffix}`,
          sql`(${vouchersTable.vendorId} IS NULL OR ${vouchersTable.vendorId} != ${vendorId})`,
        )
      )
      .returning({ id: vouchersTable.id });
    if (result.length > 0) {
      logger.info({ vendorId, routerId, suffix, count: result.length }, "vouchers attributed by comment suffix");
    }
  } catch (err) {
    logger.warn({ vendorId, routerId, suffix, err }, "failed to attribute vouchers by suffix");
  }
}

router.get("/vendors", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(routerId ? eq(vendorsTable.routerId, routerId) : undefined)
    .orderBy(vendorsTable.name);
  res.json(vendors.map(safeVendor));
});

router.post("/vendors", async (req, res): Promise<void> => {
  const { name, phone, email, username, password, routerId, commentSuffix, commentSuffix2 } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    routerId?: number;
    commentSuffix?: string;
    commentSuffix2?: string;
  };

  if (!name || name.trim() === "") {
    res.status(400).json({ error: "Le nom du vendeur est requis" });
    return;
  }

  // If username not provided, fall back to phone number
  const resolvedUsername = username?.trim() || phone?.trim() || null;

  if (resolvedUsername) {
    const [existing] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.username, resolvedUsername));
    if (existing) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" });
      return;
    }
  }

  let passwordHash: string | null = null;
  if (password && password.trim()) {
    if (password.length < 4) {
      res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caractères" });
      return;
    }
    passwordHash = await hashPassword(password);
  }

  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      routerId: routerId ?? null,
      name: name.trim().toUpperCase(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      username: resolvedUsername,
      passwordHash,
      commentSuffix: commentSuffix?.trim() || null,
      commentSuffix2: commentSuffix2?.trim() || null,
    })
    .returning();
  res.status(201).json(safeVendor(vendor));

  // Background: attribute local DB vouchers + import MikroTik users by suffix
  if (vendor.routerId && vendor.commentSuffix) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  if (vendor.routerId && vendor.commentSuffix2) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true); // force on creation
  }
});

router.put("/vendors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, phone, email, username, password, isActive, commentSuffix, commentSuffix2 } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    isActive?: boolean;
    commentSuffix?: string;
    commentSuffix2?: string;
  };

  // Fetch current vendor early (needed for username fallback)
  const [current] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!current) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  // If username is being set to empty, fall back to phone (new or current)
  let resolvedUsername: string | null | undefined = undefined;
  if (username !== undefined) {
    resolvedUsername = username.trim() || phone?.trim() || current.phone || null;
  }

  if (resolvedUsername) {
    const [existing] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.username, resolvedUsername));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim().toUpperCase();
  if (phone !== undefined) updates.phone = phone?.trim() || null;
  if (email !== undefined) updates.email = email?.trim() || null;
  if (resolvedUsername !== undefined) updates.username = resolvedUsername;
  if (isActive !== undefined) updates.isActive = isActive;
  if (commentSuffix !== undefined) updates.commentSuffix = commentSuffix?.trim() || null;
  if (commentSuffix2 !== undefined) updates.commentSuffix2 = commentSuffix2?.trim() || null;

  if (password !== undefined && password.trim()) {
    if (password.length < 4) {
      res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caractères" });
      return;
    }
    updates.passwordHash = await hashPassword(password);
  }

  const [vendor] = await db
    .update(vendorsTable)
    .set(updates)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.json(safeVendor(vendor));

  // Background: attribute existing vouchers by suffixes if they changed,
  // and also import matching MikroTik users into local DB
  if (vendor.routerId && vendor.commentSuffix && vendor.commentSuffix !== current.commentSuffix) {
    void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  }
  if (vendor.routerId && vendor.commentSuffix2 && vendor.commentSuffix2 !== current.commentSuffix2) {
    void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  }
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    if (suffixes.length > 0) void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true); // force on update
  }

  // If isActive changed, enable/disable all vouchers on MikroTik (background)
  if (isActive !== undefined && isActive !== current.isActive) {
    const enable = isActive;
    (async () => {
      try {
        const vouchers = await db
          .select({
            username: vouchersTable.username,
            routerId: vouchersTable.routerId,
          })
          .from(vouchersTable)
          .where(eq(vouchersTable.vendorId, id));

        const byRouter = new Map<number, string[]>();
        for (const v of vouchers) {
          const list = byRouter.get(v.routerId) ?? [];
          list.push(v.username);
          byRouter.set(v.routerId, list);
        }

        for (const [routerId, usernames] of byRouter) {
          const [routerRow] = await db
            .select()
            .from(routersTable)
            .where(eq(routersTable.id, routerId));
          if (!routerRow) continue;

          try {
            const result = await enableDisableHotspotUsers(
              {
                host: routerRow.host,
                port: routerRow.port,
                username: routerRow.username,
                password: routerRow.password,
              },
              usernames,
              enable,
            );
            logger.info({ vendorId: id, routerId, enable, ...result }, "vendor vouchers toggled on MikroTik");
          } catch (err) {
            logger.warn({ vendorId: id, routerId, enable, err }, "failed to toggle vouchers on MikroTik");
          }
        }
      } catch (err) {
        logger.error({ vendorId: id, err }, "background enable/disable task failed");
      }
    })();
  }
});

router.post("/vendors/:id/sync", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  res.json({ ok: true, message: "Synchronisation démarrée" });

  // Background: attribute existing DB vouchers + re-import from MikroTik
  if (vendor.routerId && vendor.commentSuffix) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  if (vendor.routerId && vendor.commentSuffix2) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    if (suffixes.length > 0) void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true);
  }
});

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db
    .delete(vendorsTable)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.sendStatus(204);
});

router.get("/vendors/reports/summary", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(routerId ? eq(vendorsTable.routerId, routerId) : undefined)
    .orderBy(vendorsTable.name);

  const summaries = await Promise.all(
    vendors.map(async (vendor) => {
      const [[row], [salesRow]] = await Promise.all([
        buildTotals(vendor.id),
        buildSalesStats(vendor.id),
      ]);

      return {
        vendor: safeVendor(vendor),
        totalVouchers: row?.total        ?? 0,
        totalPrinted:  Number(row?.printed ?? 0),
        totalUsed:     Number(row?.used    ?? 0),
        salesStats: {
          todaySold:       Number(salesRow?.todaySold       ?? 0),
          todayAmount:     Number(salesRow?.todayAmount     ?? 0),
          yesterdaySold:   Number(salesRow?.yesterdaySold   ?? 0),
          yesterdayAmount: Number(salesRow?.yesterdayAmount ?? 0),
          weekSold:        Number(salesRow?.weekSold        ?? 0),
          weekAmount:      Number(salesRow?.weekAmount      ?? 0),
          lastMonthSold:   Number(salesRow?.lastMonthSold   ?? 0),
          lastMonthAmount: Number(salesRow?.lastMonthAmount ?? 0),
          thisMonthSold:   Number(salesRow?.thisMonthSold   ?? 0),
          thisMonthAmount: Number(salesRow?.thisMonthAmount ?? 0),
          lastWeekSold:    Number(salesRow?.lastWeekSold    ?? 0),
          lastWeekAmount:  Number(salesRow?.lastWeekAmount  ?? 0),
        },
      };
    }),
  );

  res.json(summaries);
});

router.get("/vendors/:id/report", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  // Fetch the vendor's router to get profile prices from MikroTik
  const [router] = vendor.routerId
    ? await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId))
    : [];

  const [totalsRows, byProfileRaw, salesRow, recentVouchers] = await Promise.all([
    buildTotals(id),

    db
      .select({
        profileName: vouchersTable.profileName,
        total: count(),
        printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
        used:    sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
      })
      .from(vouchersTable)
      .where(eq(vouchersTable.vendorId, id))
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),

    buildSalesStats(id).then((rows) => rows[0]),

    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), isNotNull(vouchersTable.usedAt)))
      .orderBy(desc(vouchersTable.usedAt))
      .limit(50),
  ]);

  // Enrich byProfile with real prices from MikroTik profile cache
  let priceMap = new Map<string, string>();
  if (router) {
    const conn: RouterConnection = { host: router.host, port: router.port, username: router.username, password: router.password };
    priceMap = await getCachedProfilePrices(vendor.routerId!, conn);
  }
  const byProfile = byProfileRaw.map((row) => ({
    ...row,
    price: priceMap.get(row.profileName) ?? "",
  }));

  const totals = totalsRows[0];

  res.json({
    vendor: safeVendor(vendor),
    totalVouchers: totals?.total        ?? 0,
    totalPrinted:  Number(totals?.printed ?? 0),
    totalUsed:     Number(totals?.used    ?? 0),
    salesStats: {
      todaySold:       Number(salesRow?.todaySold       ?? 0),
      todayAmount:     Number(salesRow?.todayAmount     ?? 0),
      yesterdaySold:   Number(salesRow?.yesterdaySold   ?? 0),
      yesterdayAmount: Number(salesRow?.yesterdayAmount ?? 0),
      weekSold:        Number(salesRow?.weekSold        ?? 0),
      weekAmount:      Number(salesRow?.weekAmount      ?? 0),
      lastMonthSold:   Number(salesRow?.lastMonthSold   ?? 0),
      lastMonthAmount: Number(salesRow?.lastMonthAmount ?? 0),
      thisMonthSold:   Number(salesRow?.thisMonthSold   ?? 0),
      thisMonthAmount: Number(salesRow?.thisMonthAmount ?? 0),
      lastWeekSold:    Number(salesRow?.lastWeekSold    ?? 0),
      lastWeekAmount:  Number(salesRow?.lastWeekAmount  ?? 0),
    },
    byProfile,
    recentVouchers,
  });
});

export default router;
