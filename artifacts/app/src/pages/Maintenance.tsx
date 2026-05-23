import { useState } from "react";
import { Ghost, Trash2, CheckCircle, AlertTriangle, Loader2, ShieldCheck, Router, History, WifiOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  runScriptPurgeWithAutoResume,
  type ScriptPurgeProgressState,
} from "@/lib/script-purge-batches";

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

type ScriptPurgeSummary = {
  routerName: string;
  routerHost: string;
  totalRemoved: number;
  totalFailed: number;
  cacheRowsDeleted: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  status: "clean" | "partial";
  remaining: number;
};

const MONTH_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function fmtYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_FR[mi] ?? m} ${y}`;
}

export default function Maintenance() {
  const { role, token } = useAuth();
  const { selectedRouterId, selectedRouter } = useRouterContext();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PurgeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptPaused, setScriptPaused] = useState(false);
  const [scriptProgress, setScriptProgress] = useState<ScriptPurgeProgressState | null>(null);
  const [scriptSummary, setScriptSummary] = useState<ScriptPurgeSummary | null>(null);
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
    if (!selectedRouterId) {
      setError("Aucun routeur sélectionné");
      return;
    }
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
        body: JSON.stringify({ routerId: selectedRouterId }),
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

  /** Purge par mois avec pause + reprise auto si le routeur est injoignable (comme lot-disable). */
  async function runScriptPurge() {
    if (!selectedRouterId || !token) {
      setScriptError("Aucun routeur sélectionné");
      return;
    }
    setScriptRunning(true);
    setScriptPaused(false);
    setScriptSummary(null);
    setScriptError(null);
    setScriptProgress({ done: 0, total: 1 });

    try {
      const result = await runScriptPurgeWithAutoResume(BASE, token, selectedRouterId, {
        onProgress: setScriptProgress,
        onPaused: setScriptPaused,
      });

      setScriptSummary({
        routerName: result.router.routerName,
        routerHost: result.router.routerHost,
        totalRemoved: result.totalRemoved,
        totalFailed: result.totalFailed,
        cacheRowsDeleted: result.cacheRowsDeleted,
        byMonth: result.byMonth,
        status: result.status,
        remaining: result.remaining,
      });
    } catch (err: unknown) {
      setScriptError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setScriptRunning(false);
      setScriptPaused(false);
      setScriptProgress(null);
    }
  }

  const totalDeleted = data?.totalDeleted ?? 0;
  const hasResults = !!data;

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

      <Card className="bg-[#141414] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <Ghost className="h-4 w-4 text-orange-400" />
            Vouchers fantômes
          </CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Supprime sur le <span className="text-white font-medium">routeur sélectionné</span>{" "}
            les vouchers en base de données marqués comme non vendus mais absents de MikroTik.
            Seuls les vouchers sans{" "}
            <code className="text-xs bg-white/10 px-1 rounded">usedAt</code> sont traités.
            <br />
            <span className="text-yellow-400 font-medium">Garde de sécurité :</span>{" "}
            si MikroTik retourne 0 utilisateurs (routeur injoignable), le routeur est ignoré.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={runPurge}
              disabled={loading || !selectedRouterId}
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
            {selectedRouter ? (
              <span className="text-xs text-gray-400 inline-flex items-center gap-1.5">
                <Router className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-white">{selectedRouter.name ?? selectedRouter.host}</span>
                <span className="text-gray-500">{selectedRouter.host}</span>
              </span>
            ) : (
              <span className="text-xs text-yellow-400/80">
                Sélectionnez un routeur dans la barre latérale.
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {hasResults && (
            <div className="space-y-3">
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

      <Card className="bg-[#141414] border-white/[0.06]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <History className="h-4 w-4 text-purple-400" />
            Anciens scripts de ventes
          </CardTitle>
          <CardDescription className="text-gray-400 text-sm">
            Supprime sur le <span className="text-white font-medium">routeur sélectionné</span>{" "}
            les scripts MikHmon de ventes les plus anciens, en commençant par les plus vieux.{" "}
            <span className="text-green-400 font-medium">Conservés :</span> mois en cours
            et mois précédent.
            <br />
            En cas de perte de connexion routeur, l&apos;opération se met en pause et reprend
            automatiquement dès que le routeur répond à nouveau.
            <br />
            La base PostgreSQL locale n&apos;est pas modifiée : seuls les scripts sur le
            routeur sont supprimés.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={() => setConfirmScript(true)}
              disabled={scriptRunning || !selectedRouterId}
              variant="destructive"
              className="gap-2"
            >
              {scriptRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {scriptRunning ? "Suppression en cours…" : "Supprimer les anciens scripts"}
            </Button>
            {selectedRouter ? (
              <span className="text-xs text-gray-400 inline-flex items-center gap-1.5">
                <Router className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-white">{selectedRouter.name ?? selectedRouter.host}</span>
                <span className="text-gray-500">{selectedRouter.host}</span>
              </span>
            ) : (
              <span className="text-xs text-yellow-400/80">
                Sélectionnez un routeur dans la barre latérale.
              </span>
            )}
          </div>

          {scriptError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {scriptError}
            </div>
          )}

          {scriptProgress && scriptRunning && (() => {
            const pct = Math.round(
              (scriptProgress.done / Math.max(1, scriptProgress.total)) * 100,
            );
            return (
            <div className="space-y-2 rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2.5">
              <div className="flex items-center justify-between text-xs gap-2">
                {scriptPaused ? (
                  <span className="flex items-center gap-1.5 text-amber-400 font-medium min-w-0">
                    <WifiOff className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Routeur inaccessible — reprise automatique…</span>
                  </span>
                ) : (
                  <span className="text-gray-400 flex items-center gap-1.5 min-w-0">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-purple-400" />
                    <span className="truncate">
                      {scriptProgress.currentYearMonth
                        ? `Mois ${fmtYearMonth(scriptProgress.currentYearMonth)}…`
                        : "Suppression en cours…"}
                    </span>
                  </span>
                )}
                <span className="text-gray-300 font-mono shrink-0 tabular-nums">
                  {scriptProgress.done} / {scriptProgress.total}
                  <span className="text-gray-500 ml-1">({pct}%)</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full transition-all duration-300 ${
                    scriptPaused ? "bg-amber-500" : "bg-purple-500"
                  }`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
            );
          })()}

          {scriptSummary && !scriptRunning && (() => {
            const partial = scriptSummary.status === "partial";
            const banner = partial
              ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300"
              : scriptSummary.totalRemoved > 0
                ? "bg-red-500/10 border-red-500/20 text-red-300"
                : "bg-green-500/10 border-green-500/20 text-green-300";
            return (
            <div className="space-y-3">
              <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${banner}`}>
                {partial ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                ) : scriptSummary.totalRemoved > 0 ? (
                  <Trash2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div>
                    {scriptSummary.totalRemoved > 0
                      ? `${scriptSummary.totalRemoved} script${scriptSummary.totalRemoved > 1 ? "s" : ""} supprimé${scriptSummary.totalRemoved > 1 ? "s" : ""}`
                      : "Aucun ancien script à supprimer"}
                    {scriptSummary.totalFailed > 0 && (
                      <span className="ml-2">
                        — {scriptSummary.totalFailed} échec{scriptSummary.totalFailed > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {partial && (
                    <div className="text-xs font-normal mt-1 text-yellow-200/80">
                      Suppression incomplète ({scriptSummary.remaining} échec
                      {scriptSummary.remaining > 1 ? "s" : ""}). Réessayez ou vérifiez l'accès routeur.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <Router className="h-4 w-4 mt-0.5 text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{scriptSummary.routerName}</span>
                    <span className="text-xs text-gray-500">{scriptSummary.routerHost}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {scriptSummary.cacheRowsDeleted} ligne{scriptSummary.cacheRowsDeleted > 1 ? "s" : ""} purgée{scriptSummary.cacheRowsDeleted > 1 ? "s" : ""} du cache local
                  </p>
                  {scriptSummary.byMonth.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {scriptSummary.byMonth.map((m) => (
                        <span
                          key={m.yearMonth}
                          className="text-[10px] bg-white/[0.04] text-gray-400 border border-white/[0.06] rounded px-1.5 py-0.5"
                        >
                          {fmtYearMonth(m.yearMonth)} : {m.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })()}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={confirmScript}
        onOpenChange={setConfirmScript}
        title="Supprimer les anciens scripts ?"
        description="Cette action supprime définitivement les scripts de ventes MikHmon antérieurs au mois précédent sur le routeur sélectionné, ainsi que les entrées du cache local. Les scripts du mois en cours et du mois précédent sont conservés."
        onConfirm={() => { setConfirmScript(false); runScriptPurge(); }}
        confirmLabel="Confirmer la suppression"
      />
    </div>
  );
}
