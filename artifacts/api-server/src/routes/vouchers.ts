import { Router } from "express";
import { eq, and, isNotNull, isNull, desc, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable, vendorsTable } from "@workspace/db";
import { generateVouchers, listProfiles, enableDisableHotspotUsers } from "../lib/mikrotik.js";

/**
 * After inserting vouchers, attribute any with vendorId=null to the matching
 * vendor if their comment ends with that vendor's commentSuffix or commentSuffix2.
 * This ensures real-time assignment even when vendorId was not explicitly passed.
 */
async function autoAttributeInserted(insertedIds: number[]) {
  if (insertedIds.length === 0) return;
  try {
    const vendors = await db
      .select({ id: vendorsTable.id, s1: vendorsTable.commentSuffix, s2: vendorsTable.commentSuffix2 })
      .from(vendorsTable)
      .where(sql`${vendorsTable.commentSuffix} IS NOT NULL OR ${vendorsTable.commentSuffix2} IS NOT NULL`);

    for (const v of vendors) {
      const suffixes = [v.s1, v.s2].filter(Boolean) as string[];
      for (const suffix of suffixes) {
        await db
          .update(vouchersTable)
          .set({ vendorId: v.id })
          .where(
            and(
              sql`${vouchersTable.id} = ANY(ARRAY[${sql.raw(insertedIds.join(","))}]::int[])`,
              isNull(vouchersTable.vendorId),
              sql`${vouchersTable.comment} LIKE ${"%" + suffix}`,
            ),
          );
      }
    }
  } catch {
    // non-blocking
  }
}

const router = Router();

router.get("/vouchers", async (req, res): Promise<void> => {
  const { routerId, profile, printed, limit, offset } = req.query as {
    routerId?: string;
    profile?: string;
    printed?: string;
    limit?: string;
    offset?: string;
  };

  const conditions = [];
  if (routerId) conditions.push(eq(vouchersTable.routerId, parseInt(routerId, 10)));
  if (profile) conditions.push(eq(vouchersTable.profileName, profile));
  if (printed === "true") conditions.push(isNotNull(vouchersTable.printedAt));
  if (printed === "false") conditions.push(isNull(vouchersTable.printedAt));

  const lim = limit ? parseInt(limit, 10) : 50;
  const off = offset ? parseInt(offset, 10) : 0;

  const query = db
    .select()
    .from(vouchersTable)
    .orderBy(desc(vouchersTable.createdAt))
    .limit(lim)
    .offset(off);

  const countQuery = db.$count(vouchersTable, conditions.length > 0 ? and(...conditions) : undefined);

  const [vouchers, total] = await Promise.all([
    conditions.length > 0 ? query.where(and(...conditions)) : query,
    countQuery,
  ]);

  res.json({ vouchers, total });
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const { routerId, profile, qty, prefix, comment, server, vendorId, passwordMode, charType, userLength, timelimit, datalimit } = req.body as {
    routerId?: number;
    profile?: string;
    qty?: number;
    prefix?: string;
    comment?: string;
    server?: string;
    vendorId?: number | null;
    passwordMode?: "same" | "random";
    charType?: "lower" | "upper" | "upplow" | "mix" | "mix1" | "mix2" | "num";
    userLength?: number;
    timelimit?: string;
    datalimit?: number;
  };

  if (!routerId || !profile || !qty) {
    res.status(400).json({ error: "routerId, profile et qty sont requis" });
    return;
  }
  if (qty < 1 || qty > 200) {
    res.status(400).json({ error: "qty doit être entre 1 et 200" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  let price = "";
  let validity = "";

  try {
    const profiles = await listProfiles({ host: r.host, port: r.port, username: r.username, password: r.password });
    const prof = profiles.find((p) => p.name === profile);
    if (prof) {
      price = prof.price ?? "";
      validity = prof.validity ?? "";
    }
  } catch {
    // Continue without profile metadata
  }

  try {
    const generated = await generateVouchers(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      { qty, profile, prefix, comment, server, price, validity, passwordMode: passwordMode ?? "same", charType, userLength, timelimit: timelimit || undefined, datalimit: datalimit || undefined },
    );

    const inserted = await db
      .insert(vouchersTable)
      .values(
        generated.map((v) => ({
          routerId,
          vendorId: vendorId ?? null,
          username: v.username,
          password: v.password,
          profileName: v.profile,
          price: v.price,
          validity: v.validity,
          comment: v.comment || null,
        })),
      )
      .returning();

    res.status(201).json(inserted);

    // Background: auto-attribute vouchers without vendorId to the matching vendor by comment suffix
    void autoAttributeInserted(inserted.map((v) => v.id));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/vouchers/lot-disable", async (req, res): Promise<void> => {
  const { routerId, comment, enable } = req.body as {
    routerId?: number;
    comment?: string;
    enable?: boolean;
  };
  if (!routerId || !comment) {
    res.status(400).json({ error: "routerId et comment sont requis" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const vouchers = await db
    .select({ username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, routerId), eq(vouchersTable.comment, comment)));

  if (vouchers.length === 0) {
    res.json({ done: 0, notFound: [] });
    return;
  }

  try {
    const usernames = vouchers.map((v) => v.username);
    const result = await enableDisableHotspotUsers(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      usernames,
      enable ?? false,
    );
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(vouchersTable).where(eq(vouchersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.sendStatus(204);
});

router.post("/vouchers/:id/mark-printed", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [updated] = await db
    .update(vouchersTable)
    .set({ printedAt: new Date() })
    .where(eq(vouchersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.json(updated);
});

export default router;
