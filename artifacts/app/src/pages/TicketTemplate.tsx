import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, RotateCcw, Save, Eye, Code2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TEMPLATE_KEY = "voucher-ticket-template";

export const DEFAULT_TEMPLATE = `<table style="display:inline-block;border-collapse:collapse;border:1px solid #444;width:215px;overflow:hidden;position:relative;margin:1px;font-family:Arial,sans-serif;vertical-align:top;">
  <tbody>
    <tr>
      <td colspan="2" style="background:{{color}};padding:0;">
        <div style="text-align:center;color:#fff;font-size:10px;font-weight:bold;margin:1px;padding:2.5px;">{{hotspotname}}</div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0;position:relative;overflow:hidden;height:26px;">
        <div style="position:absolute;top:0;right:0;width:0;height:0;border-top:52px solid transparent;border-left:50px solid transparent;border-right:170px solid #DCDCDC;"></div>
        <div style="position:absolute;right:4px;top:4px;font-weight:bold;color:{{color}};text-align:right;">
          <span style="font-size:11px;">{{price}}</span>
          <span style="font-size:8px;color:#888;"> FCFA</span>
        </div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tbody>
            <tr>
              <td style="width:115px;vertical-align:top;">
                <div style="color:#555;margin-top:5px;margin-bottom:2.5px;">
                  <div style="border-bottom:1px solid #ccc;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>
                  <div style="padding:2px 0;text-align:center;font-weight:bold;font-size:17px;color:{{color}};">{{username}}</div>
                </div>
                <div style="text-align:center;color:#111;font-size:7px;font-weight:bold;padding:2.5px;line-height:1.3;">Veuillez conserver ce ticket jusqu'à l'épuisement du forfait. En cas de litige, elle atteste votre véracité. Aucune réclamation ne sera prise en compte sans présentation de ce bon d'achat.</div>
              </td>
              <td style="width:100px;text-align:right;vertical-align:top;padding-right:2px;">
                <div style="font-size:7px;font-weight:bold;color:#000;padding:2px 2.5px;text-align:right;">{{validity}}</div>
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=60x60&data={{username}}&margin=2" alt="QR" style="display:block;margin-left:auto;border:1px solid {{color}};border-radius:3px;width:50px;height:50px;margin-right:1px;" />
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="background:{{color}};padding:0;">
        <div style="display:flex;justify-content:space-between;color:#fff;font-size:8px;font-weight:bold;padding:2.5px;">
          <span>{{dnsname}}</span>
          <span>[{{num}}]</span>
        </div>
      </td>
    </tr>
  </tbody>
</table>`;

const SAMPLE = {
  hotspotname: "MON HOTSPOT WIFI",
  dnsname: "Tel: +243 XX XXX XXXX",
  username: "abc12345",
  password: "abc12345",
  price: "500",
  validity: "Validité : 1 Jour(s)",
  num: "1",
  profile: "default",
  color: "#ECA352",
};

function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    tpl
  );
}

const VARIABLES = [
  { name: "{{hotspotname}}", desc: "Nom du routeur" },
  { name: "{{dnsname}}", desc: "Contact du routeur (pied de ticket)" },
  { name: "{{username}}", desc: "Code / Identifiant de connexion" },
  { name: "{{password}}", desc: "Mot de passe (Mode Compte)" },
  { name: "{{price}}", desc: "Prix en FCFA" },
  { name: "{{validity}}", desc: "Durée de validité formatée" },
  { name: "{{profile}}", desc: "Nom du forfait MikroTik" },
  { name: "{{color}}", desc: "Couleur calculée selon le prix" },
  { name: "{{num}}", desc: "Numéro séquentiel du ticket" },
];

export default function TicketTemplate() {
  const { toast } = useToast();
  const [code, setCode] = useState<string>(
    () => localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE
  );
  const [tab, setTab] = useState<"code" | "preview">("code");
  const [saved, setSaved] = useState(false);

  const isCustom = localStorage.getItem(TEMPLATE_KEY) !== null;

  const handleSave = useCallback(() => {
    localStorage.setItem(TEMPLATE_KEY, code);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    toast({ title: "Modèle sauvegardé", description: "Il sera utilisé pour toutes les impressions." });
  }, [code, toast]);

  const handleReset = useCallback(() => {
    setCode(DEFAULT_TEMPLATE);
    localStorage.removeItem(TEMPLATE_KEY);
    toast({ title: "Modèle réinitialisé", description: "Le modèle par défaut a été restauré." });
  }, [toast]);

  const previewHtml = applyTemplate(code, SAMPLE);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileCode className="h-6 w-6 text-blue-500" />
            Modèle de ticket
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Personnalisez le code HTML affiché à l'impression des vouchers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
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
        {/* ── Editor panel ── */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Code HTML du ticket</CardTitle>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setTab("code")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      tab === "code" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <Code2 className="h-3 w-3" /> Code
                  </button>
                  <button
                    onClick={() => setTab("preview")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      tab === "preview" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <Eye className="h-3 w-3" /> Aperçu
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tab === "code" ? (
                <textarea
                  className="w-full font-mono text-xs bg-gray-950 text-green-300 p-4 resize-none focus:outline-none rounded-b-xl"
                  style={{ minHeight: "520px" }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <div className="p-6 bg-gray-50 rounded-b-xl min-h-64 flex flex-wrap gap-2">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  <div dangerouslySetInnerHTML={{ __html: previewHtml.replace("abc12345", "xyz67890").replace("[1]", "[2]") }} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Variables reference ── */}
        <div className="xl:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Variables disponibles</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {VARIABLES.map((v) => (
                  <div key={v.name} className="flex items-start gap-3 px-4 py-2.5">
                    <code className="text-xs font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
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
                  ["0", "#E50877"], ["100", "#752CEB"], ["200", "#804000"],
                  ["300", "#13C013"], ["500", "#ECA352"], ["1000", "#F75418"],
                  ["1500", "#FF69B4"], ["2500", "#F70000"], ["3000", "#F70000"],
                  ["13000", "#2E8B57"], ["17000", "#0000FF"],
                  ["35000", "#6495ED"], ["80000", "#FF8C00"],
                  ["160000", "#DC143C"],
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
