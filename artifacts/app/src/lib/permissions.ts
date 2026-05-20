import type { UserRole } from "@/contexts/AuthContext";

/** Gérant de zone : lecture complète, aucune suppression (UI + API). */
export function canDelete(role: UserRole | null | undefined): boolean {
  return role != null && role !== "manager";
}
