import { useState } from "react";
import { Ghost, Trash2, CheckCircle, AlertTriangle, Loader2, ShieldCheck, Router, History } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Larger batches → fewer round-trips → less risk of network "load failed".
// Backend caps this at 500.
const SCRIPT_PURGE_BATCH_SIZE = 200;
// Per-request timeout (ms): MikroTik can be slow on big batches.
const SCRIPT_PURGE_REQUEST_TIMEOUT = 60_000;
// Number of retries for a single batch on transient network failures.
const SCRIPT_PURGE_MAX_RETRIES = 3;

/**
 * Returns true for the few error shapes the browser uses for transient
 * network failures: AbortError (our timeout fired), or TypeError thrown by
 * `fetch()` itself when the network layer fails ("Failed to fetch" on
 * Chromium/Firefox, "Load failed" on Safari/WebKit, NetworkError on others).
 * Any other thrown error is treated as non-transient and not retried.
 */
function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  if (err instanceof TypeError) return true; // fetch network failure
  return false;
}

/**
 * Fetch with timeout + retry for transient network errors only.
 * "load failed" / "Failed to fetch" / aborts → retry with small backoff.
 * HTTP errors (non-2xx) are returned as-is so the caller can decide.
 * Non-transient thrown errors are re-thrown immediately.
 */
async function fetchScriptPurgeBatch(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SCRIPT_PURGE_MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SCRIPT_PURGE_REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // Only retry on real transient network errors. Re-throw everything else
      // (programming errors, etc.) immediately so we don't mask bugs.
      if (!isTransientFetchError(err)) throw err;
      if (attempt < SCRIPT_PURGE_MAX_RETRIES) {
        // Exponential-ish backoff: 400ms, 900ms, 1600ms
        await new Promise((r) => setTimeout(r, 400 + attempt * 500));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Échec réseau (load failed)");
}

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

type ScriptPurgeBatchResponse = {
  cutoff: string;
  keptMonths: string;
  router: { routerId: number; routerName: string; routerHost: string };
  batchSize: number;
  done: boolean;
  removed: number;
  failed: number;
  scanned: number;       // total candidates remaining at start of this batch
  remaining: number;     // candidates still to process after this batch
  byMonth: Array<{ yearMonth: string; count: number }>;
  cacheRowsDeleted: number;
};

type ScriptPurgeSummary = {
  routerName: string;
  routerHost: string;
  totalRemoved: number;
  totalFailed: number;
  cacheRowsDeleted: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  /** "clean": all candidates removed, cache purged.
   *  "partial": stopped with failures or no-progress; cache NOT purged. */
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

  // Old sales scripts purge — batched with progress
  const [scriptRunning,  setScriptRunning]  = useState(false);
  const [scriptProgress, setScriptProgress] = useState<{ done: number; total: number } | null>(null);
  const [scriptSummary,  setScriptSummary]  = useState<ScriptPurgeSummary | null>(null);
  const [scriptError,    setScriptError]    = useState<string | null>(null);
  const [confirmScript,  setConfirmScript]  = useState(false);

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

  async function runScriptPurge() {
    if (!selectedRouterId) {
      setScriptError("Aucun routeur sélectionné");
      return;
    }
    setScriptRunning(true);
    setScriptSummary(null);
    setScriptError(null);
    setScriptProgress(null);

    let totalRemoved = 0;
    let totalFailed = 0;
    let cacheRowsDeleted = 0;
    let total = 0;
    let lastRemaining = 0;
    let cleanFinish = false;
    let routerName = selectedRouter?.name ?? "";
    let routerHost = selectedRouter?.host ?? "";
    const byMonthMap = new Map<string, number>();

    try {
      // Loop until backend reports done. Each call deletes at most BATCH scripts.
      // Defensive cap to avoid an infinite loop if something is wrong.
      for (let i = 0; i < 10_000; i++) {
        const res = await fetchScriptPurgeBatch(`${BASE}/api/admin/purge-old-sales-scripts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            routerId: selectedRouterId,
            batchSize: SCRIPT_PURGE_BATCH_SIZE,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const batch: ScriptPurgeBatchResponse = await res.json();

        // First successful response sets the total target (= scanned of batch 1)
        if (i === 0) total = batch.scanned;
        routerName = batch.router.routerName;
        routerHost = batch.router.routerHost;

        totalRemoved    += batch.removed;
        totalFailed     += batch.failed;
        cacheRowsDeleted = batch.cacheRowsDeleted; // only set on final clean batch
        lastRemaining    = batch.remaining;
        for (const m of batch.byMonth) byMonthMap.set(m.yearMonth, (byMonthMap.get(m.yearMonth) ?? 0) + m.count);

        // Progress bar = removed-only (real progress); cap at total.
        setScriptProgress({
          done:  Math.min(totalRemoved, Math.max(total, totalRemoved)),
          total: Math.max(total, totalRemoved),
        });

        if (batch.done) {
          cleanFinish = true;
          break;
        }
        // Safety: if no script was actually removed in this batch, stop —
        // either failures are blocking deletion, or there is nothing left
        // to remove. Either way, looping further would not make progress.
        if (batch.removed === 0) break;
      }

      const byMonth = Array.from(byMonthMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([yearMonth, count]) => ({ yearMonth, count }));

      setScriptSummary({
        routerName,
        routerHost,
        totalRemoved,
        totalFailed,
        cacheRowsDeleted,
        byMonth,
        status: cleanFinish ? "clean" : "partial",
        remaining: lastRemaining,
      });
    } catch (err: unknown) {
      setScriptError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setScriptRunning(false);
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

      {/* ── Purge fantômes ─────────────────────────────────────── */}
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
        <CardContent className="space-y-4">
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
            Supprime sur le <span className="text-white font-medium">routeur sélectionné</span>{" "}
            les scripts MikHmon de ventes les plus anciens, par lots de{" "}
            {SCRIPT_PURGE_BATCH_SIZE}, en commençant par les plus vieux.{" "}
            <span className="text-green-400 font-medium">Conservés :</span> mois en cours
            et mois précédent.
            <br />
            Les entrées correspondantes du cache local sont également purgées en fin
            d'opération.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

          {scriptProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {scriptRunning ? "Suppression en cours…" : "Terminé"}
                </span>
                <span className="text-gray-300 font-mono">
                  {scriptProgress.done} / {scriptProgress.total}
                  {scriptProgress.total > 0 && (
                    <span className="text-gray-500 ml-2">
                      ({Math.round((scriptProgress.done / scriptProgress.total) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full transition-all duration-300 ${
                    scriptRunning ? "bg-purple-500" : "bg-green-500"
                  }`}
                  style={{
                    width: `${
                      scriptProgress.total > 0
                        ? Math.min(100, Math.round((scriptProgress.done / scriptProgress.total) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

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
                      : "Aucun script supprimé"}
                    {scriptSummary.totalFailed > 0 && (
                      <span className="ml-2">
                        — {scriptSummary.totalFailed} échec{scriptSummary.totalFailed > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {partial && (
                    <div className="text-xs font-normal mt-1 text-yellow-200/80">
                      Suppression incomplète : {scriptSummary.remaining} script
                      {scriptSummary.remaining > 1 ? "s" : ""} restant
                      {scriptSummary.remaining > 1 ? "s" : ""} sur le routeur. Le cache local
                      n'a pas été purgé. Réessayez après vérification (router accessible,
                      droits, etc.).
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
