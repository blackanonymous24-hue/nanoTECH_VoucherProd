import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { parseConfig, configToEntries, testConnection, type RouterOSConfig } from "../lib/routeros";

const router: IRouter = Router();

const ROS_KEYS = ["routeros.enabled", "routeros.host", "routeros.port", "routeros.ssl", "routeros.user", "routeros.password"];

async function fetchConfig(): Promise<RouterOSConfig> {
  const rows = await db.select().from(settingsTable).where(inArray(settingsTable.key, ROS_KEYS));
  const raw: Record<string, string | null | undefined> = {};
  rows.forEach((r) => { raw[r.key] = r.value ?? undefined; });
  return parseConfig(raw);
}

// GET /settings/routeros
router.get("/settings/routeros", async (_req, res): Promise<void> => {
  const cfg = await fetchConfig();
  res.json(cfg);
});

// PUT /settings/routeros
router.put("/settings/routeros", async (req, res): Promise<void> => {
  const body = req.body as Partial<RouterOSConfig>;
  const current = await fetchConfig();
  const updated: RouterOSConfig = {
    enabled: body.enabled ?? current.enabled,
    host: body.host ?? current.host,
    port: typeof body.port === "number" ? body.port : current.port,
    ssl: body.ssl ?? current.ssl,
    user: body.user ?? current.user,
    password: body.password !== undefined ? body.password : current.password,
  };

  const entries = configToEntries(updated);
  for (const [key, value] of Object.entries(entries)) {
    await db
      .insert(settingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }

  res.json(updated);
});

// GET /settings/routeros/test
router.get("/settings/routeros/test", async (_req, res): Promise<void> => {
  const cfg = await fetchConfig();
  if (!cfg.host) {
    res.json({ success: false, message: "RouterOS non configuré", profiles: [] });
    return;
  }
  const result = await testConnection(cfg);
  res.json(result);
});

export default router;
