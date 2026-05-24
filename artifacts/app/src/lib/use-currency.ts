/**
 * Devise affichée dans l'UI : lue depuis le routeur sélectionné (RouterContext).
 *
 * - Admin / manager / collaborateur : devise du routeur en cours (`selectedRouter.currency`).
 * - Repli "FCFA" si aucun routeur n'est sélectionné ou si la colonne est vide.
 *
 * Pour le portail vendeur (qui n'utilise pas RouterContext), utiliser le champ
 * `currency` renvoyé par `/api/vendor-portal/me` au lieu de ce hook.
 */
import { useRouterContext } from "@/contexts/RouterContext";

export function useCurrency(): string {
  const { selectedRouter, borrowedRouter } = useRouterContext();
  const raw =
    (selectedRouter as { currency?: string | null } | undefined)?.currency
    ?? borrowedRouter?.currency
    ?? "";
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : "FCFA";
}

/** Devise pour un routeur arbitraire (hors RouterContext, ex. tables multi-routeur). */
export function routerCurrencyOrDefault(
  router: { currency?: string | null } | null | undefined,
): string {
  const raw = router?.currency ?? "";
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : "FCFA";
}
