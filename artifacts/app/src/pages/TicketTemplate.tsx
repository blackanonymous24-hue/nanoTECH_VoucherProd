import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, RotateCcw, Save, Eye, Code2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TEMPLATE_KEY = "voucher-ticket-template";

// ─── Template par défaut — reproduction fidèle du PHP fourni ─────────────────
// Variables : {{hotspotname}} {{dnsname}} {{color}} {{price}} {{currency}}
//             {{codeblock}} {{validity}} {{timelimit}} {{datalimit}}
//             {{qrcode}} {{num}}
// {{codeblock}} est pré-calculé selon le mode (Voucher ou Compte) avant rendu.
export const DEFAULT_TEMPLATE = `<!--mks-mulai-->
<table style="display:inline-block;border-collapse:collapse;border:1px solid #444;margin:0px;width:135px;overflow:hidden;position:relative;padding:1px;font-family:Arial,sans-serif;vertical-align:top;">
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
<div style="position:relative;z-index:-1;padding:0px;float:left;">
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
<img style="border:1px {{color}} solid;border-radius:3px;width:32px;height:32px;float:right;margin:0 1px -5px 0;" src="{{qrcode}}" alt="QR" />
</td>
</tr>
<tr>
<td style="background:{{color}};color:#666;padding:0px;" valign="top" colspan="2">
<div style="text-align:left;color:#fff;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
<b>{{dnsname}}</b><span style="float:right;"> [{{num}}]</span>
</div>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
</tbody>
</table>
<!--mks-akhir-->`;

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

const PHP_KEY = "voucher-ticket-php";

export function getStoredPHP(): string | null {
  try { return localStorage.getItem(PHP_KEY); } catch { return null; }
}

export function isPHPMode(): boolean {
  return getStoredPHP() !== null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CODEBLOCK_VC = (color: string, username: string) =>
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>` +
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">${username}</div>`;

const SAMPLE_COLOR = "#ECA352";
const SAMPLE_USERNAME = "abc12345";

const SAMPLE_VARS: Record<string, string> = {
  hotspotname: "MON HOTSPOT WIFI",
  dnsname: "Tel: +243 XX XXX XXXX",
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

const VARIABLES = [
  { name: "{{hotspotname}}", php: "$hotspotname", desc: "Nom du routeur" },
  { name: "{{dnsname}}",     php: "$dnsname",     desc: "Contact — pied de ticket" },
  { name: "{{color}}",       php: "$color",       desc: "Couleur calculée selon le prix" },
  { name: "{{price}}",       php: "$getprice",    desc: "Prix (nombre)" },
  { name: "{{currency}}",    php: "$currency",    desc: "Devise (FCFA)" },
  { name: "{{codeblock}}",   php: "if($usermode)", desc: "Bloc vc ou up (pré-calculé)" },
  { name: "{{username}}",    php: "$username",    desc: "Identifiant" },
  { name: "{{password}}",    php: "$password",    desc: "Mot de passe (mode Compte)" },
  { name: "{{validity}}",    php: "$validity",    desc: "Validité formatée" },
  { name: "{{timelimit}}",   php: "$timelimit",   desc: "Durée de session" },
  { name: "{{datalimit}}",   php: "$datalimit",   desc: "Limite de données" },
  { name: "{{qrcode}}",      php: "$qrcode",      desc: "src de l'image QR code" },
  { name: "{{num}}",         php: "$num",         desc: "Numéro séquentiel" },
];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DEFAULT_MIKHMON_PHP = `<?php
// Mikhmon v3-like default template (editable)
?>
<!--mks-mulai-->
<table style="display:inline-block;border-collapse:collapse;border:1px solid #444;margin:0px;width:135px;overflow:hidden;position:relative;padding:1px;font-family:Arial,sans-serif;vertical-align:top;">
  <tbody>
    <tr>
      <td style="background:<?= $color ?>;color:#676;padding:0px;" valign="top" colspan="2">
        <div style="text-align:center;color:#fff;font-size:8px;font-weight:bold;margin:1px;padding:2.5px;">
          <b><?= $hotspotname ?></b>
        </div>
      </td>
    </tr>
    <tr>
      <td style="color:#666;" valign="top">
        <table style="width:100%;">
          <tbody>
            <tr>
              <td style="width:35px;">
                <div style="position:relative;z-index:-1;padding:0px;float:left;">
                  <div style="position:absolute;top:0;display:inline;margin-top:-100px;width:0;height:0;border-top:170px solid transparent;border-left:30px solid transparent;border-right:170px solid #DCDCDC;"></div>
                </div>
              </td>
              <td style="width:30px;">
                <div style="margin:-10px;text-align:right;font-weight:bold;font-size:10px;padding-left:18px;color:<?= $color ?>;"><small style="font-size:10px;margin-left:-65px;position:absolute;"><?= $getprice ?> <?= $currency ?></small></div>
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
                  <?php if($usermode == "vc"){?>
                    <div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>
                    <div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:<?= $color ?>;"><?= $username ?></div>
                  <?php }elseif($usermode == "up"){?>
                    <div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:#444;">Compte Utilisateur</div>
                    <div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:<?= $color ?>;">User: <?= $username ?><br>Pass: <?= $password ?></div>
                  <?php }?>
                </div>
                <div style="text-align:center;color:#111;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
                  Veuillez conserver ce ticket jusqu'à l'épuisement du forfait.
                </div>
              </td>
              <td style="width:120px;text-align:right;" valign="top">
                <div style="clear:both;padding:0 2.5px;font-size:7px;font-weight:bold;color:#000000;">
                  <?= $validity ?><br><?= $timelimit ?><br><?= $datalimit ?>
                </div>
                <?= $qrcode ?>
              </td>
            </tr>
            <tr>
              <td style="background:<?= $color ?>;color:#666;padding:0px;" valign="top" colspan="2">
                <div style="text-align:left;color:#fff;font-size:6px;font-weight:bold;margin:0px;padding:2.5px;">
                  <b><?= $dnsname ?></b><span style="float:right;"> [<?= $num ?>]</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
<!--mks-akhir-->`;

export default function TicketTemplate() {
  const { role } = useAuth();
  const isManager = role === "manager";
  const { toast } = useToast();

  // ── Mode: "php" (exécution serveur) ou "html" (variables côté client)
  const [mode, setMode] = useState<"php" | "html">(() =>
    getStoredPHP() !== null ? "php" : "html"
  );

  // ── Contenu PHP brut
  const [phpCode, setPhpCode] = useState<string>(
    () => getStoredPHP() ?? ""
  );

  // ── Contenu HTML avec {{variables}}
  const [htmlCode, setHtmlCode] = useState<string>(
    () => { try { return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; } }
  );

  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saved, setSaved] = useState(false);
  const [previewHtmls, setPreviewHtmls] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Importer un fichier .php
  const handleImportPHP = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      setPhpCode(raw);
      setMode("php");
      setTab("code");
      toast({
        title: "Fichier PHP chargé",
        description: `« ${file.name} » prêt — cliquez Sauvegarder pour l'activer.`,
      });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [toast]);

  // ── Sauvegarder
  const handleSave = useCallback(() => {
    try {
      if (mode === "php") {
        localStorage.setItem(PHP_KEY, phpCode);
        localStorage.removeItem(TEMPLATE_KEY);
      } else {
        localStorage.setItem(TEMPLATE_KEY, htmlCode);
        localStorage.removeItem(PHP_KEY);
      }
    } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    toast({ title: "Modèle sauvegardé", description: "Appliqué à toutes les impressions." });
  }, [mode, phpCode, htmlCode, toast]);

  // ── Réinitialiser
  const handleReset = useCallback(() => {
    if (mode === "php") {
      setPhpCode("");
      setMode("html");
      try { localStorage.removeItem(PHP_KEY); } catch { /* ignore */ }
    } else {
      setHtmlCode(DEFAULT_TEMPLATE);
      try { localStorage.removeItem(TEMPLATE_KEY); } catch { /* ignore */ }
    }
    toast({ title: "Modèle réinitialisé", description: "Le modèle par défaut a été restauré." });
  }, [mode, toast]);

  const handleUseDefaultMikhmon = useCallback(() => {
    setMode("php");
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

  // ── Aperçu HTML côté client
  const htmlPreview1 = applyVars(htmlCode, SAMPLE_VARS);
  const htmlPreview2 = applyVars(htmlCode, SAMPLE_VARS_2);

  const hasSaved = mode === "php"
    ? (() => { try { return localStorage.getItem(PHP_KEY) !== null; } catch { return false; } })()
    : (() => { try { return localStorage.getItem(TEMPLATE_KEY) !== null; } catch { return false; } })();

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCode className="h-6 w-6 text-blue-500" />
            Modèle de ticket
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {mode === "php"
              ? "Mode Mikhmon v3: collez directement votre code PHP du template, sans conversion"
              : <>Code HTML — les variables <code className="text-xs bg-gray-100 px-1 rounded">{"{{var}}"}</code> remplacent les valeurs dynamiques</>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* ── Sélecteur de mode ── */}
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 mr-1">
            <button
              onClick={() => { setMode("php"); setTab("code"); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "php" ? "bg-violet-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              PHP
            </button>
            <button
              onClick={() => { setMode("html"); setTab("code"); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === "html" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              HTML
            </button>
          </div>

          {hasSaved && !isManager && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50">
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
            </Button>
          )}
          {mode === "php" && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleUseDefaultMikhmon}>
                <FileCode className="h-3.5 w-3.5" /> Coller modèle Mikhmon
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Importer .php
              </Button>
              <input ref={fileRef} type="file" accept=".php" className="hidden" onChange={handleImportPHP} />
            </>
          )}
          <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saved}>
            <Save className="h-3.5 w-3.5" />
            {saved ? "Sauvegardé ✓" : "Sauvegarder"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ── Éditeur ── */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {mode === "php" ? "Code PHP du template" : "Code HTML du ticket"}
                </CardTitle>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setTab("code")} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "code" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    <Code2 className="h-3 w-3" /> Code
                  </button>
                  <button
                    onClick={mode === "php" ? handlePhpPreview : () => setTab("preview")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >
                    <Eye className="h-3 w-3" /> {previewing ? "Chargement…" : "Aperçu"}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tab === "code" ? (
                <textarea
                  className={`w-full font-mono text-xs p-4 resize-none focus:outline-none rounded-b-xl leading-relaxed ${mode === "php" ? "bg-gray-950 text-purple-300" : "bg-gray-950 text-green-300"}`}
                  style={{ minHeight: "520px" }}
                  value={mode === "php" ? phpCode : htmlCode}
                  onChange={(e) => mode === "php" ? setPhpCode(e.target.value) : setHtmlCode(e.target.value)}
                  spellCheck={false}
                  placeholder={mode === "php"
                    ? "Collez ici le code PHP complet du template Mikhmon v3 (template.php / template-small.php / template-thermal.php)…"
                    : "Code HTML du ticket avec les variables {{...}}"}
                />
              ) : (
                <div className="p-6 bg-gray-50 rounded-b-xl min-h-64 flex flex-wrap gap-3 items-start">
                  {mode === "php" ? (
                    previewHtmls.length > 0
                      ? previewHtmls.map((h, i) => <div key={i} dangerouslySetInnerHTML={{ __html: h }} />)
                      : <p className="text-sm text-gray-400">Cliquez "Aperçu" pour exécuter le PHP et voir le rendu.</p>
                  ) : (
                    <>
                      <div dangerouslySetInnerHTML={{ __html: htmlPreview1 }} />
                      <div dangerouslySetInnerHTML={{ __html: htmlPreview2 }} />
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Panneau de référence ── */}
        <div className="xl:col-span-2 space-y-4">
          {mode === "php" ? (
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
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Variables disponibles</CardTitle>
                <p className="text-xs text-gray-400">Équivalent des variables PHP</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100">
                  {VARIABLES.map((v) => (
                    <div key={v.name} className="flex items-start gap-2 px-4 py-2">
                      <code className="text-xs font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 whitespace-nowrap">
                        {v.name}
                      </code>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">{v.desc}</div>
                        <div className="text-xs text-gray-300 font-mono">{v.php}</div>
                      </div>
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
    </div>
  );
}
