import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { type Mock, vi } from "vitest";
import type { Me } from "@recipebox/shared";
import { routes } from "../src/routes.js";

export const VISITOR: Me = { signedIn: false, isEditor: false };
export const EDITOR: Me = { signedIn: true, provider: "google", accountId: "109876543210987654321", isEditor: true };
export const NON_EDITOR: Me = { signedIn: true, provider: "aad", accountId: "9f3c1e2d-0000-4000-8000-000000000001", isEditor: false };

/** The page's origin in tests (vitest.config.ts) and the API's development default (src/api/client.ts). */
export const APP = "http://localhost:5173";
export const API = "http://localhost:3000";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

/** Replaces `fetch` with `handler`, which gets the URL as a string and the request options. */
export function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchMock {
  const fetchMock: FetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input instanceof Request ? input.url : String(input), init ?? {}),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** An API that answers GET /me with `me`; any other request fails the test loudly with a 500. */
export function mockApiAs(me: Me): FetchMock {
  return mockFetch((url) => (url === `${API}/me` ? jsonResponse(200, me) : jsonResponse(500, { errors: [] })));
}

/**
 * An API that answers GET /me with `me` and other requests with `handler`, which gets the parsed URL. Anything `handler`
 * leaves unanswered (returns undefined) fails loudly with a 500.
 */
export function mockApi(me: Me, handler: (url: URL) => Response | Promise<Response> | undefined): FetchMock {
  return mockFetch(async (url) => {
    if (url === `${API}/me`) return jsonResponse(200, me);
    return (await handler(new URL(url))) ?? jsonResponse(500, { errors: [] });
  });
}

/** The URLs `fetch` was called with. */
export function requestedUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

/** Renders the whole app at `path`, as the browser router would. */
export function renderAt(path: string, state?: unknown) {
  const router = createMemoryRouter(routes, {
    initialEntries: [state === undefined ? path : { pathname: path, state }],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}
