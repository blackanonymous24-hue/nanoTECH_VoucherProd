import { useState, useEffect } from "react";
import { useListRouterSessions } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, RefreshCw, Wifi, Users } from "lucide-react";

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
  const { selectedRouterId, setSelectedRouterId, routers } = useRouterContext();
  const [localRouterId, setLocalRouterId] = useState<string>(
    selectedRouterId ? String(selectedRouterId) : "",
  );

  useEffect(() => {
    if (selectedRouterId && !localRouterId) {
      setLocalRouterId(String(selectedRouterId));
    }
  }, [selectedRouterId]);

  const activeId = localRouterId ? parseInt(localRouterId, 10) : null;

  const { data: sessions = [], isLoading, refetch, isFetching, error } = useListRouterSessions(
    activeId ?? 0,
    {
      query: {
        enabled: !!activeId,
        refetchInterval: 30_000,
      },
    },
  );

  const handleRouterChange = (val: string) => {
    setLocalRouterId(val);
    setSelectedRouterId(val ? parseInt(val, 10) : null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sessions actives</h1>
          <p className="text-sm text-gray-500">Utilisateurs connectés en temps réel sur votre hotspot</p>
        </div>
        {activeId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        )}
      </div>

      <div className="mb-6 flex items-center gap-4">
        <div className="w-72">
          <Select value={localRouterId} onValueChange={handleRouterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionnez un routeur" />
            </SelectTrigger>
            <SelectContent>
              {routers.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name} — {r.host}:{r.port}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {activeId && !isLoading && (
          <Badge variant="outline" className="gap-1.5 text-green-600 border-green-200">
            <Users className="h-3 w-3" />
            {sessions.length} session(s)
          </Badge>
        )}
        {activeId && (
          <span className="text-xs text-gray-400">Rafraîchissement auto toutes les 30s</span>
        )}
      </div>

      {!activeId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur</p>
            <p className="text-sm text-gray-400 mt-1">Les sessions actives s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {activeId && isLoading && (
        <div className="text-sm text-gray-400">Chargement des sessions...</div>
      )}

      {activeId && error && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-red-500 text-sm">Impossible de récupérer les sessions. Vérifiez la connexion au routeur.</p>
          </CardContent>
        </Card>
      )}

      {activeId && !isLoading && !error && sessions.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Wifi className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucune session active</p>
            <p className="text-sm text-gray-400 mt-1">Personne n&apos;est connecté au hotspot pour l&apos;instant</p>
          </CardContent>
        </Card>
      )}

      {activeId && !isLoading && sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              Sessions en cours
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
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
                {sessions.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6 font-mono font-semibold text-gray-900">{s.user}</TableCell>
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
    </div>
  );
}
