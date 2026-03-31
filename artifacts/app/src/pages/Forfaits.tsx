import { useState } from "react";
import { useListRouters, useListRouterProfiles } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PackageOpen, Clock, Banknote, Users, Wifi, Lock } from "lucide-react";

function formatValidity(v: string | null | undefined): string {
  if (!v) return "Illimité";
  return v
    .replace(/(\d+)h/, "$1 heure(s)")
    .replace(/(\d+)d/, "$1 jour(s)")
    .replace(/(\d+)w/, "$1 semaine(s)");
}

export default function Forfaits() {
  const { data: routers = [], isLoading: loadingRouters } = useListRouters();
  const [routerId, setRouterId] = useState<string>("");

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    parseInt(routerId, 10),
    { query: { enabled: !!routerId } },
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Forfaits</h1>
        <p className="text-sm text-gray-500">Profils hotspot disponibles sur vos routeurs MikroTik</p>
      </div>

      <div className="mb-6 max-w-xs">
        <Select value={routerId} onValueChange={setRouterId} disabled={loadingRouters}>
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

      {!routerId && (
        <Card>
          <CardContent className="py-16 text-center">
            <PackageOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur</p>
            <p className="text-sm text-gray-400 mt-1">Les forfaits disponibles s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {routerId && loadingProfiles && (
        <div className="text-sm text-gray-400">Chargement des forfaits...</div>
      )}

      {routerId && !loadingProfiles && profiles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">Aucun profil trouvé sur ce routeur.</p>
          </CardContent>
        </Card>
      )}

      {profiles.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-4">{profiles.length} forfait(s) trouvé(s)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {profiles.map((p) => (
              <Card key={p.name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-base font-bold text-gray-900 truncate" title={p.name}>
                    {p.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-gray-700">{formatValidity(p.validity)}</span>
                  </div>

                  {p.price && p.price !== "0" ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Banknote className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      <span className="text-gray-700 font-semibold">{p.price} FCFA</span>
                    </div>
                  ) : null}

                  {p.sharedUsers && (
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                      <span className="text-gray-700">{p.sharedUsers} appareil(s)</span>
                    </div>
                  )}

                  {p.rateLimit && (
                    <div className="flex items-center gap-2 text-sm">
                      <Wifi className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                      <span className="text-gray-600 text-xs font-mono">{p.rateLimit}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.lockMac && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 gap-1">
                        <Lock className="h-2.5 w-2.5" /> MAC verrouillé
                      </Badge>
                    )}
                    {(!p.price || p.price === "0") && (
                      <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">
                        Promo / Gratuit
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
