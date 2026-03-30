import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import {
  CreateProfileBody,
  UpdateProfileBody,
  GetProfileParams,
  UpdateProfileParams,
  GetProfilesResponse,
  GetProfileResponse,
  UpdateProfileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/profiles", async (_req, res): Promise<void> => {
  const profiles = await db.select().from(profilesTable).orderBy(profilesTable.createdAt);
  res.json(GetProfilesResponse.parse(profiles));
});

router.post("/profiles", async (req, res): Promise<void> => {
  const parsed = CreateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db.insert(profilesTable).values(parsed.data).returning();
  res.status(201).json(GetProfileResponse.parse(profile));
});

router.get("/profiles/:id", async (req, res): Promise<void> => {
  const params = GetProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, params.data.id));
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  res.json(GetProfileResponse.parse(profile));
});

router.patch("/profiles/:id", async (req, res): Promise<void> => {
  const params = UpdateProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db
    .update(profilesTable)
    .set(parsed.data)
    .where(eq(profilesTable.id, params.data.id))
    .returning();
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  res.json(UpdateProfileResponse.parse(profile));
});

router.delete("/profiles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }
  const [profile] = await db.delete(profilesTable).where(eq(profilesTable.id, id)).returning();
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }
  res.sendStatus(204);
});

export default router;
