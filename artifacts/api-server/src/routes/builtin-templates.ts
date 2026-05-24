import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db, builtinTicketTemplatesTable } from "@workspace/db";
import { verifyAdminTokenFull } from "../lib/admin-auth.js";
import { requireSuperAdminScope } from "../lib/tenant.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * Slugs « factory » embarqués côté client (fichiers `ticket-templates/*.php.txt`).
 * Une ligne en base avec ces slugs surcharge le default — la suppression est interdite
 * (sinon l'option disparaîtrait des comptes existants); pour revenir au factory, le super
 * admin doit supprimer l'entrée DB, ce qui restaure le contenu embarqué.
 */
const FACTORY_SLUGS = new Set(["mikhmon-small", "nanotech-normal", "nanotech-small"]);

/** Identifiant réservé : valeur enregistrée en `admin_settings` pour un modèle personnalisé. */
const RESERVED_SLUG = "custom";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/;
const MAX_BODY_BYTES = 256 * 1024; // 256 Ko — largement suffisant pour un template PHP.
const MAX_LABEL_LENGTH = 80;

function sanitizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!SLUG_PATTERN.test(trimmed)) return null;
  if (trimmed === RESERVED_SLUG) return null;
  return trimmed;
}

function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) return null;
  return trimmed;
}

function sanitizeBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0) return null;
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
  return raw;
}

function sanitizeSortOrder(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

function publicRow(row: typeof builtinTicketTemplatesTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    body: row.body,
    sortOrder: row.sortOrder,
    isFactorySlug: FACTORY_SLUGS.has(row.slug),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /api/builtin-templates — liste publique des modèles intégrés, accessible à tout
 * compte administrateur authentifié (les managers/collaborateurs n'éditent pas le modèle,
 * ils impriment via le template enregistré sur leur admin propriétaire).
 */
router.get("/builtin-templates", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(builtinTicketTemplatesTable)
      .orderBy(asc(builtinTicketTemplatesTable.sortOrder), asc(builtinTicketTemplatesTable.id));
    res.json({ templates: rows.map(publicRow) });
  } catch (err) {
    logger.error({ err }, "GET /builtin-templates failed");
    res.status(500).json({ error: "Lecture impossible" });
  }
});

/**
 * POST /api/super/builtin-templates — body: { slug, label, body, sortOrder? }
 * Si `slug` existe déjà, met à jour (équivalent UPSERT) — utile pour ré-importer un fichier.
 */
router.post("/super/builtin-templates", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const slug = sanitizeSlug((req.body as { slug?: unknown })?.slug);
  if (!slug) {
    res.status(400).json({
      error:
        "Slug invalide (minuscules, chiffres, '-' ou '_'; 1–64 caractères; mots réservés interdits).",
    });
    return;
  }

  const label = sanitizeLabel((req.body as { label?: unknown })?.label);
  if (!label) {
    res.status(400).json({ error: `Label requis (1–${MAX_LABEL_LENGTH} caractères).` });
    return;
  }

  const body = sanitizeBody((req.body as { body?: unknown })?.body);
  if (!body) {
    res.status(400).json({ error: `Corps requis (max ${MAX_BODY_BYTES / 1024} Ko).` });
    return;
  }

  const sortOrder = sanitizeSortOrder((req.body as { sortOrder?: unknown })?.sortOrder) ?? 0;

  try {
    const [row] = await db
      .insert(builtinTicketTemplatesTable)
      .values({ slug, label, body, sortOrder })
      .onConflictDoUpdate({
        target: builtinTicketTemplatesTable.slug,
        set: { label, body, sortOrder, updatedAt: new Date() },
      })
      .returning();
    res.status(201).json(publicRow(row));
  } catch (err) {
    logger.error({ err, slug }, "POST /super/builtin-templates failed");
    res.status(500).json({ error: "Enregistrement impossible" });
  }
});

/**
 * PATCH /api/super/builtin-templates/:id — body: { label?, body?, sortOrder? }
 * Le slug est immuable (les comptes l'utilisent comme preset_id en base).
 */
router.patch("/super/builtin-templates/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }

  const patch: { label?: string; body?: string; sortOrder?: number } = {};
  const labelRaw = (req.body as { label?: unknown })?.label;
  if (labelRaw !== undefined) {
    const label = sanitizeLabel(labelRaw);
    if (!label) {
      res.status(400).json({ error: `Label invalide (1–${MAX_LABEL_LENGTH} caractères).` });
      return;
    }
    patch.label = label;
  }

  const bodyRaw = (req.body as { body?: unknown })?.body;
  if (bodyRaw !== undefined) {
    const body = sanitizeBody(bodyRaw);
    if (!body) {
      res.status(400).json({ error: `Corps invalide (max ${MAX_BODY_BYTES / 1024} Ko).` });
      return;
    }
    patch.body = body;
  }

  const sortOrderRaw = (req.body as { sortOrder?: unknown })?.sortOrder;
  if (sortOrderRaw !== undefined) {
    const v = sanitizeSortOrder(sortOrderRaw);
    if (v === null) {
      res.status(400).json({ error: "sortOrder invalide" });
      return;
    }
    patch.sortOrder = v;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour" });
    return;
  }

  try {
    const [row] = await db
      .update(builtinTicketTemplatesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(builtinTicketTemplatesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Modèle introuvable" });
      return;
    }
    res.json(publicRow(row));
  } catch (err) {
    logger.error({ err, id }, "PATCH /super/builtin-templates failed");
    res.status(500).json({ error: "Mise à jour impossible" });
  }
});

/**
 * DELETE /api/super/builtin-templates/:id — supprime une entrée de la liste partagée.
 *
 * - Pour les 3 slugs « factory », la suppression supprime simplement la surcharge en base ;
 *   le contenu embarqué côté client redevient le default.
 * - Pour les slugs ajoutés par le super-admin, le menu déroulant les retire chez tout le monde.
 *   Les comptes qui avaient déjà sauvegardé ce slug conservent leur copie locale en
 *   `admin_settings.ticket_template` (le corps est déjà persisté) — ils ne perdent rien à
 *   l'impression, seul le nom dans le menu peut basculer en « Personnalisé ».
 */
router.delete("/super/builtin-templates/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }

  try {
    const [row] = await db
      .delete(builtinTicketTemplatesTable)
      .where(eq(builtinTicketTemplatesTable.id, id))
      .returning({ id: builtinTicketTemplatesTable.id, slug: builtinTicketTemplatesTable.slug });
    if (!row) {
      res.status(404).json({ error: "Modèle introuvable" });
      return;
    }
    res.json({ ok: true, deletedId: row.id, slug: row.slug });
  } catch (err) {
    logger.error({ err, id }, "DELETE /super/builtin-templates failed");
    res.status(500).json({ error: "Suppression impossible" });
  }
});

/** Liste des slugs « factory » embarqués côté client — utilitaire si nécessaire. */
export const BUILTIN_FACTORY_SLUGS: ReadonlySet<string> = FACTORY_SLUGS;

export default router;
