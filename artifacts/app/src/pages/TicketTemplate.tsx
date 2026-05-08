import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileCode, RotateCcw, Save, Eye, Code2, Upload, BookMarked, Sliders, Settings2, Plus, Pencil, Trash2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { PrintScaleDialog } from "@/components/PrintScaleDialog";

export const SMALL_SCALE_KEY   = "vn_small_scale";
export const MOBILE_SCALE_KEY  = "vn_print_scale_mobile";

export function readSmallScale(): number {
  try {
    const stored = localStorage.getItem(SMALL_SCALE_KEY);
    const v = parseFloat(stored ?? "1"); return isNaN(v) ? 1 : v;
  } catch { return 1; }
}
export function saveSmallScale(v: number) { try { localStorage.setItem(SMALL_SCALE_KEY, String(v)); } catch {} }
export function hasExplicitSmallScale(): boolean {
  try { return localStorage.getItem(SMALL_SCALE_KEY) !== null; } catch { return false; }
}

export function readMobileScale(def = 100): number {
  try {
    const stored = localStorage.getItem(MOBILE_SCALE_KEY);
    const v = parseInt(stored ?? String(def), 10); return isNaN(v) ? def : v;
  } catch { return def; }
}
export function saveMobileScale(v: number) { try { localStorage.setItem(MOBILE_SCALE_KEY, String(v)); } catch {} }
export function hasExplicitMobileScale(): boolean {
  try { return localStorage.getItem(MOBILE_SCALE_KEY) !== null; } catch { return false; }
}

const TEMPLATE_KEY = "voucher-ticket-template";

// ─── Template par défaut ────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function applyVars(tpl: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    tpl
  );
}

export function getStoredTemplate(): string {
  try { return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; }
}

// ─── Parseur PHP → Template HTML ─────────────────────────────────────────────
export function parsePHPTemplate(raw: string): string {
  let s = raw;

  const mStart = s.indexOf("<!--mks-mulai-->");
  const mEnd   = s.indexOf("<!--mks-akhir-->");
  if (mStart !== -1 && mEnd !== -1) {
    s = s.slice(mStart, mEnd + "<!--mks-akhir-->".length);
  }

  s = s.replace(
    /<\?php[^?]*if\s*\(\s*\$usermode\s*==\s*["']vc["']\s*\)\s*\{[^?]*\?>([\s\S]*?)<\?php[^?]*\}(?:else\s*if|elseif)\s*\(\s*\$usermode\s*==\s*["']up["']\s*\)\s*\{[^?]*\?>([\s\S]*?)<\?php[^?]*\}\s*\?>/,
    "{{codeblock}}"
  );
  s = s.replace(/<!--mks-voucher-akhir-->/g, "");

  s = s.replace(/<img([^>]*)>\s*<\?=\s*\$qrcode\s*\?>/g, '<img$1 src="{{qrcode}}">');
  s = s.replace(/<\?=\s*\$qrcode\s*\?>/g, '<img src="{{qrcode}}" style="width:32px;height:32px;" alt="QR">');
  s = s.replace(/<\?php\s+echo\s+\$qrcode\s*;?\s*\?>/g, '<img src="{{qrcode}}" style="width:32px;height:32px;" alt="QR">');

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

  const subVars = (expr: string): string => {
    let r = expr.trim().replace(/;$/, "").trim();
    for (const [pv, tv] of varMap) {
      r = r.replace(new RegExp(`\\$${pv}\\b`, "g"), `{{${tv}}}`);
    }
    return r;
  };

  s = s.replace(/<\?=([\s\S]*?)\?>/g, (_, inner) => {
    let r = subVars(inner);
    r = r.replace(/"([^"]*)"\s*\.\s*/g, "$1").replace(/\.\s*"([^"]*)"/g, "$1");
    r = r.replace(/^["']|["']$/g, "");
    r = r.replace(/"([^"]*)"/g, "$1");
    r = r.replace(/^'|'$/g, "");
    return r.trim();
  });

  s = s.replace(/<\?php\s+echo\s+([\s\S]*?);?\s*\?>/g, (_, inner) => {
    let r = subVars(inner);
    r = r.replace(/"([^"]*)"\s*\.\s*/g, "$1").replace(/\.\s*"([^"]*)"/g, "$1");
    r = r.replace(/^["']|["']$/g, "").replace(/"([^"]*)"/g, "$1");
    return r.trim();
  });

  for (const [pv, tv] of varMap) {
    s = s.replace(new RegExp(`\\$${pv}\\b`, "g"), `{{${tv}}}`);
  }

  s = s.replace(/<\?php[\s\S]*?\?>/g, "");
  s = s.replace(/<\?[\s\S]*?\?>/g, "");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ─── PHP mode helpers ─────────────────────────────────────────────────────────

export const PHP_KEY = "voucher-ticket-php";
export const CUSTOM_DEFAULT_KEY = "voucher-ticket-custom-default";

export function getCustomDefault(): string | null {
  try { return localStorage.getItem(CUSTOM_DEFAULT_KEY); } catch { return null; }
}

export function getStoredPHP(): string {
  try { return localStorage.getItem(PHP_KEY) ?? getCustomDefault() ?? DEFAULT_MIKHMON_PHP; } catch { return DEFAULT_MIKHMON_PHP; }
}

const _TOKEN_KEY = "vouchernet_admin_token";
function _readAuthToken(): string | null {
  try { return localStorage.getItem(_TOKEN_KEY) ?? sessionStorage.getItem(_TOKEN_KEY); } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Preset = {
  id: number;
  name: string;
  html: string;
  scaleSmall: number;
  scaleMobile: number;
  position: number;
};

export type ServerTemplateResult = {
  template: string;
  isDefault: boolean;
  serverScaleSmall:  number | null;
  serverScaleMobile: number | null;
  selectedPresetId:  number | null;
};

// ─── Template cache ──────────────────────────────────────────────────────────
let _templateCache: { result: ServerTemplateResult; expiresAt: number } | null = null;
const TEMPLATE_CACHE_TTL_MS = 0;

export function invalidateTemplateCache(): void {
  _templateCache = null;
}

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
      const data = (await r.json()) as { template: string | null; scaleSmall?: number; scaleMobile?: number; selectedPresetId?: number | null };
      const serverScaleSmall  = typeof data.scaleSmall  === "number" ? data.scaleSmall  : null;
      const serverScaleMobile = typeof data.scaleMobile === "number" ? data.scaleMobile : null;
      const selectedPresetId  = data.selectedPresetId ?? null;
      if (data.template && data.template.trim().length > 0) {
        try { localStorage.setItem(PHP_KEY, data.template); } catch {}
        return _cache({ template: data.template, isDefault: false, serverScaleSmall, serverScaleMobile, selectedPresetId });
      }
      const cached = (() => {
        try { return localStorage.getItem(PHP_KEY) ?? getCustomDefault(); } catch { return null; }
      })();
      if (cached && cached.trim().length > 0) {
        return _cache({ template: cached, isDefault: false, serverScaleSmall, serverScaleMobile, selectedPresetId });
      }
      return _cache({ template: DEFAULT_MIKHMON_PHP, isDefault: true, serverScaleSmall, serverScaleMobile, selectedPresetId });
    }
  } catch { /* réseau indisponible */ }

  const cached = (() => {
    try { return localStorage.getItem(PHP_KEY) ?? getCustomDefault(); } catch { return null; }
  })();
  if (cached && cached.trim().length > 0) {
    return _cache({ template: cached, isDefault: false, serverScaleSmall: null, serverScaleMobile: null, selectedPresetId: null });
  }

  return _cache({ template: DEFAULT_MIKHMON_PHP, isDefault: true, serverScaleSmall: null, serverScaleMobile: null, selectedPresetId: null });
}

export async function fetchServerTemplate(): Promise<string> {
  return (await fetchServerTemplateWithMeta()).template;
}

export function isPHPMode(): boolean {
  return true;
}

// ─── Données exemple ──────────────────────────────────────────────────────────

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

// ─── Default Mikhmon PHP template ─────────────────────────────────────────────

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

// ─── Helper token ─────────────────────────────────────────────────────────────

function _getToken(): string {
  return localStorage.getItem("vouchernet_admin_token") ?? sessionStorage.getItem("vouchernet_admin_token") ?? "";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketTemplate() {
  const { role, isSuperAdmin } = useAuth();
  const isManager = role === "manager";
  const isSimplified = !isSuperAdmin; // admin/gérant/collaborateur → UI simplifiée (sélecteur preset uniquement)
  const { toast } = useToast();

  // ── PHP code (contenu de l'éditeur)
  const [phpCode, setPhpCode] = useState<string>(() => getStoredPHP());

  // ── Presets
  const [presets, setPresets] = useState<Preset[]>([]);
  const [serverPresetId, setServerPresetId] = useState<number | null>(null);
  const [pendingPresetId, setPendingPresetId] = useState<number | null>(null);
  const hasUnsavedPresetChange = pendingPresetId !== serverPresetId;

  // ── Paramètres d'impression
  const [smallScale,   setSmallScale]   = useState(() => readSmallScale());
  const [scaleMobile,  setScaleMobile]  = useState(() => readMobileScale());
  const [showScaleDialog, setShowScaleDialog] = useState(false);

  // ── UI state
  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saved, setSaved] = useState(false);
  const [previewHtmls, setPreviewHtmls] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Dialog gérer modèles (super-admin)
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", html: "", scaleSmall: 85, scaleMobile: 100 });
  const [savingPreset, setSavingPreset] = useState(false);

  // ── Chargement initial depuis le serveur
  useEffect(() => {
    // Charger les presets
    const tok = _getToken();
    if (tok) {
      fetch(`${BASE}/api/tenant/preset-templates`, { headers: { Authorization: `Bearer ${tok}` } })
        .then(r => r.ok ? r.json() : null)
        .then((data: { presets: Preset[] } | null) => {
          if (data?.presets) setPresets(data.presets);
        })
        .catch(() => {});
    }

    // Charger le template + preset sélectionné
    fetchServerTemplateWithMeta().then(({ template, serverScaleSmall, serverScaleMobile, selectedPresetId }) => {
      setPhpCode(template);
      setServerPresetId(selectedPresetId);
      setPendingPresetId(selectedPresetId);
      if (serverScaleSmall !== null) {
        const v = serverScaleSmall / 100;
        saveSmallScale(v);
        setSmallScale(v);
      } else {
        setSmallScale(readSmallScale());
      }
      if (serverScaleMobile !== null) {
        saveMobileScale(serverScaleMobile);
        setScaleMobile(serverScaleMobile);
      } else {
        setScaleMobile(readMobileScale());
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sélectionner un preset
  const handleSelectPreset = useCallback((presetId: number | null) => {
    setPendingPresetId(presetId);
    if (presetId === null) {
      // Mode personnalisé — restaurer le template custom stocké
      const custom = getStoredPHP();
      setPhpCode(custom);
    } else {
      const preset = presets.find(p => p.id === presetId);
      if (preset) {
        setPhpCode(preset.html);
        const v = preset.scaleSmall / 100;
        setSmallScale(v);
        saveSmallScale(v);
        setScaleMobile(preset.scaleMobile);
        saveMobileScale(preset.scaleMobile);
      }
    }
  }, [presets]);

  // ── Enregistrer la sélection de preset
  const handleSavePreset = useCallback(async () => {
    const tok = _getToken();
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ presetId: pendingPresetId }),
      });
      if (resp.ok) {
        invalidateTemplateCache();
        setServerPresetId(pendingPresetId);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        const name = pendingPresetId === null ? "Modèle personnalisé" : (presets.find(p => p.id === pendingPresetId)?.name ?? "Modèle");
        toast({ title: "Modèle appliqué", description: `« ${name} » actif sur tous les appareils.` });
      } else {
        toast({ title: "Erreur", description: "Impossible de sauvegarder le modèle.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", description: "Impossible de joindre le serveur.", variant: "destructive" });
    }
  }, [pendingPresetId, presets, toast]);

  // ── Importer un fichier .php (super-admin uniquement)
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
      setPendingPresetId(null);
      setTab("code");
      const tok = _getToken();
      let serverSynced = false;
      try {
        const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: JSON.stringify({ template: raw, scaleSmall: Math.round(smallScale * 100), scaleMobile }),
        });
        serverSynced = resp.ok;
        if (resp.ok) { setServerPresetId(null); }
      } catch { serverSynced = false; }
      if (serverSynced) {
        toast({ title: "Fichier PHP importé et sauvegardé", description: `« ${file.name} » actif sur tous les appareils.` });
      } else {
        toast({ title: "Fichier PHP chargé", description: `« ${file.name} » chargé localement.`, variant: "destructive" });
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [toast, smallScale, scaleMobile]);

  // ── Sauvegarder template personnalisé (super-admin)
  const handleSave = useCallback(async () => {
    invalidateTemplateCache();
    try {
      localStorage.setItem(PHP_KEY, phpCode);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, phpCode);
      localStorage.removeItem(TEMPLATE_KEY);
    } catch { /* ignore */ }
    const tok = _getToken();
    let serverSynced = false;
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ template: phpCode, scaleSmall: Math.round(smallScale * 100), scaleMobile }),
      });
      serverSynced = resp.ok;
      if (resp.ok) { setServerPresetId(null); setPendingPresetId(null); }
    } catch { serverSynced = false; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    if (serverSynced) {
      toast({ title: "Modèle sauvegardé", description: "Synchronisé sur le serveur." });
    } else {
      toast({ title: "Modèle sauvegardé localement", description: "Serveur non synchronisé.", variant: "destructive" });
    }
  }, [phpCode, toast, smallScale, scaleMobile]);

  // ── Sauvegarder échelles seulement
  const handleSaveScalesOnly = useCallback(async () => {
    const tok = _getToken();
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ template: phpCode, scaleSmall: Math.round(smallScale * 100), scaleMobile }),
      });
      if (resp.ok) {
        toast({ title: "Paramètres d'impression enregistrés", description: "Échelles synchronisées." });
      } else {
        toast({ title: "Échelles sauvegardées localement", description: "Synchronisation échouée.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Échelles sauvegardées localement", description: "Impossible de joindre le serveur.", variant: "destructive" });
    }
  }, [phpCode, toast, smallScale, scaleMobile]);

  // ── Réinitialiser
  const handleReset = useCallback(() => {
    const base = getCustomDefault() ?? DEFAULT_MIKHMON_PHP;
    setPhpCode(base);
    setPendingPresetId(null);
    try { localStorage.setItem(PHP_KEY, base); } catch { /* ignore */ }
    toast({ title: "Modèle réinitialisé", description: "Le modèle de base a été restauré." });
  }, [toast]);

  // ── Définir par défaut
  const handleSetAsDefault = useCallback(async () => {
    if (!phpCode.trim()) return;
    invalidateTemplateCache();
    try {
      localStorage.setItem(CUSTOM_DEFAULT_KEY, phpCode);
      localStorage.setItem(PHP_KEY, phpCode);
      localStorage.removeItem(TEMPLATE_KEY);
    } catch { /* ignore */ }
    const tok = _getToken();
    let serverSynced = false;
    try {
      const resp = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ template: phpCode, scaleSmall: Math.round(smallScale * 100), scaleMobile }),
      });
      serverSynced = resp.ok;
    } catch { serverSynced = false; }
    if (serverSynced) {
      toast({ title: "Modèle de base défini", description: "Synchronisé sur tous les appareils." });
    } else {
      toast({ title: "Modèle de base défini localement", description: "Serveur non synchronisé.", variant: "destructive" });
    }
  }, [phpCode, toast, smallScale, scaleMobile]);

  // ── Coller Mikhmon
  const handleUseDefaultMikhmon = useCallback(() => {
    setTab("code");
    setPhpCode(DEFAULT_MIKHMON_PHP);
    setPendingPresetId(null);
    toast({ title: "Modèle Mikhmon chargé", description: "Cliquez Sauvegarder pour l'activer." });
  }, [toast]);

  // ── Aperçu PHP
  const handlePhpPreview = useCallback(async () => {
    if (!phpCode.trim()) return;
    setPreviewing(true);
    setTab("preview");
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php: phpCode, vouchers: [SAMPLE_VARS, SAMPLE_VARS_2] }),
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

  // ═══ Super-admin: CRUD modèles ════════════════════════════════════════════

  const refreshPresets = useCallback(async () => {
    const tok = _getToken();
    const resp = await fetch(`${BASE}/api/super/preset-templates`, { headers: { Authorization: `Bearer ${tok}` } });
    if (resp.ok) {
      const data = await resp.json() as { presets: Preset[] };
      setPresets(data.presets);
    }
  }, []);

  const handleOpenManage = useCallback(() => {
    setEditingPreset(null);
    setShowAddForm(false);
    setShowManageDialog(true);
  }, []);

  const handleEditPreset = useCallback((p: Preset) => {
    setEditingPreset(p);
    setEditForm({ name: p.name, html: p.html, scaleSmall: p.scaleSmall, scaleMobile: p.scaleMobile });
    setShowAddForm(false);
  }, []);

  const handleAddPreset = useCallback(() => {
    setEditingPreset(null);
    setEditForm({ name: "", html: "", scaleSmall: 85, scaleMobile: 100 });
    setShowAddForm(true);
  }, []);

  const handleSavePresetEdit = useCallback(async () => {
    if (!editForm.name.trim() || !editForm.html.trim()) {
      toast({ title: "Nom et HTML requis", variant: "destructive" }); return;
    }
    setSavingPreset(true);
    try {
      const tok = _getToken();
      const url = editingPreset
        ? `${BASE}/api/super/preset-templates/${editingPreset.id}`
        : `${BASE}/api/super/preset-templates`;
      const method = editingPreset ? "PUT" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify(editForm),
      });
      if (resp.ok) {
        await refreshPresets();
        invalidateTemplateCache();
        setEditingPreset(null);
        setShowAddForm(false);
        toast({ title: editingPreset ? "Modèle mis à jour" : "Modèle ajouté", description: `« ${editForm.name} » sauvegardé.` });
      } else {
        toast({ title: "Erreur", description: "Impossible de sauvegarder.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSavingPreset(false);
    }
  }, [editForm, editingPreset, refreshPresets, toast]);

  const handleDeletePreset = useCallback(async (p: Preset) => {
    if (!confirm(`Supprimer le modèle « ${p.name} » ? Cette action est irréversible.`)) return;
    const tok = _getToken();
    const resp = await fetch(`${BASE}/api/super/preset-templates/${p.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (resp.ok) {
      await refreshPresets();
      invalidateTemplateCache();
      if (pendingPresetId === p.id) { setPendingPresetId(null); setServerPresetId(null); }
      toast({ title: "Modèle supprimé" });
    } else {
      toast({ title: "Erreur lors de la suppression", variant: "destructive" });
    }
  }, [pendingPresetId, refreshPresets, toast]);

  const hasSaved = (() => { try { return localStorage.getItem(PHP_KEY) !== null; } catch { return false; } })();

  // ═══ Rendu ════════════════════════════════════════════════════════════════

  return (
    <div>
      {/* ── En-tête ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCode className="h-6 w-6 text-blue-500" />
            Modèle de ticket
          </h1>
        </div>

        {/* Boutons barre d'actions (super-admin uniquement pour la plupart) */}
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && hasSaved && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50" title="Réinitialiser">
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Réinitialiser</span>
            </Button>
          )}
          {isSuperAdmin && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleUseDefaultMikhmon} title="Coller modèle Mikhmon">
                <FileCode className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Coller Mikhmon</span>
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
              <Button variant="outline" size="sm" className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50" onClick={() => setShowScaleDialog(true)} title="Paramètres d'impression">
                <Sliders className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline text-[11px]">Imprimer {Math.round(smallScale * 100)}% · Mob {scaleMobile}%</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={handleOpenManage} title="Gérer les modèles prédéfinis">
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Gérer les modèles</span>
              </Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saved} title={saved ? "Sauvegardé" : "Sauvegarder"}>
                <Save className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{saved ? "Sauvegardé ✓" : "Sauvegarder"}</span>
              </Button>
            </>
          )}
          {/* Bouton Enregistrer pour admin/gérant/collab — visible si sélection changée */}
          {isSimplified && hasUnsavedPresetChange && (
            <Button size="sm" onClick={handleSavePreset} className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={saved}>
              <Save className="h-3.5 w-3.5" />
              <span>{saved ? "Enregistré ✓" : "Enregistrer"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Sélecteur de modèle prédéfini ── */}
      {presets.length > 0 && (
        <Card className="mb-5">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 mr-1">Modèle :</span>
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPreset(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    pendingPresetId === p.id
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-700"
                  }`}
                >
                  {pendingPresetId === p.id && <Check className="h-3 w-3" />}
                  {p.name}
                </button>
              ))}
              {isSuperAdmin && (
                <button
                  onClick={() => handleSelectPreset(null)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    pendingPresetId === null
                      ? "bg-gray-800 text-white border-gray-800 shadow-sm"
                      : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {pendingPresetId === null && <Check className="h-3 w-3" />}
                  Personnalisé
                </button>
              )}
              {hasUnsavedPresetChange && (
                <span className="text-xs text-amber-600 font-medium ml-2">• Non enregistré</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <PrintScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        scaleSmall={Math.round(smallScale * 100)}
        scaleMobile={scaleMobile}
        onScaleSmallChange={(n) => { const v = n / 100; setSmallScale(v); saveSmallScale(v); }}
        onScaleMobileChange={(n) => { setScaleMobile(n); saveMobileScale(n); }}
        onSave={handleSaveScalesOnly}
      />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ── Éditeur ── */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {isSimplified
                    ? (pendingPresetId !== null ? `Aperçu — ${presets.find(p => p.id === pendingPresetId)?.name ?? "Modèle"}` : "Code PHP du template")
                    : "Code PHP du template"
                  }
                </CardTitle>
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
                  onChange={(e) => { if (!isSimplified || pendingPresetId === null) setPhpCode(e.target.value); }}
                  readOnly={isSimplified && pendingPresetId !== null}
                  spellCheck={false}
                  placeholder="Collez ici le code PHP complet du template Mikhmon v3…"
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
          {!isManager && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Variables PHP disponibles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-gray-600">
                <p>Les variables suivantes sont injectées automatiquement à chaque impression :</p>
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
                    ["$color",       "couleur par prix"],
                  ].map(([v, d]) => (
                    <div key={v} className="flex gap-2">
                      <span className="text-purple-400 w-28 flex-shrink-0">{v}</span>
                      <span className="text-gray-500">{d}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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

      {/* ═══ Dialog : Gérer les modèles prédéfinis (super-admin) ═══ */}
      <Dialog open={showManageDialog} onOpenChange={(open) => { setShowManageDialog(open); if (!open) { setEditingPreset(null); setShowAddForm(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-emerald-600" />
              Gérer les modèles prédéfinis
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Liste des presets */}
            {presets.map(p => (
              <div key={p.id} className={`border rounded-lg p-3 transition-colors ${editingPreset?.id === p.id ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white"}`}>
                {editingPreset?.id === p.id ? (
                  /* Formulaire d'édition inline */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-blue-700">Modifier « {p.name} »</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Nom</Label>
                        <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Échelle bureau (%)</Label>
                          <Input type="number" min={50} max={100} value={editForm.scaleSmall} onChange={e => setEditForm(f => ({ ...f, scaleSmall: Number(e.target.value) }))} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Échelle mobile (%)</Label>
                          <Input type="number" min={50} max={100} value={editForm.scaleMobile} onChange={e => setEditForm(f => ({ ...f, scaleMobile: Number(e.target.value) }))} className="h-8 text-xs" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">HTML / PHP</Label>
                      <textarea
                        value={editForm.html}
                        onChange={e => setEditForm(f => ({ ...f, html: e.target.value }))}
                        className="w-full font-mono text-xs p-2 border rounded-md resize-none bg-gray-950 text-purple-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        style={{ minHeight: "140px" }}
                        spellCheck={false}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setEditingPreset(null)}>Annuler</Button>
                      <Button size="sm" onClick={handleSavePresetEdit} disabled={savingPreset} className="gap-1.5">
                        <Save className="h-3.5 w-3.5" />
                        {savingPreset ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Vue compacte */
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900">{p.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">Bureau {p.scaleSmall}% · Mobile {p.scaleMobile}%</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500 hover:text-blue-600" onClick={() => handleEditPreset(p)} title="Modifier">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500 hover:text-red-600" onClick={() => handleDeletePreset(p)} title="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Formulaire d'ajout */}
            {showAddForm && (
              <div className="border border-emerald-300 rounded-lg p-3 bg-emerald-50 space-y-3">
                <div className="text-xs font-semibold text-emerald-700">Nouveau modèle</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nom</Label>
                    <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" placeholder="Ex: Mon modèle" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Bureau (%)</Label>
                      <Input type="number" min={50} max={100} value={editForm.scaleSmall} onChange={e => setEditForm(f => ({ ...f, scaleSmall: Number(e.target.value) }))} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Mobile (%)</Label>
                      <Input type="number" min={50} max={100} value={editForm.scaleMobile} onChange={e => setEditForm(f => ({ ...f, scaleMobile: Number(e.target.value) }))} className="h-8 text-xs" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">HTML / PHP</Label>
                  <textarea
                    value={editForm.html}
                    onChange={e => setEditForm(f => ({ ...f, html: e.target.value }))}
                    className="w-full font-mono text-xs p-2 border rounded-md resize-none bg-gray-950 text-purple-300 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    style={{ minHeight: "140px" }}
                    spellCheck={false}
                    placeholder="<!--mks-mulai--><table>...</table><!--mks-akhir-->"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>Annuler</Button>
                  <Button size="sm" onClick={handleSavePresetEdit} disabled={savingPreset} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="h-3.5 w-3.5" />
                    {savingPreset ? "Création..." : "Créer"}
                  </Button>
                </div>
              </div>
            )}

            {!showAddForm && !editingPreset && (
              <Button variant="outline" size="sm" className="gap-1.5 w-full text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={handleAddPreset}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter un modèle
              </Button>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Fermer</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
