import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, vouchersTable, profilesTable } from "@workspace/db";
import {
  GenerateVouchersBody,
  GetVouchersQueryParams,
  DeleteVoucherParams,
  GetVouchersResponse,
} from "@workspace/api-zod";
import { randomBytes } from "crypto";

const router: IRouter = Router();

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

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

  const rows = await db
    .select({
      id: vouchersTable.id,
      code: vouchersTable.code,
      profileId: vouchersTable.profileId,
      profileName: profilesTable.name,
      status: vouchersTable.status,
      createdAt: vouchersTable.createdAt,
      soldAt: vouchersTable.soldAt,
    })
    .from(vouchersTable)
    .leftJoin(profilesTable, eq(vouchersTable.profileId, profilesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(vouchersTable.createdAt);

  const vouchers = rows.map((r) => ({ ...r, profileName: r.profileName ?? "" }));
  res.json(GetVouchersResponse.parse(vouchers));
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVouchersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { profileId, quantity } = parsed.data;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, profileId));
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }

  const codes = Array.from({ length: quantity }, () => generateCode());
  const inserted = await db
    .insert(vouchersTable)
    .values(codes.map((code) => ({ code, profileId, status: "available" })))
    .returning();

  const vouchers = inserted.map((v) => ({
    ...v,
    profileName: profile.name,
    soldAt: v.soldAt ?? null,
  }));

  res.status(201).json({ count: vouchers.length, vouchers });
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const params = DeleteVoucherParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [voucher] = await db.select().from(vouchersTable).where(eq(vouchersTable.id, params.data.id));
  if (!voucher) {
    res.status(404).json({ error: "Voucher introuvable" });
    return;
  }
  await db.delete(vouchersTable).where(eq(vouchersTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
