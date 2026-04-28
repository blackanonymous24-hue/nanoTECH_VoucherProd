import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalide toutes les queries liées aux versements / rapports vendeurs
 * pour un routeur donné. À appeler après tout ajout ou suppression de versement.
 */
export async function invalidateAllPaymentQueries(
  queryClient: QueryClient,
  routerId: number | null | undefined,
) {
  if (!routerId) return;
  await Promise.all([
    // Résumé hebdomadaire (page Versements)
    queryClient.invalidateQueries({ queryKey: ["weekly-summary", routerId] }),
    // Liste versements journaliers (page Versements)
    queryClient.invalidateQueries({ queryKey: ["weekly-daily-payments", routerId] }),
    // Arriérés section Versements
    queryClient.invalidateQueries({ queryKey: ["daily-arrears-versement", routerId] }),
    // Page Suivi journalier
    queryClient.invalidateQueries({ queryKey: ["vendor-daily-arrears", routerId] }),
    // Page Suivi hebdo (semaine courante)
    queryClient.invalidateQueries({ queryKey: ["vendor-tracking", routerId] }),
    // Page Suivi hebdo (semaine précédente)
    queryClient.invalidateQueries({ queryKey: ["vendor-tracking-prevweek", routerId] }),
  ]);
}
