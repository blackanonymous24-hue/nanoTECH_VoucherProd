import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useSetupStatus() {
  return useQuery<{ needsSetup: boolean }>({
    queryKey: ["setup-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/setup-status`);
      if (!res.ok) throw new Error("setup-status failed");
      return res.json() as Promise<{ needsSetup: boolean }>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });
}
