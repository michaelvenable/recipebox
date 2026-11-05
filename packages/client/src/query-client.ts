import { MutationCache, QueryCache, QueryClient, hashKey } from "@tanstack/react-query";
import { ApiError } from "./api/client.js";
import { ME_QUERY_KEY } from "./auth/sign-in.js";

const ME_QUERY_HASH = hashKey(ME_QUERY_KEY);

export function createQueryClient(): QueryClient {
  /**
   * /me is otherwise loaded once per page load. A 401 means the session has ended (expired, X-9, or signed out in another tab);
   * a 403 means the account was taken off the editor list. Either way, reload /me so the navigation and editor-only pages stop
   * offering what the server now refuses (X-6, X-8).
   */
  function reloadMeIfRefused(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  }

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Not when /me itself was refused: reloading it would be refused again, in an endless loop. A failed /me settles
        // once into the visitor state (useViewer).
        if (query.queryHash === ME_QUERY_HASH) return;
        reloadMeIfRefused(error);
      },
    }),
    mutationCache: new MutationCache({ onError: reloadMeIfRefused }),
    defaultOptions: {
      queries: {
        // Retries only what might succeed on a second try: network failures and server errors, never a 4xx refusal.
        retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      },
    },
  });
  return queryClient;
}
