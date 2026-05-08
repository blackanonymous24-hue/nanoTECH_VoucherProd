import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, RotateCcw, Save, Eye, Code2, Upload, BookMarked, Sliders, LayoutGrid } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
const COLS_DESKTOP_KEY  = "vn_print_cols_desktop";
export const SMALL_SCALE_KEY = "vn_small_scale";

function readCols(key: string, def = 4): number {
  try { const v = parseInt(localStorage.getItem(key) ?? String(def), 10); return isNaN(v) ? def : v; } catch { return def; }
}
function saveCols(key: string, v: number) { try { localStorage.setItem(key, String(v)); } catch {} }

export function readSmallScale(): number {
  try { const v = parseFloat(localStorage.getItem(SMALL_SCALE_KEY) ?? "0.85"); return isNaN(v) ? 0.85 : v; } catch { return 0.85; }
}
function saveSmallScale(v: number) { try { localStorage.setItem(SMALL_SCALE_KEY, String(v)); } catch {} }

const TEMPLATE_KEY = "voucher-ticket-template";

// ─── Template par défaut — reproduction fidèle du PHP fourni ─────────────────
// Variables : {{hotspotname}} {{dnsname}} {{color}} {{price}} {{currency}}
//             {{codeblock}} {{validity}} {{timelimit}} {{datalimit}}
//             {{qrcode}} {{num}}
// {{codeblock}} est pré-calculé selon le mode (Voucher ou Compte) avant rendu.
export const DEFAULT_TEMPLATE = `<!--mks-mulai--><div style="display:inline-block;width:135px;overflow:hidden;position:relative;">
<table style="border-collapse:collapse;border:1px solid #444;margin:0px;width:135px;padding:1px;font-family:Arial,sans-serif;vertical-align:top;">
<tbody>
<tr>
<td style="background:{{color}};color:#676;padding:0px;" valign="top" colspan="2">
<div style="text-align:center;color:#fff;font-size:8px;font-weight:bold;margin:1px;padding:2.5px;">
<b>{{hotspotname}}</b>
</div>
</td>
</tr>
<tr>
<td style="color:#666;" valign="top">
<table style="width:100%;">
<tbody>
<tr>
<td style="width:35px;">
<div style="position:relative;z-index:-1;padding:0px;">
<div style="position:absolute;top:0;display:inline;margin-top:-100px;width:0;height:0;border-top:170px solid transparent;border-left:30px solid transparent;border-right:170px solid #DCDCDC;"></div>
</div>
</td>
<td style="width:30px;">
<div style="margin:-10px;text-align:right;font-weight:bold;font-size:10px;padding-left:18px;color:{{color}};"><small style="font-size:10px;margin-left:-65px;position:absolute;">{{price}} {{currency}}</small>
</div>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
<tr>
<td style="color:#666;border-collapse:collapse;" valign="top">
<table style="width:100%;border-collapse:collapse;">
<tbody>
<tr>
<td style="width:80px;" valign="top">
<div style="clear:both;color:#555;margin-top:-7px;margin-bottom:2.5px;">
{{codeblock}}
</div>
<div style="text-align:center;color:#111;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
Veuillez conserver ce ticket jusqu'à l'épuisement du forfait.
</div>
</td>
<td style="width:120px;text-align:right;" valign="top">
<div style="clear:both;padding:0 2.5px;font-size:7px;font-weight:bold;color:#000000;">
{{validity}}<br>{{timelimit}}<br>{{datalimit}}
</div>
<img style="border:1px {{color}} solid;border-radius:3px;width:32px;height:32px;display:inline-block;margin:0 1px -5px 0;vertical-align:bottom;" src="{{qrcode}}" alt="QR" />
</td>
</tr>
<tr>
<td style="background:{{color}};color:#666;padding:0px;" valign="top" colspan="2">
<div style="display:table;width:100%;color:#fff;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
<b style="display:table-cell;text-align:left;">{{dnsname}}</b><span style="display:table-cell;text-align:right;white-space:nowrap;">[{{num}}]</span>
</div>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
</tbody>
</table>
</div><!--mks-akhir-->`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function applyVars(tpl: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    tpl
  );
}

export function getStoredTemplate(): string {
  try { return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; }
}

// ─── Parseur PHP → Template HTML ──────────────────────────────────────────────
// Convertit un fichier template PHP de MikHmon en template {{variable}}.
// Supporte template.php, template-small.php et template-thermal.php.
export function parsePHPTemplate(raw: string): string {
  let s = raw;

  // 1. Extraire uniquement la section entre les marqueurs MikHmon
  const mStart = s.indexOf("<!--mks-mulai-->");
  const mEnd   = s.indexOf("<!--mks-akhir-->");
  if (mStart !== -1 && mEnd !== -1) {
    s = s.slice(mStart, mEnd + "<!--mks-akhir-->".length);
  }

  // 2. Remplacer le bloc conditionnel usermode (vc/up) par {{codeblock}}
  //    Pattern: <?php if($usermode == "vc"){?> ... <?php }elseif($usermode == "up"){?> ... <?php }?>
  s = s.replace(
    /<\?php[^?]*if\s*\(\s*\$usermode\s*==\s*["']vc["']\s*\)\s*\{[^?]*\?>([\s\S]*?)<\?php[^?]*\}(?:else\s*if|elseif)\s*\(\s*\$usermode\s*==\s*["']up["']\s*\)\s*\{[^?]*\?>([\s\S]*?)<\?php[^?]*\}\s*\?>/,
    "{{codeblock}}"
  );
  s = s.replace(/<!--mks-voucher-akhir-->/g, "");

  // 3. Remplacer <?= $qrcode ?> par un img avec src="{{qrcode}}"
  //    Dans le PHP original, $qrcode est un bloc <canvas> — on le remplace par un <img>
  s = s.replace(/<img([^>]*)>\s*<\?=\s*\$qrcode\s*\?>/g, '<img$1 src="{{qrcode}}">');
  s = s.replace(/<\?=\s*\$qrcode\s*\?>/g, '<img src="{{qrcode}}" style="width:32px;height:32px;" alt="QR">');
  s = s.replace(/<\?php\s+echo\s+\$qrcode\s*;?\s*\?>/g, '<img src="{{qrcode}}" style="width:32px;height:32px;" alt="QR">');

  // 4. Correspondances PHP var → template var (ordre important : getprice avant price)
  const varMap: [string, string][] = [
    ["hotspotname", "hotspotname"],
    ["dnsname",     "dnsname"],
    ["getprice",    "price"],
    ["getsprice",   "price"],
    ["currency",    "currency"],
    ["username",    "username"],
    ["password",    "password"],
    ["validity",    "validity"],
    ["timelimit",   "timelimit"],
    ["datalimit",   "datalimit"],
    ["num",         "num"],
    ["profile",     "profile"],
    ["comment",     "comment"],
    ["color",       "color"],
    ["logo",        "logo"],
    ["price",       "price"],
  ];

  // Helper : substituer les variables PHP dans une expression
  const subVars = (expr: string): string => {
    let r = expr.trim().replace(/;$/, "").trim();
    for (const [pv, tv] of varMap) {
      r = r.replace(new RegExp(`\\$${pv}\\b`, "g"), `{{${tv}}}`);
    }
    return r;
  };

  // 5. <?= expr ?> → évaluer et substituer
  s = s.replace(/<\?=([\s\S]*?)\?>/g, (_, inner) => {
    let r = subVars(inner);
    // Concaténation PHP : "User: ".$username."<br>Pass: ".$password → User: {{username}}<br>Pass: {{password}}
    r = r.replace(/"([^"]*)"\s*\.\s*/g, "$1").replace(/\.\s*"([^"]*)"/g, "$1");
    r = r.replace(/^["']|["']$/g, "");
    // " [$num]" → [{{num}}]
    r = r.replace(/"([^"]*)"/g, "$1");
    r = r.replace(/^'|'$/g, "");
    return r.trim();
  });

  // 6. <?php echo expr; ?> → substituer
  s = s.replace(/<\?php\s+echo\s+([\s\S]*?);?\s*\?>/g, (_, inner) => {
    let r = subVars(inner);
    r = r.replace(/"([^"]*)"\s*\.\s*/g, "$1").replace(/\.\s*"([^"]*)"/g, "$1");
    r = r.replace(/^["']|["']$/g, "").replace(/"([^"]*)"/g, "$1");
    return r.trim();
  });

  // 7. Remplacer les $var restants (dans les attributs style inline etc.)
  for (const [pv, tv] of varMap) {
    s = s.replace(new RegExp(`\\$${pv}\\b`, "g"), `{{${tv}}}`);
  }

  // 8. Supprimer les blocs PHP de logique restants (<?php ... ?> et <?= ... ?>)
  s = s.replace(/<\?php[\s\S]*?\?>/g, "");
  s = s.replace(/<\?[\s\S]*?\?>/g, "");

  // 9. Nettoyage final
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ─── Helpers PHP mode ──────────────────────────────────────────────────────────

export const PHP_KEY = "voucher-ticket-php";
export const CUSTOM_DEFAULT_KEY = "voucher-ticket-custom-default";

export function getCustomDefault(): string | null {
  try { return localStorage.getItem(CUSTOM_DEFAULT_KEY); } catch { return null; }
}

export function getStoredPHP(): string {
  try { return localStorage.getItem(PHP_KEY) ?? getCustomDefault() ?? DEFAULT_MIKHMON_PHP; } catch { return DEFAULT_MIKHMON_PHP; }
}


/**
 * Charge le template depuis le serveur (source de vérité cross-device).
 * Met à jour le cache localStorage si un template serveur existe.
 * Fallback : localStorage → DEFAULT_MIKHMON_PHP.
 * Appelé avant chaque impression et au montage de la page Template.
 */
const _TOKEN_KEY = "vouchernet_admin_token";
function _readAuthToken(): string | null {
  try { return localStorage.getItem(_TOKEN_KEY) ?? sessionStorage.getItem(_TOKEN_KEY); } catch { return null; }
}

export type ServerTemplateResult = {
  template: string;
  /**
   * true  → aucun template enregistré nulle part (DB ni localStorage)
   *          → DEFAULT_MIKHMON_PHP utilisé en dernier recours → layout 4×9 mobile.
   * false → template explicitement enregistré (DB ou cache localStorage)
   *          → ne JAMAIS appliquer le layout 4×9, même contenu similaire au modèle.
   */
  isDefault: boolean;
};

// ── Cache mémoire — évite un aller-retour réseau à chaque clic Imprimer ────────
let _templateCache: { result: ServerTemplateResult; expiresAt: number } | null = null;
const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Invalide le cache (à appeler après toute modification du template). */
export function invalidateTemplateCache(): void {
  _templateCache = null;
}

/**
 * Charge le template avec métadonnée isDefault pour choisir le layout mobile.
 * Priorité : cache mémoire (5 min) → serveur DB → cache localStorage → DEFAULT_MIKHMON_PHP.
 */
export async function fetchServerTemplateWithMeta(): Promise<ServerTemplateResult> {
  if (_templateCache && Date.now() < _templateCache.expiresAt) {
    return _templateCache.result;
  }

  const _cache = (result: ServerTemplateResult): ServerTemplateResult => {
    _templateCache = { result, expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS };
    return result;
  };

  try {
    const token = _readAuthToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetch(`${BASE}/api/tenant/ticket-template`, { headers });
    if (r.ok) {
      const data = (await r.json()) as { template: string | null };
      if (data.template && data.template.trim().length > 0) {
        try { localStorage.setItem(PHP_KEY, data.template); } catch {}
        return _cache({ template: data.template, isDefault: false });
      }
      // Serveur joignable, aucun template en DB — vérifier localStorage
    }
  } catch { /* réseau indisponible — utiliser cache local */ }

  const cached = (() => {
    try { return localStorage.getItem(PHP_KEY) ?? getCustomDefault(); } catch { return null; }
  })();
  if (cached && cached.trim().length > 0) {
    return _cache({ template: cached, isDefault: false });
  }

  // Dernier recours : DEFAULT_MIKHMON_PHP (rien enregistré nulle part)
  return _cache({ template: DEFAULT_MIKHMON_PHP, isDefault: true });
}

/**
 * Compatibilité pour les appelants qui n'ont besoin que de la chaîne template.
 * Pour les impressions, utiliser fetchServerTemplateWithMeta().
 */
export async function fetchServerTemplate(): Promise<string> {
  return (await fetchServerTemplateWithMeta()).template;
}

export function isPHPMode(): boolean {
  return true;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CODEBLOCK_VC = (color: string, username: string) =>
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>` +
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">${username}</div>`;

const SAMPLE_COLOR = "#ECA352";
const SAMPLE_USERNAME = "abc12345";

const SAMPLE_VARS: Record<string, string> = {
  hotspotname: "MON HOTSPOT WIFI",
  dnsname: "Tel: +225 XX XXX XXXX",
  username: SAMPLE_USERNAME,
  password: SAMPLE_USERNAME,
  price: "500",
  currency: "FCFA",
  validity: "Validité : 1 Jour(s)",
  timelimit: "6h",
  datalimit: "",
  num: "1",
  profile: "default",
  color: SAMPLE_COLOR,
  codeblock: CODEBLOCK_VC(SAMPLE_COLOR, SAMPLE_USERNAME),
  qrcode: `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${SAMPLE_USERNAME}&margin=2`,
};

const SAMPLE_VARS_2: Record<string, string> = {
  ...SAMPLE_VARS,
  username: "xyz67890",
  password: "pass9999",
  price: "1000",
  color: "#F75418",
  num: "2",
  validity: "1d",
  codeblock:
    `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:#444;">Compte Utilisateur</div>` +
    `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:#F75418;">User: xyz67890<br>Pass: pass9999</div>`,
  qrcode: `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=xyz67890&margin=2`,
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const DEFAULT_MIKHMON_PHP = `<table class="voucher" style=" width: 160px;">
  <tbody>
    <tr>
      <td style="font-size: 14px; font-weight:bold; border-bottom: 1px black solid; overflow:hidden;"><span id="num" style="float:right;margin-left:4px;"><?= " [$num]"; ?></span><?= $hotspotname; ?></td>
    </tr>
    <tr>
      <td>
    <table style=" text-align: center; width: 150px;">
  <tbody>
    <tr style="color: black; font-size: 11px;">
      <td>
        <table style="width:100%;">
<!-- Username = Password    -->
<?php if ($usermode == "vc") { ?>
        <tr>
          <td >Kode Voucher</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="width:100%; border: 1px solid black; font-weight:bold;"><?= $username; ?></td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;"><?= $validity; ?> <?= $timelimit; ?> <?= $datalimit; ?> <?= $price; ?></td>
        </tr>
<!-- /  -->
<!-- Username & Password  -->
<?php 
} elseif ($usermode == "up") { ?>
          <tr>
          <td style="width: 50%">Username</td>
          <td>Password</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="border: 1px solid black; font-weight:bold;"><?= $username; ?></td>
          <td style="border: 1px solid black; font-weight:bold;"><?= $password; ?></td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;"><?= $validity; ?> <?= $timelimit; ?> <?= $datalimit; ?> <?= $price; ?></td>
        </tr>
<?php 
} ?>
<!-- /  -->
        </table>
      </td>
    </tr>
  </tbody>
    </table>
      </td>
    </tr>
  </tbody>
</table>`;

export default function TicketTemplate() {
  const { role } = useAuth();
  const isManager = role === "manager";
  const { toast } = useToast();

  // ── Contenu PHP brut — initialisé depuis le cache local, puis mis à jour depuis le serveur
  const [phpCode, setPhpCode] = useState<string>(() => getStoredPHP());

  // Chargement depuis le serveur au montage (source de vérité cross-device)
  useEffect(() => {
    fetchServerTemplate().then((tpl) => setPhpCode(tpl));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saved, setSaved] = useState(false);
  const [previewHtmls, setPreviewHtmls] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Paramètres d'impression (colonnes desktop)
  const [showScaleDialog,      setShowScaleDialog]      = useState(false);
  const [showSmallParamsDialog, setShowSmallParamsDialog] = useState(false);
  const [colsDesktop,  setColsDesktop]  = useState(() => readCols(COLS_DESKTOP_KEY, 4));
  const [smallScale,   setSmallScale]   = useState(() => readSmallScale());

  // Ajuste le défaut selon le type de template (MikHmon → 5, autre → 4)
  // uniquement si l'utilisateur n'a pas de préférence enregistrée
  useEffect(() => {
    if (localStorage.getItem(COLS_DESKTOP_KEY) === null) {
      setColsDesktop(phpCode.includes('class="voucher"') ? 5 : 4);
    }
  }, [phpCode]);

  // ── Importer un fichier .php (charge + sauvegarde locale et serveur immédiatement)
  const handleImportPHP = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      invalidateTemplateCache();
      try {
        localStorage.setItem(PHP_KEY, raw);
        localStorage.setItem(CUSTOM_DEFAULT_KEY, raw);
        localStorage.removeItem(TEMPLATE_KEY);
      } catch { /* ignore */ }
      setPhpCode(raw);
      setTab("code");
      // Sauvegarde serveur immédiate — pas besoin de cliquer "Sauvegarder" séparément
      let serverSynced = false;
      try {
        const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: raw }),
        });
        serverSynced = resp.ok;
      } catch {
        serverSynced = false;
      }
      if (serverSynced) {
        toast({
          title: "Fichier PHP importé et sauvegardé",
          description: `« ${file.name} » actif sur tous les appareils (APK inclus).`,
        });
      } else {
        toast({
          title: "Fichier PHP chargé",
          description: `« ${file.name} » chargé localement. Cliquez Sauvegarder pour synchroniser sur mobile.`,
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [toast]);

  // ── Sauvegarder — local + serveur (source de vérité cross-device)
  const handleSave = useCallback(async () => {
    invalidateTemplateCache();
    try {
      localStorage.setItem(PHP_KEY, phpCode);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, phpCode);
      localStorage.removeItem(TEMPLATE_KEY);
    } catch { /* ignore */ }
    // Sauvegarde serveur : synchronise mobile, APK et tous les appareils
    let serverSynced = false;
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: phpCode }),
      });
      serverSynced = resp.ok;
    } catch {
      serverSynced = false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    if (serverSynced) {
      toast({ title: "Modèle sauvegardé", description: "Synchronisé sur le serveur — l'APK mobile utilisera ce modèle." });
    } else {
      toast({
        title: "Modèle sauvegardé localement",
        description: "Le serveur n'a pas été synchronisé. Ce modèle reste le défaut sur cet appareil.",
        variant: "destructive",
      });
    }
  }, [phpCode, toast]);

  // ── Réinitialiser (vers le custom default s'il existe, sinon vers DEFAULT_MIKHMON_PHP)
  const handleReset = useCallback(() => {
    const base = getCustomDefault() ?? DEFAULT_MIKHMON_PHP;
    setPhpCode(base);
    try { localStorage.setItem(PHP_KEY, base); } catch { /* ignore */ }
    toast({ title: "Modèle réinitialisé", description: "Le modèle de base a été restauré." });
  }, [toast]);

  // ── Définir comme modèle de base (local + serveur)
  const handleSetAsDefault = useCallback(async () => {
    if (!phpCode.trim()) return;
    invalidateTemplateCache();
    try {
      localStorage.setItem(CUSTOM_DEFAULT_KEY, phpCode);
      localStorage.setItem(PHP_KEY, phpCode);
      localStorage.removeItem(TEMPLATE_KEY);
    } catch { /* ignore */ }
    // Synchronise sur le serveur pour que l'APK mobile l'utilise aussi
    let serverSynced = false;
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: phpCode }),
      });
      serverSynced = resp.ok;
    } catch {
      serverSynced = false;
    }
    if (serverSynced) {
      toast({ title: "Modèle de base défini", description: "Synchronisé sur le serveur — tous les appareils (APK, mobile) utiliseront ce modèle." });
    } else {
      toast({
        title: "Modèle de base défini localement",
        description: "Le serveur n'a pas été synchronisé. Ce modèle reste le défaut sur cet appareil uniquement.",
        variant: "destructive",
      });
    }
  }, [phpCode, toast]);

  const handleUseDefaultMikhmon = useCallback(() => {
    setTab("code");
    setPhpCode(DEFAULT_MIKHMON_PHP);
    toast({
      title: "Modèle Mikhmon chargé",
      description: "Le template PHP par défaut est prêt. Clique sur Sauvegarder pour l'activer.",
    });
  }, [toast]);

  // ── Aperçu PHP — appel serveur avec données d'exemple
  const handlePhpPreview = useCallback(async () => {
    if (!phpCode.trim()) return;
    setPreviewing(true);
    setTab("preview");
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          php: phpCode,
          vouchers: [SAMPLE_VARS, SAMPLE_VARS_2],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setPreviewHtmls(data.html as string[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Erreur de prévisualisation PHP", description: msg, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }, [phpCode, toast]);

  const hasSaved = (() => { try { return localStorage.getItem(PHP_KEY) !== null; } catch { return false; } })();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCode className="h-6 w-6 text-blue-500" />
            Modèle de ticket
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasSaved && !isManager && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50" title="Réinitialiser">
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Réinitialiser</span>
            </Button>
          )}
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleUseDefaultMikhmon} title="Coller modèle Mikhmon">
              <FileCode className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Coller modèle Mikhmon</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} title="Importer .php">
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Importer .php</span>
            </Button>
            <input ref={fileRef} type="file" accept=".php" className="hidden" onChange={handleImportPHP} />
            <Button variant="outline" size="sm" className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50" onClick={handleSetAsDefault} title="Définir comme modèle de base">
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Définir par défaut</span>
            </Button>
          </>
          <Button variant="outline" size="sm" className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50" onClick={() => setShowScaleDialog(true)} title="Paramètres d'impression (colonnes desktop)">
            <Sliders className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline text-[11px]">🖥 {colsDesktop} col</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50" onClick={() => setShowSmallParamsDialog(true)} title="Paramètres mode Small (échelle d'impression)">
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline text-[11px]">Small {Math.round(smallScale * 100)}%</span>
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saved} title={saved ? "Sauvegardé" : "Sauvegarder"}>
            <Save className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{saved ? "Sauvegardé ✓" : "Sauvegarder"}</span>
          </Button>
        </div>
      </div>

      <Dialog open={showScaleDialog} onOpenChange={setShowScaleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-purple-600" />
              Paramètres d'impression
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-gray-600">🖥 Colonnes desktop (mode normal)</span>
              <div className="flex gap-1.5">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n} type="button"
                    onClick={() => { setColsDesktop(n); saveCols(COLS_DESKTOP_KEY, n); }}
                    className={`flex-1 h-8 rounded text-sm font-bold border transition-colors ${colsDesktop === n ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:text-purple-600"}`}
                  >{n}</button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" />Enregistrer</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog dédié — Paramètres mode Small ── */}
      <Dialog open={showSmallParamsDialog} onOpenChange={setShowSmallParamsDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-violet-600" />
              Paramètres mode Small
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Échelle d'impression</span>
                <span className="text-lg font-bold text-violet-600 tabular-nums w-14 text-right">{Math.round(smallScale * 100)}%</span>
              </div>
              <p className="text-[11px] text-gray-400 leading-tight">
                Glissez la barre, utilisez la molette ou saisissez directement la valeur (0–100).
                Pré-sélectionnée dans la page Small à chaque impression.
              </p>
              {/* Slider */}
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round(smallScale * 100)}
                onChange={(e) => { const v = Number(e.target.value) / 100; setSmallScale(v); saveSmallScale(v); }}
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = e.deltaY < 0 ? 1 : -1;
                  const next = Math.min(100, Math.max(0, Math.round(smallScale * 100) + delta));
                  setSmallScale(next / 100); saveSmallScale(next / 100);
                }}
                className="w-full cursor-pointer"
                style={{ accentColor: "#7c3aed" }}
              />
              {/* Saisie manuelle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 flex-1">Valeur exacte :</span>
                <input
                  type="number" min={0} max={100} step={1}
                  value={Math.round(smallScale * 100)}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    if (isNaN(raw)) return;
                    const v = Math.min(100, Math.max(0, raw)) / 100;
                    setSmallScale(v); saveSmallScale(v);
                  }}
                  className="w-16 text-center text-sm font-bold border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
                />
                <span className="text-sm text-gray-400 font-medium">%</span>
              </div>
              {/* Raccourcis rapides */}
              <div className="flex gap-1 pt-1">
                {[100, 90, 85, 80, 75, 70].map((pct) => (
                  <button
                    key={pct} type="button"
                    onClick={() => { const v = pct / 100; setSmallScale(v); saveSmallScale(v); }}
                    className={`flex-1 py-1 rounded text-xs font-semibold border transition-colors ${Math.round(smallScale * 100) === pct ? "bg-violet-600 text-white border-violet-600" : "bg-gray-50 text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600"}`}
                  >{pct}%</button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                <Save className="h-3.5 w-3.5" />Enregistrer
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ── Éditeur ── */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Code PHP du template</CardTitle>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setTab("code")} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "code" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    <Code2 className="h-3 w-3" /> Code
                  </button>
                  <button
                    onClick={handlePhpPreview}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    <Eye className="h-3 w-3" /> {previewing ? "..." : "Aperçu"}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tab === "code" ? (
                <textarea
                  className="w-full font-mono text-xs p-4 resize-none focus:outline-none rounded-b-xl leading-relaxed bg-gray-950 text-purple-300"
                  style={{ minHeight: "520px" }}
                  value={phpCode}
                  onChange={(e) => setPhpCode(e.target.value)}
                  spellCheck={false}
                  placeholder="Collez ici le code PHP complet du template Mikhmon v3 (template.php / template-small.php / template-thermal.php)…"
                />
              ) : (
                <div className="p-6 bg-gray-50 rounded-b-xl min-h-64 flex flex-wrap gap-3 items-start justify-center">
                  {previewHtmls.length > 0
                    ? previewHtmls.map((h, i) => <div key={i} dangerouslySetInnerHTML={{ __html: h }} />)
                    : <p className="text-sm text-gray-400">Cliquez "Aperçu" pour exécuter le PHP et voir le rendu.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Panneau de référence ── */}
        <div className="xl:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Mode Mikhmon v3 — Collage direct PHP</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-gray-600">
              <p>Collez/importez le template PHP brut de Mikhmon v3. Il est exécuté <strong>côté serveur</strong> à chaque impression, avec variables injectées automatiquement :</p>
              <div className="bg-gray-950 text-purple-300 font-mono p-3 rounded-lg text-xs space-y-0.5">
                {[
                  ["$hotspotname", "Nom du routeur"],
                  ["$dnsname",     "Contact/pied"],
                  ["$getprice",    "Prix (nombre)"],
                  ["$currency",    "FCFA"],
                  ["$username",    "Identifiant"],
                  ["$password",    "Mot de passe"],
                  ["$usermode",    "vc ou up"],
                  ["$validity",    "ex: 1d"],
                  ["$timelimit",   "ex: 6h"],
                  ["$datalimit",   "octets bruts"],
                  ["$num",         "numéro ticket"],
                  ["$qrcode",      "<img src=...>"],
                ].map(([v, d]) => (
                  <div key={v} className="flex gap-2">
                    <span className="text-purple-400 w-28 flex-shrink-0">{v}</span>
                    <span className="text-gray-500">{d}</span>
                  </div>
                ))}
              </div>
              <p className="text-gray-400">Tu peux coller le code complet tel quel. Les marqueurs <code>&lt;!--mks-mulai--&gt;</code> / <code>&lt;!--mks-akhir--&gt;</code> sont pris en charge. Si absents, le rendu complet est tout de même utilisé.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Couleurs par prix (FCFA)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {[
                  ["0","#E50877"],["100","#752CEB"],["200","#804000"],["300","#13C013"],
                  ["500","#ECA352"],["1000","#F75418"],["1500","#FF69B4"],
                  ["2500","#F70000"],["3000","#F70000"],["13000","#2E8B57"],
                  ["17000","#0000FF"],["35000","#6495ED"],["80000","#FF8C00"],
                  ["160000","#DC143C"],
                ].map(([price, color]) => (
                  <div key={price} className="flex items-center gap-3 px-4 py-1.5">
                    <div className="w-4 h-4 rounded flex-shrink-0" style={{ background: color }} />
                    <code className="text-xs font-mono text-gray-600 flex-1">{price}</code>
                    <code className="text-xs font-mono text-gray-400">{color}</code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
