import { useState } from "react";
import { Ghost, Trash2, CheckCircle, AlertTriangle, Loader2, ShieldCheck, Router, History } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SCRIPT_PURGE_BATCH_SIZE = 200;
// Timeout par lot (chaque appel ne supprime qu'un batch de scripts).
const SCRIPT_PURGE_REQUEST_TIMEOUT = 180_000;
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
    const timer = setTimeout(() => {
      ctrl.abort(new DOMException(
        "Délai dépassé pendant la purge (MikroTik lent ou beaucoup de scripts). Réessayez ou réduisez le lot.",
        "AbortError",
      ));
    }, SCRIPT_PURGE_REQUEST_TIMEOUT);
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
  scanned: number;
  remaining: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  /** Total scripts éligibles (premier appel uniquement). */
  totalCandidates?: number;
  nextCursor?: { year: number; month: number } | null;
  cacheRowsDeleted?: number;
  cacheKept?: boolean;
};

type ScriptPurgeSummary = {
  routerName: string;
  routerHost: string;
  totalRemoved: number;
  totalFailed: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  /** "clean": tous les candidats supprimés ; "partial": des scripts restants. */
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
    // Afficher la barre immédiatement (mode indéterminé jusqu'au 1er lot).
    setScriptProgress({ done: 0, total: 0 });

    let totalRemoved = 0;
    let totalFailed = 0;
    let total = 0;
    let lastRemaining = 0;
    let cleanFinish = false;
    let routerName = selectedRouter?.name ?? "";
    let routerHost = selectedRouter?.host ?? "";
    const byMonthMap = new Map<string, number>();
    let cursor: { year: number; month: number } | null = null;

    try {
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
            cursor,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const batch: ScriptPurgeBatchResponse = await res.json();

        if (batch.totalCandidates != null) total = batch.totalCandidates;
        routerName = batch.router.routerName;
        routerHost = batch.router.routerHost;

        totalRemoved += batch.removed;
        totalFailed += batch.failed;
        lastRemaining = total > 0
          ? Math.max(0, total - totalRemoved)
          : batch.remaining;
        for (const m of batch.byMonth) {
          byMonthMap.set(m.yearMonth, (byMonthMap.get(m.yearMonth) ?? 0) + m.count);
        }

        setScriptProgress({
          done: totalRemoved,
          total: total > 0 ? total : Math.max(totalRemoved, 1),
        });

        if (batch.done) {
          cleanFinish = true;
          break;
        }
        if (batch.removed === 0) break;
        cursor = batch.nextCursor ?? null;
        if (cursor == null) break;
      }

      const byMonth = Array.from(byMonthMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([yearMonth, count]) => ({ yearMonth, count }));

      setScriptSummary({
        routerName,
        routerHost,
        totalRemoved,
        totalFailed,
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
            Supprime <span className="text-white font-medium">uniquement sur le MikroTik</span>{" "}
            du routeur sélectionné les scripts MikHmon de ventes anciens.{" "}
            <span className="text-green-400 font-medium">Conservés sur le routeur :</span>{" "}
            mois en cours et mois précédent.
            <br />
            <span className="text-blue-400 font-medium">Cache local conservé :</span>{" "}
            la base PostgreSQL n'est jamais purgée — l'historique reste disponible
            (dashboard, rapports, vendeurs) même après suppression sur le routeur.
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

          {(scriptRunning || scriptProgress) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">
                  {scriptRunning
                    ? ((scriptProgress?.total ?? 0) === 0 ? "Préparation…" : "Suppression en cours…")
                    : "Terminé"}
                </span>
                <span className="text-gray-300 font-mono">
                  {(scriptRunning && (scriptProgress?.total ?? 0) === 0)
                    ? "…"
                    : `${scriptProgress?.done ?? 0} / ${scriptProgress?.total ?? 0}`}
                  {(scriptProgress?.total ?? 0) > 0 && (
                    <span className="text-gray-500 ml-2">
                      ({Math.round(((scriptProgress?.done ?? 0) / (scriptProgress?.total ?? 1)) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full transition-all duration-300 ${
                    scriptRunning
                      ? (scriptProgress?.total ?? 0) === 0
                        ? "bg-purple-500/70 animate-pulse w-2/5"
                        : "bg-purple-500"
                      : "bg-green-500"
                  }`}
                  style={
                    scriptRunning && (scriptProgress?.total ?? 0) === 0
                      ? undefined
                      : {
                          width: `${
                            (scriptProgress?.total ?? 0) > 0
                              ? Math.min(100, Math.round(((scriptProgress?.done ?? 0) / (scriptProgress?.total ?? 1)) * 100))
                              : 0
                          }%`,
                        }
                  }
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
                      {scriptSummary.remaining > 1 ? "s" : ""} sur le routeur. Réessayez
                      après vérification (routeur accessible, droits, etc.). Le cache
                      local n'est pas affecté.
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
                  <p className="text-xs text-blue-400/80 mt-0.5">
                    Cache local conservé — historique des ventes intact en base.
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
        description="Cette action supprime sur le MikroTik du routeur sélectionné les scripts de ventes MikHmon antérieurs au mois précédent. Le cache local PostgreSQL n'est pas modifié : l'historique des ventes reste disponible (dashboard, rapports, vendeurs) même après suppression sur le routeur."
        onConfirm={() => { setConfirmScript(false); runScriptPurge(); }}
        confirmLabel="Confirmer la suppression"
      />
    </div>
  );
}
