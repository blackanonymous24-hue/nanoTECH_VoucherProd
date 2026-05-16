import { QueryClient } from "@tanstack/react-query";
import { isApiPauseError } from "@workspace/api-client-react";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, err) => {
        if (isApiPauseError(err)) return failureCount < 6;
        return failureCount < 1;
      },
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
  },
});
