// Sign-in and sign-out links to Container Apps' built-in authentication (docs/architecture.md, "Sign-in").
import { useQuery } from "@tanstack/react-query";
import type { Me } from "@recipebox/shared";
import { apiBaseUrl } from "../api/client.js";
import { fetchMe } from "../api/me.js";

export type Provider = NonNullable<Me["provider"]>;

// Both providers are offered (X-7); Google's button shows only when the build has VITE_GOOGLE_SIGN_IN. The Account
// page names the provider of whoever is signed in (X-11).
export const PROVIDER_NAMES: Record<Provider, string> = { aad: "Microsoft", google: "Google" };

/**
 * The providers to offer for signing in (X-7, X-8): Microsoft, and Google only in a client built with
 * VITE_GOOGLE_SIGN_IN=true, which the deploy workflow sets once Google is configured. Read on each call, so tests can change it.
 */
export function signInProviders(): readonly Provider[] {
  return import.meta.env.VITE_GOOGLE_SIGN_IN === "true" ? ["aad", "google"] : ["aad"];
}

/**
 * Sign in with `provider`, then come back to `returnPath`, a path in this app such as "/plan?x=1" (X-8). The auth layer returns
 * to `/signed-in` on the API host, which redirects to the client: a full client address would be dropped for Microsoft sign-in
 * (docs/architecture.md, "Sign-in"). The API sends anything that isn't a path in the app to the home page.
 */
export function signInUrl(provider: Provider, returnPath: string): string {
  const afterSignIn = `/signed-in?to=${encodeURIComponent(returnPath)}`;
  return `${apiBaseUrl()}/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(afterSignIn)}`;
}

/** Sign out, then come back to `returnTo`, an absolute address in this app. */
export function signOutUrl(returnTo: string): string {
  return `${apiBaseUrl()}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}

/** The absolute address of a path in this app, for signing out. */
export function appUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}

/**
 * A path within this app that is safe to return to after signing in. Checking the text alone isn't enough: the URL parser
 * drops tabs and newlines and reads "\" as "/", so "/\t/evil.example" names another site. Parse it and compare origins.
 */
export function isAppPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export const ME_QUERY_KEY = ["me"] as const;

/** Who is using the app (X-11). Loaded once per page load; signing in or out leaves the app and reloads it. */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: Infinity,
  });
}

export type Viewer = "loading" | "visitor" | "nonEditor" | "editor";

/**
 * The kind of viewer, for choosing what to show. If /me can't be loaded, treat the person as a visitor: the server decides
 * what they may see and change anyway (X-1, X-6).
 */
export function useViewer(): { viewer: Viewer; me: Me | undefined } {
  const { data, isPending } = useMe();
  if (isPending) return { viewer: "loading", me: undefined };
  if (data === undefined || !data.signedIn) return { viewer: "visitor", me: data };
  return { viewer: data.isEditor ? "editor" : "nonEditor", me: data };
}
