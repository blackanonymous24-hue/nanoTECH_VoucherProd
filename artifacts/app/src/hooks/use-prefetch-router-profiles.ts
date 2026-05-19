import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListRouterProfilesQueryKey } from "@workspace/api-client-react";
import type { HotspotProfile } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { writeRouterProfilesToStorage } from "@/hooks/use-router-profiles-live";

/**
 * Précharge silencieusement les profils du routeur sélectionné dès qu'un
 * routeur est choisi (sélecteur ou page Routeurs), avant même que l'utilisateur
 * ouvre la page "Générer".
 *
 * Résultat : quand "Générer" s'ouvre, les profils sont déjà en localStorage →
 * affichage immédiat sans spinner, puis le `?refresh=1` de GenerateVouchers
 * met à jour les profils en arrière-plan.
 *
 * Utilise `/api/routers/:id/profiles` sans `?refresh=1` afin de s'appuyer sur
 * le script-cache serveur (déjà chaud grâce au sync temps réel) plutôt que de
 * déclencher un aller-retour MikroTik.
 *
 * Déduplication :
 * - `inFlightRef`  — évite les requêtes parallèles pour le même routeur.
 * - `successRef`   — ne re-précharge pas si déjà réussi dans la session.
 *   Si la première tentative échoue (routeur offline), la suivante est autorisée.
 */
export function usePrefetchRouterProfiles(): void {
  const { selectedRouterId } = useRouterContext();
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Set<number>>(new Set());
  const successRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!selectedRouterId) return;
    if (successRef.current.has(selectedRouterId)) return;
    if (inFlightRef.current.has(selectedRouterId)) return;

    const id = selectedRouterId;
    inFlightRef.current.add(id);

    void (async () => {
      try {
        const res = await fetch(`/api/routers/${id}/profiles`);
        if (!res.ok) return;
        const profiles = (await res.json()) as HotspotProfile[];
        if (!Array.isArray(profiles) || profiles.length === 0) return;

        writeRouterProfilesToStorage(id, profiles);

        queryClient.setQueryData(getListRouterProfilesQueryKey(id), profiles);
        successRef.current.add(id);
      } catch {
        /* routeur injoignable — réessai autorisé à la prochaine sélection */
      } finally {
        inFlightRef.current.delete(id);
      }
    })();
  }, [selectedRouterId, queryClient]);
}
