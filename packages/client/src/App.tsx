import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router";
import { type AppUpdates, AppUpdatesContext } from "./pwa/service-worker.js";
import { createQueryClient } from "./query-client.js";
import { routes } from "./routes.js";

/** `updates`: the service worker's new versions (X-4); undefined when there is no service worker, as in development. */
export function App({ updates }: { updates?: AppUpdates | undefined }) {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppUpdatesContext value={updates}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppUpdatesContext>
  );
}
