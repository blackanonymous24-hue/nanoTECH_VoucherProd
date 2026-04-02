import { Router } from "express";
import { db, adminSettingsTable } from "@workspace/db";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken } from "../lib/admin-auth.js";

const router = Router();

async function getOrInitAdmin(): Promise<{ login: string; passwordHash: string }> {
  const rows = await db.select().from(adminSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const passwordHash = await hashPassword("root");
  const [created] = await db
    .insert(adminSettingsTable)
    .values({ login: "admin", passwordHash })
    .returning();
  return created;
}

router.post("/admin/login", async (req, res): Promise<void> => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const admin = await getOrInitAdmin();
  if (login.trim() !== admin.login) {
    res.status(401).json({ error: "Identifiants incorrects" });
    return;
  }
  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Identifiants incorrects" });
    return;
  }
  res.json({ token: createAdminToken() });
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
  await getOrInitAdmin();
  const rows = await db.select({ id: adminSettingsTable.id }).from(adminSettingsTable).limit(1);
  const id = rows[0]?.id;
  if (!id) {
    res.status(500).json({ error: "Paramètres admin introuvables" });
    return;
  }
  const { eq } = await import("drizzle-orm");
  await db
    .update(adminSettingsTable)
    .set({ login: login.trim(), passwordHash })
    .where(eq(adminSettingsTable.id, id));
  res.json({ ok: true });
});

export default router;
