import { useState } from "react";
import { Ghost, Trash2, CheckCircle, AlertTriangle, Loader2, ShieldCheck, Router, History } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type PurgeResult = {
  routerId: number;
  routerHost: string;
  routerName: string;
  skipped: boolean;
  reason?: string;
  activeUsersCount: number;
  unsoldInDb: number;
  deleted: number;
};

type PurgeResponse = {
  results: PurgeResult[];
  totalDeleted: number;
};

type ScriptPurgeResult = {
  routerId: number;
  routerName: string;
  routerHost: string;
  skipped: boolean;
  reason?: string;
  removed: number;
  failed: number;
  cacheRowsDeleted: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
};

type ScriptPurgeResponse = {
  cutoff: string;
  keptMonths: string;
  results: ScriptPurgeResult[];
  totalRemoved: number;
  totalFailed: number;
};

const MONTH_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function fmtYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_FR[mi] ?? m} ${y}`;
}

export default function Maintenance() {
  const { role, token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PurgeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Old sales scripts purge state
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptData, setScriptData] = useState<ScriptPurgeResponse | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [confirmScript, setConfirmScript] = useState(false);

  if (role !== "admin") {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Accès réservé à l'administrateur
      </div>
    );
  }

  async function runPurge() {
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/admin/purge-phantoms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const json: PurgeResponse = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function runScriptPurge() {
    setScriptLoading(true);
    setScriptData(null);
    setScriptError(null);
    try {
      const res = await fetch(`${BASE}/api/admin/purge-old-sales-scripts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const json: ScriptPurgeResponse = await res.json();
      setScriptData(json);
    } catch (err: unknown) {
      setScriptError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setScriptLoading(false);
    }
  }

  const totalDeleted = data?.totalDeleted ?? 0;
  const hasResults = !!data;
  const totalScriptRemoved = scriptData?.totalRemoved ?? 0;
  const totalScriptFailed  = scriptData?.totalFailed  ?? 0;
  const hasScriptResults   = !!scriptData;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-400" />
          Maintenance
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Outils de nettoyage et de diagnostic de la base de données
        </p>
      </div>

      {/* ── Purge fantômes ─────────────────────────────────────── */}
      <Card className="bg-[#141414] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Ghost className="h-4 w-4 text-orange-400" />
            Vouchers fantômes
          </CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Supprime les vouchers en base de données marqués comme non vendus mais absents de
            MikroTik. Seuls les vouchers sans <code className="text-xs bg-white/10 px-1 rounded">usedAt</code> sont traités.
            <br />
            <span className="text-yellow-400 font-medium">
              Garde de sécurité :
            </span>{" "}
            si MikroTik retourne 0 utilisateurs (routeur injoignable), le routeur est ignoré.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={runPurge}
            disabled={loading}
            variant="destructive"
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {loading ? "Purge en cours…" : "Lancer la purge des fantômes"}
          </Button>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {hasResults && (
            <div className="space-y-3">
              {/* Summary banner */}
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${
                  totalDeleted > 0
                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                    : "bg-green-500/10 border-green-500/20 text-green-300"
                }`}
              >
                {totalDeleted > 0 ? (
                  <Trash2 className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle className="h-4 w-4 shrink-0" />
                )}
                {totalDeleted > 0
                  ? `${totalDeleted} voucher${totalDeleted > 1 ? "s" : ""} fantôme${totalDeleted > 1 ? "s" : ""} supprimé${totalDeleted > 1 ? "s" : ""}`
                  : "Aucun voucher fantôme trouvé — base propre"}
              </div>

              {/* Per-router breakdown */}
              <div className="space-y-2">
                {data?.results.map((r) => (
                  <div
                    key={r.routerId}
                    className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <Router className="h-4 w-4 mt-0.5 text-gray-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{r.routerName}</span>
                        <span className="text-xs text-gray-500">{r.routerHost}</span>
                        {r.skipped && (
                          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-[10px]">
                            Ignoré
                          </Badge>
                        )}
                        {!r.skipped && r.deleted > 0 && (
                          <Badge variant="outline" className="text-red-400 border-red-500/30 text-[10px]">
                            −{r.deleted} supprimé{r.deleted > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {!r.skipped && r.deleted === 0 && (
                          <Badge variant="outline" className="text-green-400 border-green-500/30 text-[10px]">
                            Propre
                          </Badge>
                        )}
                      </div>
                      {r.skipped ? (
                        <p className="text-xs text-yellow-400/70 mt-0.5">{r.reason}</p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {r.activeUsersCount} utilisateurs MikroTik · {r.unsoldInDb} non vendus en DB
                          {r.deleted > 0 ? ` → ${r.deleted} fantôme${r.deleted > 1 ? "s" : ""} purgé${r.deleted > 1 ? "s" : ""}` : " → aucun fantôme"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Purge des anciens scripts de ventes ─────────────────────── */}
      <Card className="bg-[#141414] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <History className="h-4 w-4 text-purple-400" />
            Anciens scripts de ventes
          </CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Supprime sur chaque routeur les scripts MikHmon de ventes les plus anciens, en
            commençant par les plus vieux.{" "}
            <span className="text-green-400 font-medium">Conservés :</span> mois en cours
            et mois précédent.
            <br />
            Les entrées correspondantes du cache local sont également purgées.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => setConfirmScript(true)}
            disabled={scriptLoading}
            variant="destructive"
            className="gap-2"
          >
            {scriptLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {scriptLoading ? "Suppression en cours…" : "Supprimer les anciens scripts"}
          </Button>

          {scriptError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {scriptError}
            </div>
          )}

          {hasScriptResults && (
            <div className="space-y-3">
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${
                  totalScriptRemoved > 0
                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                    : "bg-green-500/10 border-green-500/20 text-green-300"
                }`}
              >
                {totalScriptRemoved > 0 ? (
                  <Trash2 className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle className="h-4 w-4 shrink-0" />
                )}
                {totalScriptRemoved > 0
                  ? `${totalScriptRemoved} script${totalScriptRemoved > 1 ? "s" : ""} supprimé${totalScriptRemoved > 1 ? "s" : ""}`
                  : "Aucun script à supprimer — rien antérieur au mois précédent"}
                {totalScriptFailed > 0 && (
                  <span className="ml-2 text-yellow-300">
                    ({totalScriptFailed} échec{totalScriptFailed > 1 ? "s" : ""})
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {scriptData?.results.map((r) => (
                  <div
                    key={r.routerId}
                    className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <Router className="h-4 w-4 mt-0.5 text-gray-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{r.routerName}</span>
                        <span className="text-xs text-gray-500">{r.routerHost}</span>
                        {r.skipped && (
                          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-[10px]">
                            Ignoré
                          </Badge>
                        )}
                        {!r.skipped && r.removed > 0 && (
                          <Badge variant="outline" className="text-red-400 border-red-500/30 text-[10px]">
                            −{r.removed} script{r.removed > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {!r.skipped && r.removed === 0 && (
                          <Badge variant="outline" className="text-green-400 border-green-500/30 text-[10px]">
                            Rien à purger
                          </Badge>
                        )}
                        {!r.skipped && r.failed > 0 && (
                          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-[10px]">
                            {r.failed} échec{r.failed > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      {r.skipped ? (
                        <p className="text-xs text-yellow-400/70 mt-0.5">{r.reason}</p>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {r.cacheRowsDeleted} ligne{r.cacheRowsDeleted > 1 ? "s" : ""} purgée{r.cacheRowsDeleted > 1 ? "s" : ""} du cache local
                          </p>
                          {r.byMonth.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {r.byMonth.map((m) => (
                                <span
                                  key={m.yearMonth}
                                  className="text-[10px] bg-white/[0.04] text-gray-400 border border-white/[0.06] rounded px-1.5 py-0.5"
                                >
                                  {fmtYearMonth(m.yearMonth)} : {m.count}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmScript} onOpenChange={setConfirmScript}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer les anciens scripts ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action supprime définitivement les scripts de ventes MikHmon antérieurs au
              mois précédent sur chaque routeur, ainsi que les entrées correspondantes du cache
              local. Les scripts du mois en cours et du mois précédent sont conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { setConfirmScript(false); runScriptPurge(); }}
            >
              Confirmer la suppression
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
