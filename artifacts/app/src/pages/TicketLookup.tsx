import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { withApiPauseCacheFallback } from "@/lib/queryFnApiPauseCache";
import { useRouterContext } from "@/contexts/RouterContext";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Ticket, User } from "lucide-react";

/**
 * Recherche « Vérifier un ticket » : base locale uniquement (bons + cache
 * mikrotik_script_sales, même source que le rapport de ventes) + stock non vendu (90 j).
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTHS = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
  "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const day   = String(d.getDate()).padStart(2, "0");
  const month = MONTHS[d.getMonth()];
  const hh    = String(d.getHours()).padStart(2, "0");
  const mm    = String(d.getMinutes()).padStart(2, "0");
  const ss    = String(d.getSeconds()).padStart(2, "0");
  return `${day} ${month} ${d.getFullYear()} ${hh}:${mm}:${ss}`;
}

type SoldTicket = {
  id: number;
  username: string;
  profileName: string;
  comment: string | null;
  price: string;
  salePrice: string | null;
  macAddress: string | null;
  saleIp: string | null;
  printedAt: string | null;
  createdAt: string;
  usedAt: string | null;
  vendorId: number | null;
  vendorName: string | null;
};

export default function TicketLookup() {
  const { selectedRouterId } = useRouterContext();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);

  const enabled = !!selectedRouterId && debouncedSearch.trim().length >= 2;

  const { data, isFetching, isError } = useQuery<{ tickets: SoldTicket[]; total: number }>({
    queryKey: ["sold-lookup", selectedRouterId, debouncedSearch],
    queryFn: withApiPauseCacheFallback(async ({ signal }) => {
      const params = new URLSearchParams({
        routerId: String(selectedRouterId),
        q: debouncedSearch.trim(),
      });
      const res = await fetch(`${BASE}/api/vouchers/sold-lookup?${params}`, { signal });
      if (!res.ok) throw new Error("Erreur serveur");
      return res.json();
    }),
    enabled,
    staleTime: 0,
    gcTime: 2 * 60 * 1000,
  });

  const tickets = data?.tickets ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20 flex-shrink-0">
          <Search className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
            Vérifier un ticket
          </h1>
        </div>
      </div>

      {/* Search card */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            {isFetching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-400 animate-spin" />
            )}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par utilisateur, MAC, IP ou commentaire…"
              className="pl-9 pr-9 h-10 text-sm"
            />
          </div>
          {search.trim().length > 0 && search.trim().length < 2 && (
            <p className="text-[11px] text-gray-400 mt-2 ml-1">Saisissez au moins 2 caractères pour lancer la recherche.</p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {enabled && !isFetching && isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-red-500">
            Erreur lors de la recherche. Veuillez réessayer.
          </CardContent>
        </Card>
      )}

      {enabled && !isFetching && !isError && tickets.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Ticket className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Aucun ticket trouvé pour <span className="font-medium">"{debouncedSearch}"</span>
            </p>
          </CardContent>
        </Card>
      )}

      {tickets.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Résultats
              </CardTitle>
              <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full tabular-nums">
                {tickets.length}{data?.total === 200 ? "+" : ""} ticket{tickets.length > 1 ? "s" : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40">
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Utilisateur</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Forfait</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Commentaire</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Prix</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">MAC</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">IP</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">État</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Vendeur</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((v, i) => {
                    const displayPrice = v.salePrice || v.price || "";
                    const isSold = !!v.usedAt;
                    return (
                      <tr
                        key={v.id}
                        className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                          i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-gray-800/20"
                        }`}
                      >
                        {/* Utilisateur */}
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">
                            {v.username}
                          </span>
                        </td>
                        {/* Forfait */}
                        <td className="px-3 py-2">
                          <span className="text-gray-600 dark:text-gray-300">{v.profileName}</span>
                        </td>
                        {/* Commentaire / Lot */}
                        <td className="px-3 py-2">
                          {v.comment ? (
                            <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                              {v.comment}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        {/* Prix */}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {displayPrice ? (
                            <span className="font-semibold text-gray-800 dark:text-gray-100">
                              {displayPrice}
                              <span className="text-[10px] font-normal text-gray-400 ml-0.5">F</span>
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        {/* MAC */}
                        <td className="px-3 py-2">
                          {v.macAddress ? (
                            <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                              {v.macAddress}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        {/* IP */}
                        <td className="px-3 py-2">
                          {v.saleIp ? (
                            <span className="font-mono text-[10px] text-blue-500 dark:text-blue-400">
                              {v.saleIp}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        {/* Date vente */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-gray-600 dark:text-gray-300">
                            {formatDate(isSold ? v.usedAt : (v.printedAt ?? v.createdAt))}
                          </span>
                        </td>
                        {/* État */}
                        <td className="px-3 py-2 text-center">
                          {isSold ? (
                            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/50 text-red-500 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/50 whitespace-nowrap">
                              Vendu
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800/50 whitespace-nowrap">
                              Non vendu
                            </span>
                          )}
                        </td>
                        {/* Vendeur */}
                        <td className="px-3 py-2">
                          {v.vendorName ? (
                            <span className="inline-flex items-center gap-1 text-gray-700 dark:text-gray-200 font-medium">
                              <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              {v.vendorName}
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600 italic text-[10px]">
                              Non attribué
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data?.total === 200 && (
              <p className="text-[10px] text-gray-400 text-center py-2 border-t border-gray-100 dark:border-gray-800">
                Affichage limité à 200 résultats · Affinez votre recherche pour voir plus
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state (no search yet) */}
      {!enabled && search.trim().length < 2 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 mx-auto mb-3">
              <Search className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
              Vérifiez n'importe quel ticket
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
              Saisissez un nom d'utilisateur, une adresse MAC ou une IP pour retrouver le ticket et identifier le vendeur.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
