import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, adminSettingsTable, vendorsTable, managersTable, routersTable } from "@workspace/db";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken } from "../lib/admin-auth.js";
import { verifyPassword as verifyVendorPassword, createToken as createVendorToken } from "../lib/vendor-auth.js";
import { verifyPassword as verifyManagerPassword, createToken as createManagerToken } from "../lib/manager-auth.js";
import { purgePhantomVouchers } from "../lib/vendor-sync.js";

const router = Router();

async function getOrInitAdmin(): Promise<{ id: number; login: string; passwordHash: string }> {
  const rows = await db.select().from(adminSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const passwordHash = await hashPassword("root");
  const [created] = await db
    .insert(adminSettingsTable)
    .values({ login: "admin", passwordHash })
    .returning();
  return created;
}

router.post("/login", async (req, res): Promise<void> => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const loginTrimmed = login.trim();

  const admin = await getOrInitAdmin();
  if (loginTrimmed === admin.login) {
    const valid = await verifyPassword(password, admin.passwordHash);
    if (valid) {
      res.json({ role: "admin", token: createAdminToken() });
      return;
    }
  }

  const [manager] = await db
    .select()
    .from(managersTable)
    .where(eq(managersTable.username, loginTrimmed));

  if (manager?.passwordHash && manager.isActive) {
    const valid = await verifyManagerPassword(password, manager.passwordHash);
    if (valid) {
      res.json({
        role: "manager",
        token: createManagerToken(manager.id),
        manager: { id: manager.id, name: manager.name, username: manager.username, routerId: manager.routerId ?? null },
      });
      return;
    }
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.username, loginTrimmed));

  if (vendor?.passwordHash && vendor.isActive) {
    const valid = await verifyVendorPassword(password, vendor.passwordHash);
    if (valid) {
      res.json({
        role: "vendor",
        token: createVendorToken(vendor.id),
        vendor: { id: vendor.id, name: vendor.name, email: vendor.email, username: vendor.username },
      });
      return;
    }
  }

  res.status(401).json({ error: "Identifiants incorrects" });
});

router.get("/admin/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const admin = await getOrInitAdmin();
  res.json({ login: admin.login });
});

router.put("/admin/credentials", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const admin = await getOrInitAdmin();
  await db
    .update(adminSettingsTable)
    .set({ login: login.trim(), passwordHash })
    .where(eq(adminSettingsTable.id, admin.id));
  res.json({ ok: true });
});

router.post("/admin/purge-phantoms", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const { routerId } = req.body as { routerId?: number };

  const routers = routerId
    ? await db.select({ id: routersTable.id, host: routersTable.host, name: routersTable.name }).from(routersTable).where(eq(routersTable.id, routerId))
    : await db.select({ id: routersTable.id, host: routersTable.host, name: routersTable.name }).from(routersTable);

  const results: Array<Awaited<ReturnType<typeof purgePhantomVouchers>> & { routerName: string }> = [];
  for (const r of routers) {
    const result = await purgePhantomVouchers(r.id);
    results.push({ ...result, routerName: r.name ?? r.host });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  res.json({ results, totalDeleted });
});

export default router;
