import bodyMikhmonSmall from "./ticket-templates/mikhmon-small.php.txt?raw";
import bodyNanotechNormal from "./ticket-templates/nanotech-normal.php.txt?raw";
import bodyNanotechSmall from "./ticket-templates/nanotech-small.php.txt?raw";

/**
 * Slug identifiant un modèle « intégré ».
 *
 * - Trois slugs sont historiquement embarqués dans le bundle (`mikhmon-small`,
 *   `nanotech-normal`, `nanotech-small`).
 * - Le super-admin peut ajouter d'autres slugs via la table `builtin_ticket_templates` —
 *   ces nouveaux slugs sont injectés au runtime via `setServerTicketTemplates()`.
 *
 * Le type reste un simple `string` pour autoriser les slugs dynamiques (créés par le
 * super-admin) sans bouger le typage de chaque page consommatrice.
 */
export type TicketTemplatePresetId = string;

/** Modèle choisi en UI / en base (intégré ou personnalisé). */
export type TicketTemplateSelectionId = TicketTemplatePresetId | "custom";

export const DEFAULT_TICKET_PRESET_ID: TicketTemplatePresetId = "mikhmon-small";

/** Dernier modèle prédéfini choisi (utilisé quand le serveur n’a pas encore de modèle). */
export const TICKET_PRESET_STORAGE_KEY = "vouchernet_ticket_template_preset_v1";

/** Slugs « factory » embarqués dans le bundle (ne disparaissent jamais du menu). */
export const FACTORY_TICKET_PRESET_IDS = ["mikhmon-small", "nanotech-normal", "nanotech-small"] as const;
type FactoryPresetId = (typeof FACTORY_TICKET_PRESET_IDS)[number];

const FACTORY_BODIES: Record<FactoryPresetId, string> = {
  "mikhmon-small": bodyMikhmonSmall,
  "nanotech-normal": bodyNanotechNormal,
  "nanotech-small": bodyNanotechSmall,
};

const FACTORY_LABELS: Record<FactoryPresetId, string> = {
  "mikhmon-small": "Mikhmon (small)",
  "nanotech-normal": "nanoTECH (normal)",
  "nanotech-small": "nanoTECH (small)",
};

const FACTORY_SLUG_SET: ReadonlySet<string> = new Set<string>(FACTORY_TICKET_PRESET_IDS);

export type TicketTemplatePreset = {
  id: TicketTemplatePresetId;
  label: string;
  isFactorySlug: boolean;
  /** True si la ligne provient de la base (gérée par le super-admin). */
  isManaged: boolean;
  /** ID de la ligne en base (null si seulement embarqué). */
  serverId: number | null;
  /** Ordre d'affichage (`sort_order` côté serveur, sinon position du factory). */
  sortOrder: number;
};

export type ServerBuiltinTemplate = {
  id: number;
  slug: string;
  label: string;
  body: string;
  sortOrder: number;
  isFactorySlug: boolean;
};

/** Registre des modèles serveur — injecté par le client après fetch (`/api/builtin-templates`). */
const serverTemplates = new Map<string, ServerBuiltinTemplate>();
let serverTemplatesLoaded = false;

const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const fn of Array.from(subscribers)) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** S'abonne aux changements de la liste de modèles intégrés (poussés par `setServerTicketTemplates`). */
export function subscribeServerTicketTemplates(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Remplace l'ensemble des modèles serveur connus (appelé après chaque fetch /import / suppression). */
export function setServerTicketTemplates(rows: ServerBuiltinTemplate[]): void {
  serverTemplates.clear();
  for (const r of rows) {
    if (typeof r.slug !== "string" || !r.slug) continue;
    serverTemplates.set(r.slug, r);
  }
  serverTemplatesLoaded = true;
  notifySubscribers();
}

export function areServerTicketTemplatesLoaded(): boolean {
  return serverTemplatesLoaded;
}

/** Renvoie un instantané ordonné des modèles serveur (pour affichage UI). */
export function getServerTicketTemplatesSnapshot(): ServerBuiltinTemplate[] {
  return Array.from(serverTemplates.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  );
}

/** Liste effective des modèles intégrés (factory ∪ serveur), triée pour l'UI. */
export function getEffectiveTicketTemplatePresets(): TicketTemplatePreset[] {
  const out: TicketTemplatePreset[] = [];
  const seen = new Set<string>();

  for (const [idx, slug] of FACTORY_TICKET_PRESET_IDS.entries()) {
    const override = serverTemplates.get(slug);
    out.push({
      id: slug,
      label: override?.label ?? FACTORY_LABELS[slug],
      isFactorySlug: true,
      isManaged: override != null,
      serverId: override?.id ?? null,
      sortOrder: override?.sortOrder ?? idx,
    });
    seen.add(slug);
  }

  for (const t of serverTemplates.values()) {
    if (seen.has(t.slug)) continue;
    out.push({
      id: t.slug,
      label: t.label,
      isFactorySlug: false,
      isManaged: true,
      serverId: t.id,
      sortOrder: t.sortOrder,
    });
    seen.add(t.slug);
  }

  return out.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
  });
}

export function getPresetBody(id: TicketTemplatePresetId): string {
  const serverHit = serverTemplates.get(id);
  if (serverHit) return serverHit.body;
  if (id in FACTORY_BODIES) return FACTORY_BODIES[id as FactoryPresetId];
  return FACTORY_BODIES[DEFAULT_TICKET_PRESET_ID as FactoryPresetId];
}

/** True si le slug correspond à un modèle actuellement intégré (factory ou en base). */
export function isKnownPresetId(id: string): boolean {
  return FACTORY_SLUG_SET.has(id) || serverTemplates.has(id);
}

export function getStoredTicketPresetId(): TicketTemplateSelectionId {
  try {
    const v = localStorage.getItem(TICKET_PRESET_STORAGE_KEY);
    if (v === "custom") return "custom";
    if (typeof v === "string" && v.length > 0 && isKnownPresetId(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_TICKET_PRESET_ID;
}

export function setStoredTicketPresetId(id: TicketTemplateSelectionId): void {
  try {
    localStorage.setItem(TICKET_PRESET_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Normalise le texte avant comparaison (éditeur CodeMirror : fins de ligne, newline finale).
 * On conserve les espaces / tabulations en tête et en fin de ligne du gabarit d’origine.
 */
export function normalizeTicketTemplateForCompare(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/g, "");
}

/**
 * Empreinte pour comparer au gabarit embarqué : écarts fréquents entre fichier
 * bundle, API / MySQL et éditeur (indentation avant `<?php` ou `<table`, fin de fichier).
 */
function fingerprintForPresetMatch(source: string): string {
  return normalizeTicketTemplateForCompare(source)
    .replace(/^[ \t\r\f\v]+/, "")
    .trimEnd();
}

/** Interprète la colonne serveur `ticket_template_preset` (slug libre + "custom"). */
export function parseServerTicketTemplatePresetId(raw: unknown): TicketTemplateSelectionId | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw === "custom") return "custom";
  if (!/^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/.test(raw)) return null;
  return raw;
}

/**
 * Choix de modèle affiché : la valeur en base l’emporte ; sinon déduction depuis le contenu ;
 * si contenu vide, repli sur le dernier choix local (legacy).
 *
 * Si le slug stocké en base correspond à un modèle disparu (super-admin l'a supprimé),
 * on tente de re-fingerprinter le corps pour retomber sur un slug connu ; sinon "custom".
 */
export function resolveTicketTemplateSelection(args: {
  templateBody: string;
  serverPresetId: unknown;
  /** Super-admin éditant un autre compte : ne pas mélanger avec le localStorage du navigateur. */
  skipLocalFallback?: boolean;
}): TicketTemplateSelectionId {
  const fromDb = parseServerTicketTemplatePresetId(args.serverPresetId);
  if (fromDb != null) {
    if (fromDb === "custom" || isKnownPresetId(fromDb)) return fromDb;
    // Slug supprimé entre-temps — tenter une déduction par contenu.
    if (args.templateBody.trim()) return findMatchingPresetId(args.templateBody);
    return args.skipLocalFallback ? DEFAULT_TICKET_PRESET_ID : getStoredTicketPresetId();
  }

  const trimmed = args.templateBody.trim();
  if (!trimmed) {
    return args.skipLocalFallback ? DEFAULT_TICKET_PRESET_ID : getStoredTicketPresetId();
  }
  return findMatchingPresetId(args.templateBody);
}

/** Corps à enregistrer / afficher selon le preset et le HTML serveur. */
export function resolveTicketTemplateDisplayBody(
  templateBody: string,
  presetId: TicketTemplateSelectionId,
): string {
  const trimmed = templateBody.trim();
  if (trimmed) return templateBody;
  if (presetId !== "custom") return getPresetBody(presetId);
  return "";
}

/** Repère si le contenu correspond à un des modèles connus (factory + serveur). */
export function findMatchingPresetId(code: string): TicketTemplatePresetId | "custom" {
  const t = fingerprintForPresetMatch(code);
  for (const slug of FACTORY_TICKET_PRESET_IDS) {
    if (fingerprintForPresetMatch(FACTORY_BODIES[slug]) === t) return slug;
  }
  for (const tpl of serverTemplates.values()) {
    if (fingerprintForPresetMatch(tpl.body) === t) return tpl.slug;
  }
  return "custom";
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Récupère les modèles intégrés depuis le serveur et met à jour le registre interne.
 * Idempotent — peut être appelé à chaque montage du composant `TicketTemplateEditor`.
 */
export async function fetchAndApplyServerTicketTemplates(
  authHeaders: Record<string, string>,
): Promise<ServerBuiltinTemplate[]> {
  try {
    const r = await fetch(`${BASE}/api/builtin-templates`, { headers: authHeaders });
    if (!r.ok) return getServerTicketTemplatesSnapshot();
    const data = (await r.json()) as { templates?: ServerBuiltinTemplate[] };
    const rows = Array.isArray(data.templates) ? data.templates : [];
    setServerTicketTemplates(rows);
    return rows;
  } catch {
    return getServerTicketTemplatesSnapshot();
  }
}
