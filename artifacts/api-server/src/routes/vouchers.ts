import { Router, type IRouter } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db, vouchersTable, profilesTable } from "@workspace/db";
import {
  GenerateVouchersBody,
  GetVouchersQueryParams,
  DeleteVoucherParams,
  GetVouchersResponse,
  ImportVouchersBody,
} from "@workspace/api-zod";
import { randomBytes } from "crypto";

const router: IRouter = Router();

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateBatchId(): string {
  return `batch_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

// GET /vouchers/batches — list all batches
router.get("/vouchers/batches", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      batchId: vouchersTable.batchId,
      batchName: vouchersTable.batchName,
      profileId: vouchersTable.profileId,
      profileName: profilesTable.name,
      mikrotikProfile: profilesTable.mikrotikProfile,
      total: sql<number>`count(*)::int`,
      available: sql<number>`count(*) filter (where ${vouchersTable.status} = 'available')::int`,
      sold: sql<number>`count(*) filter (where ${vouchersTable.status} = 'sold')::int`,
      createdAt: sql<string>`min(${vouchersTable.createdAt})::text`,
    })
    .from(vouchersTable)
    .leftJoin(profilesTable, eq(vouchersTable.profileId, profilesTable.id))
    .where(sql`${vouchersTable.batchId} is not null`)
    .groupBy(
      vouchersTable.batchId,
      vouchersTable.batchName,
      vouchersTable.profileId,
      profilesTable.name,
      profilesTable.mikrotikProfile
    )
    .orderBy(sql`min(${vouchersTable.createdAt}) desc`);

  const sanitize = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "profile";

  res.json(
    rows.map((r) => ({
      batchId: r.batchId!,
      batchName: r.batchName ?? r.batchId!,
      profileId: r.profileId,
      profileName: r.profileName ?? "",
      mikrotikProfile: r.mikrotikProfile ?? sanitize(r.profileName ?? ""),
      total: r.total,
      available: r.available,
      sold: r.sold,
      createdAt: r.createdAt,
    }))
  );
});

// GET /vouchers/batches/:batchId — vouchers in a batch
router.get("/vouchers/batches/:batchId", async (req, res): Promise<void> => {
  const { batchId } = req.params;
  const rows = await db
    .select({
      id: vouchersTable.id,
      code: vouchersTable.code,
      profileId: vouchersTable.profileId,
      profileName: profilesTable.name,
      status: vouchersTable.status,
      batchId: vouchersTable.batchId,
      batchName: vouchersTable.batchName,
      createdAt: vouchersTable.createdAt,
      soldAt: vouchersTable.soldAt,
    })
    .from(vouchersTable)
    .leftJoin(profilesTable, eq(vouchersTable.profileId, profilesTable.id))
    .where(eq(vouchersTable.batchId, batchId))
    .orderBy(vouchersTable.code);

  res.json(
    rows.map((r) => ({
      ...r,
      profileName: r.profileName ?? "",
      soldAt: r.soldAt ?? null,
    }))
  );
});

// DELETE /vouchers/batches/:batchId — delete available vouchers in a batch
router.delete("/vouchers/batches/:batchId", async (req, res): Promise<void> => {
  const { batchId } = req.params;

  const existing = await db
    .select({ id: vouchersTable.id })
    .from(vouchersTable)
    .where(eq(vouchersTable.batchId, batchId));

  if (existing.length === 0) {
    res.status(404).json({ error: "Lot introuvable" });
    return;
  }

  const deletable = await db
    .select({ id: vouchersTable.id })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.batchId, batchId), eq(vouchersTable.status, "available")));

  if (deletable.length > 0) {
    await db
      .delete(vouchersTable)
      .where(inArray(vouchersTable.id, deletable.map((r) => r.id)));
  }

  res.json({ deleted: deletable.length });
});

// POST /vouchers/import — import MikHmon CSV
router.post("/vouchers/import", async (req, res): Promise<void> => {
  const body = ImportVouchersBody.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Corps invalide" });
    return;
  }

  const { profileId, csvContent, batchName } = body.data;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId));

  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }

  // Parse MikHmon CSV — handles tabs and commas, skips header row
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const codes: string[] = [];
  for (const line of lines) {
    // Skip typical header rows
    if (/^(name|username|user|code|ticket)/i.test(line)) continue;
    const sep = line.includes("\t") ? "\t" : ",";
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    // MikHmon format: Name, Password, Profile, Comment, ...
    // We take the first column (username/code) or second (password) if first looks like a header
    const code = cols[0];
    if (code && code.length >= 4) {
      codes.push(code.toUpperCase());
    }
  }

  if (codes.length === 0) {
    res.status(400).json({ error: "Aucun code valide trouvé dans le fichier CSV" });
    return;
  }

  const bId = generateBatchId();
  const bName =
    batchName ||
    `Import MikHmon — ${profile.name} — ${new Date().toLocaleDateString("fr-FR")}`;

  const inserted = await db
    .insert(vouchersTable)
    .values(
      codes.map((code) => ({
        code,
        profileId,
        profileName: profile.name,
        status: "available",
        batchId: bId,
        batchName: bName,
      }))
    )
    .onConflictDoNothing()
    .returning();

  res.status(201).json({
    count: inserted.length,
    vouchers: inserted.map((v) => ({
      ...v,
      profileName: profile.name,
      soldAt: v.soldAt ?? null,
    })),
  });
});

// GET /vouchers — list with optional filters
router.get("/vouchers", async (req, res): Promise<void> => {
  const params = GetVouchersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [];
  if (params.data.status) {
    conditions.push(eq(vouchersTable.status, params.data.status));
  }
  if (params.data.profileId) {
    conditions.push(eq(vouchersTable.profileId, params.data.profileId));
  }
  if (params.data.batchId) {
    conditions.push(eq(vouchersTable.batchId, params.data.batchId));
  }

  const rows = await db
    .select({
      id: vouchersTable.id,
      code: vouchersTable.code,
      profileId: vouchersTable.profileId,
      profileName: profilesTable.name,
      status: vouchersTable.status,
      batchId: vouchersTable.batchId,
      batchName: vouchersTable.batchName,
      createdAt: vouchersTable.createdAt,
      soldAt: vouchersTable.soldAt,
    })
    .from(vouchersTable)
    .leftJoin(profilesTable, eq(vouchersTable.profileId, profilesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(vouchersTable.createdAt);

  const vouchers = rows.map((r) => ({
    ...r,
    profileName: r.profileName ?? "",
    soldAt: r.soldAt ?? null,
  }));
  res.json(GetVouchersResponse.parse(vouchers));
});

// POST /vouchers/generate
router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVouchersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { profileId, quantity } = parsed.data;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId));

  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }

  const bId = generateBatchId();
  const bName = `Lot du ${new Date().toLocaleDateString("fr-FR")} — ${profile.name} — ${quantity} codes`;

  const codes = Array.from({ length: quantity }, () => generateCode());
  const inserted = await db
    .insert(vouchersTable)
    .values(
      codes.map((code) => ({
        code,
        profileId,
        profileName: profile.name,
        status: "available",
        batchId: bId,
        batchName: bName,
      }))
    )
    .returning();

  const vouchers = inserted.map((v) => ({
    ...v,
    profileName: profile.name,
    soldAt: v.soldAt ?? null,
  }));

  res.status(201).json({ count: vouchers.length, vouchers });
});

// DELETE /vouchers/:id
router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const params = DeleteVoucherParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [voucher] = await db
    .select()
    .from(vouchersTable)
    .where(eq(vouchersTable.id, params.data.id));

  if (!voucher) {
    res.status(404).json({ error: "Voucher introuvable" });
    return;
  }
  await db.delete(vouchersTable).where(eq(vouchersTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
