import { useEffect, useRef } from "react";

/**
 * Relanıce automatiquement un refetch si la requête s'est terminée sans données.
 *
 * Cas ciblé : l'utilisateur navigue vers une page, la requête réussit (pas d'erreur)
 * mais renvoie un tableau vide / undefined alors qu'il devrait y avoir des données.
 * Cela arrive lors d'un démarrage à froid du serveur ou d'un token pas encore propagé.
 *
 * Comportement :
 * - Attend que `isLoading` soit false (requête terminée).
 * - Si isEmpty(data) === true, programme un refetch après `delayMs` (défaut 2 s).
 * - Ne relance qu'au maximum `maxRetries` fois par montage (défaut 2).
 * - Se réinitialise à chaque remontage du composant (nouvelle navigation).
 */
export function useRefetchOnEmpty<T>(
  data: T | undefined,
  isLoading: boolean,
  refetch: () => void,
  isEmpty: (d: T | undefined) => boolean,
  options: { delayMs?: number; maxRetries?: number } = {},
): void {
  const { delayMs = 2_000, maxRetries = 2 } = options;
  const retriesRef = useRef(0);

  useEffect(() => {
    retriesRef.current = 0;
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!isEmpty(data)) return;
    if (retriesRef.current >= maxRetries) return;

    const t = setTimeout(() => {
      retriesRef.current += 1;
      refetch();
    }, delayMs);

    return () => clearTimeout(t);
  }, [data, isLoading]);
}
