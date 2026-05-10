import { useMemo } from "react";
import type { UserRole } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";

export type AuthQueryScopeInput = {
  role: UserRole | null;
  isSuperAdmin: boolean;
  vendorInfo: { id: number } | null;
  managerRouterId: number | null;
  collaborateurRouterIds: number[];
  connectedUsername: string | null;
};

/**
 * Segmente le cache / l’annulation React Query par « persona » (admin vs super-admin,
 * gérant, collaborateur + périmètre routeurs, etc.) en plus du routeur sélectionné.
 */
export function buildAuthQueryScope(a: AuthQueryScopeInput): readonly unknown[] {
  const collabSig =
    a.role === "collaborateur" && a.collaborateurRouterIds.length > 0
      ? [...a.collaborateurRouterIds].sort((x, y) => x - y).join(",")
      : "-";
  return [
    "vn1",
    a.role ?? "_",
    a.role === "admin" && a.isSuperAdmin ? 1 : 0,
    a.vendorInfo?.id ?? 0,
    a.managerRouterId ?? 0,
    collabSig,
    a.connectedUsername ?? "_",
  ] as const;
}

export function withAuthQueryScope<T extends readonly unknown[]>(
  scope: readonly unknown[],
  key: T,
): unknown[] {
  return [...scope, ...key];
}

export function useAuthQueryScope(): readonly unknown[] {
  const {
    role,
    isSuperAdmin,
    vendorInfo,
    managerRouterId,
    collaborateurRouterIds,
    connectedUsername,
  } = useAuth();
  return useMemo(
    () =>
      buildAuthQueryScope({
        role,
        isSuperAdmin,
        vendorInfo,
        managerRouterId,
        collaborateurRouterIds,
        connectedUsername,
      }),
    [
      role,
      isSuperAdmin,
      vendorInfo,
      managerRouterId,
      collaborateurRouterIds,
      connectedUsername,
    ],
  );
}
