import { useState, useEffect } from "react";
import {
  useListRouterSessions,
  useDisconnectRouterSession,
} from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Activity, RefreshCw, Wifi, Users, Search, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { foldText } from "@/lib/text";

// Module-level cache — persists across component unmount/remount (navigating away and back).
// Provides instant display via initialData so the session list never shows a loading skeleton on re-visit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _sessionsCache: Record<number, { sessions?: any[]; ts?: number }> = {};
const SESSIONS_CACHE_KEY = "sessions-cache:v1";

function formatBytes(bytes: string | null | undefined): string {
  if (!bytes) return "—";
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function Sessions() {
  const { selectedRouterId } = useRouterContext();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [disconnectUser, setDisconnectUser] = useState<string | null>(null);
  const cachedSnapshot = selectedRouterId != null
    ? (_sessionsCache[selectedRouterId] ?? (() => {
      try {
        const raw = localStorage.getItem(`${SESSIONS_CACHE_KEY}:${selectedRouterId}`);
        return raw ? JSON.parse(raw) as { sessions?: unknown[]; ts?: number } : undefined;
      } catch {
        return undefined;
      }
    })())
    : undefined;

  const { data: sessions = [], isLoading, refetch, isFetching, error } = useListRouterSessions(
    selectedRouterId ?? 0,
    {
      query: {
        enabled: !!selectedRouterId,
        refetchInterval: 30_000,
        staleTime: 14_000,       // juste sous le TTL serveur (15s) → pas de double-fetch inutile
        gcTime: 30 * 60_000,     // garde les données 30 min en mémoire React Query
        initialData: cachedSnapshot?.sessions,
        initialDataUpdatedAt: cachedSnapshot?.ts,
      },
    },
  );

  // Met à jour le cache module-level à chaque réponse réussie
  // (isLoading=false garantit qu'on a de vraies données, pas le [] par défaut)
  useEffect(() => {
    if (selectedRouterId != null && !isLoading && !error) {
      _sessionsCache[selectedRouterId] = { sessions, ts: Date.now() };
      try {
        localStorage.setItem(
          `${SESSIONS_CACHE_KEY}:${selectedRouterId}`,
          JSON.stringify({ sessions, ts: Date.now() }),
        );
      } catch {
        // ignore storage quota/private mode errors
      }
    }
  }, [sessions, selectedRouterId, isLoading, error]);

  const disconnectMutation = useDisconnectRouterSession();

  const handleDisconnect = async () => {
    if (!disconnectUser || !selectedRouterId || disconnectMutation.isPending) return;
    try {
      const result = await disconnectMutation.mutateAsync({
        id: selectedRouterId,
        data: { user: disconnectUser },
      });
      toast({
        title: `${disconnectUser} déconnecté`,
        description: `${result.removed} session(s) terminée(s)`,
      });
      if (result.removed > 0) {
        _sessionsCache[selectedRouterId] = {
          sessions: sessions.filter((s) => s.user !== disconnectUser),
          ts: Date.now(),
        };
      }
      void refetch();
    } catch {
      toast({
        title: "Erreur de déconnexion",
        description: "Impossible de déconnecter cet utilisateur",
        variant: "destructive",
      });
    } finally {
      setDisconnectUser(null);
    }
  };

  const filtered = sessions.filter((s) => {
    if (!search.trim()) return true;
    const q = foldText(search);
    return (
      foldText(s.user).includes(q) ||
      foldText(s.address ?? "").includes(q) ||
      foldText(s.macAddress ?? "").includes(q) ||
      foldText(s.server ?? "").includes(q)
    );
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients actifs</h1>
          <p className="text-sm text-gray-500">Utilisateurs connectés en temps réel sur votre hotspot</p>
        </div>
        {selectedRouterId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex-shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        {selectedRouterId && sessions.length > 0 && (
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Rechercher un client, IP, MAC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {selectedRouterId && !isLoading && (
          <Badge variant="outline" className="gap-1.5 text-green-600 border-green-200">
            <Users className="h-3 w-3" />
            {search ? `${filtered.length} / ${sessions.length}` : sessions.length} client(s)
          </Badge>
        )}
      </div>

      {!selectedRouterId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur dans la barre latérale</p>
            <p className="text-sm text-gray-400 mt-1">Les clients actifs s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && error && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-red-500 text-sm">Impossible de récupérer les clients actifs. Vérifiez la connexion au routeur.</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && !isLoading && !error && sessions.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Wifi className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucun client actif</p>
            <p className="text-sm text-gray-400 mt-1">Personne n&apos;est connecté au hotspot pour l&apos;instant</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && !isLoading && sessions.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Search className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucun résultat pour « {search} »</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && !isLoading && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              Clients connectés
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="pl-6">Utilisateur</TableHead>
                  <TableHead>Adresse IP</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Durée</TableHead>
                  <TableHead>Données ↓</TableHead>
                  <TableHead>Données ↑</TableHead>
                  <TableHead className="pr-6">Serveur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                          title={`Déconnecter ${s.user}`}
                          onClick={() => setDisconnectUser(s.user)}
                          disabled={disconnectMutation.isPending && disconnectUser === s.user}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <span className="font-mono font-semibold text-gray-900">{s.user}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-gray-600">{s.address || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">{s.macAddress || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs text-blue-600 border-blue-200">
                        {s.uptime}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatBytes(s.bytesIn)}</TableCell>
                    <TableCell className="text-sm text-gray-600">{formatBytes(s.bytesOut)}</TableCell>
                    <TableCell className="pr-6 text-sm text-gray-500">{s.server || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!disconnectUser} onOpenChange={(o) => { if (!o && !disconnectMutation.isPending) setDisconnectUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Déconnecter ce client ?</AlertDialogTitle>
            <AlertDialogDescription>
              L&apos;utilisateur <strong className="font-mono">{disconnectUser}</strong> sera déconnecté du hotspot immédiatement. Il pourra se reconnecter avec ses identifiants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDisconnect}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending
                ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Déconnexion...</span>
                : "Déconnecter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
