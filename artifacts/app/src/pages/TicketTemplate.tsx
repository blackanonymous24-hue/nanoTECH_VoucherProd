import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, RotateCcw, Save, Eye, Code2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TEMPLATE_KEY = "voucher-ticket-template";

// ─── Template par défaut — reproduction fidèle du PHP fourni ─────────────────
// Variables : {{hotspotname}} {{dnsname}} {{color}} {{price}} {{currency}}
//             {{codeblock}} {{validity}} {{timelimit}} {{datalimit}}
//             {{qrcode}} {{num}}
// {{codeblock}} est pré-calculé selon le mode (Voucher ou Compte) avant rendu.
export const DEFAULT_TEMPLATE = `<!--mks-mulai-->
<table style="display:inline-block;border-collapse:collapse;border:1px solid #444;margin:0px;width:215px;overflow:hidden;position:relative;padding:1px;font-family:Arial,sans-serif;vertical-align:top;">
<tbody>
<tr>
<td style="background:{{color}};color:#676;padding:0px;" valign="top" colspan="2">
<div style="text-align:center;color:#fff;font-size:10px;font-weight:bold;margin:1px;padding:2.5px;">
<b>{{hotspotname}}</b>
</div>
</td>
</tr>
<tr>
<td style="color:#666;" valign="top">
<table style="width:100%;">
<tbody>
<tr>
<td style="width:115px;">
<div style="position:relative;z-index:-1;padding:0px;float:left;">
<div style="position:absolute;top:0;display:inline;margin-top:-100px;width:0;height:0;border-top:230px solid transparent;border-left:50px solid transparent;border-right:170px solid #DCDCDC;"></div>
</div>
</td>
<td style="width:115px;">
<div style="margin:-10px;text-align:right;font-weight:bold;font-size:15px;padding-left:17px;color:{{color}};">
<small style="font-size:11px;margin-left:-65px;position:absolute;">{{price}} {{currency}}</small>
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
<td style="width:115px;" valign="top">
<div style="clear:both;color:#555;margin-top:5px;margin-bottom:2.5px;">
{{codeblock}}
</div>
<div style="text-align:center;color:#111;font-size:7px;font-weight:bold;margin:0px;padding:2.5px;">
Veuillez conserver ce ticket jusqu'à l'épuisement du forfait. En cas de litige, elle atteste votre véracité. Aucune réclamation ne sera prise en compte sans présentation de ce bon d'achat.
</div>
</td>
<td style="width:100px;text-align:right;" valign="top">
<div style="clear:both;padding:0 2.5px;font-size:7px;font-weight:bold;color:#000000;">
{{validity}}<br>{{timelimit}}<br>{{datalimit}}
</div>
<img style="border:1px solid {{color}};border-radius:3px;width:50px;height:50px;float:right;margin:0 1px -5px 0;" src="{{qrcode}}" alt="QR" />
</td>
</tr>
<tr>
<td style="background:{{color}};padding:0px;" valign="top" colspan="2">
<div style="text-align:left;color:#fff;font-size:8px;font-weight:bold;margin:0px;padding:2.5px;">
<b>{{dnsname}}</b> <span style="float:right;">[{{num}}]</span>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const CODEBLOCK_VC = (color: string, username: string) =>
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>` +
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:17px;color:${color};">${username}</div>`;

const CODEBLOCK_UP = (color: string, username: string, password: string) =>
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:#444;">Compte Utilisateur</div>` +
  `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">User: ${username}<br>Pass: ${password}</div>`;

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
  timelimit: "Durasi: 2 Heure(s)",
  datalimit: "",
  num: "1",
  profile: "default",
  color: SAMPLE_COLOR,
  codeblock: CODEBLOCK_VC(SAMPLE_COLOR, SAMPLE_USERNAME),
  qrcode: `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${SAMPLE_USERNAME}&margin=2`,
};

const VARIABLES = [
  { name: "{{hotspotname}}", desc: "Nom du routeur (= $hotspotname)" },
  { name: "{{dnsname}}", desc: "Contact du routeur — pied de ticket (= $dnsname)" },
  { name: "{{color}}", desc: "Couleur calculée selon le prix (= $color)" },
  { name: "{{price}}", desc: "Prix affiché (= $getprice)" },
  { name: "{{currency}}", desc: "Devise — ex: FCFA (= $currency)" },
  { name: "{{codeblock}}", desc: "Bloc Code Ticket ou Compte Utilisateur selon le mode (= if $usermode)" },
  { name: "{{username}}", desc: "Identifiant de connexion (= $username)" },
  { name: "{{password}}", desc: "Mot de passe — Mode Compte uniquement (= $password)" },
  { name: "{{validity}}", desc: "Validité formatée (= $validity)" },
  { name: "{{timelimit}}", desc: "Durée de session formatée (= $timelimit)" },
  { name: "{{datalimit}}", desc: "Limite de données (= $datalimit)" },
  { name: "{{qrcode}}", desc: "URL de l'image QR code (= src du img)" },
  { name: "{{num}}", desc: "Numéro séquentiel du ticket (= $num)" },
];

export default function TicketTemplate() {
  const { toast } = useToast();
  const [code, setCode] = useState<string>(
    () => { try { return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE; } catch { return DEFAULT_TEMPLATE; } }
  );
  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saved, setSaved] = useState(false);

  const hasCustom = (() => { try { return localStorage.getItem(TEMPLATE_KEY) !== null; } catch { return false; } })();

  const handleSave = useCallback(() => {
    try { localStorage.setItem(TEMPLATE_KEY, code); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    toast({ title: "Modèle sauvegardé", description: "Appliqué à toutes les impressions." });
  }, [code, toast]);

  const handleReset = useCallback(() => {
    setCode(DEFAULT_TEMPLATE);
    try { localStorage.removeItem(TEMPLATE_KEY); } catch { /* ignore */ }
    toast({ title: "Modèle réinitialisé", description: "Le modèle par défaut a été restauré." });
  }, [toast]);

  const previewHtml = applyVars(code, SAMPLE_VARS);
  const previewHtml2 = applyVars(code, {
    ...SAMPLE_VARS,
    username: "xyz67890",
    password: "xyz67890",
    price: "1000",
    color: "#F75418",
    num: "2",
    codeblock: CODEBLOCK_VC("#F75418", "xyz67890"),
    qrcode: `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=xyz67890&margin=2`,
    validity: "Validité : 30 Minutes",
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCode className="h-6 w-6 text-blue-500" />
            Modèle de ticket
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Code HTML du ticket — les variables <code className="text-xs bg-gray-100 px-1 rounded">{"{{var}}"}</code> remplacent les valeurs dynamiques (équivalent PHP)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasCustom && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50">
              <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
            </Button>
          )}
          <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={saved}>
            <Save className="h-3.5 w-3.5" />
            {saved ? "Sauvegardé ✓" : "Sauvegarder"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ── Editor ── */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Code HTML du ticket</CardTitle>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setTab("code")} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "code" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    <Code2 className="h-3 w-3" /> Code
                  </button>
                  <button onClick={() => setTab("preview")} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    <Eye className="h-3 w-3" /> Aperçu
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tab === "code" ? (
                <textarea
                  className="w-full font-mono text-xs bg-gray-950 text-green-300 p-4 resize-none focus:outline-none rounded-b-xl leading-relaxed"
                  style={{ minHeight: "520px" }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <div className="p-6 bg-gray-50 rounded-b-xl min-h-64 flex flex-wrap gap-2">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  <div dangerouslySetInnerHTML={{ __html: previewHtml2 }} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Reference panel ── */}
        <div className="xl:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Variables disponibles</CardTitle>
              <p className="text-xs text-gray-400">Équivalent des variables PHP <code className="bg-gray-100 px-1 rounded">$var</code></p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {VARIABLES.map((v) => (
                  <div key={v.name} className="flex items-start gap-3 px-4 py-2">
                    <code className="text-xs font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 whitespace-nowrap">
                      {v.name}
                    </code>
                    <span className="text-xs text-gray-500">{v.desc}</span>
                  </div>
                ))}
              </div>
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
