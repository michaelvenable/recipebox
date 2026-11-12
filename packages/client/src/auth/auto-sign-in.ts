// X-16: signing in again automatically. The built-in auth's session cookie is deleted when the browser closes, whatever its
// lifetime (X-9; docs/architecture.md, "Sign-in"), so the device remembers which provider an editor last signed in with and,
// when the app is opened signed out, goes straight back to that provider, which usually signs the editor in with no interaction.
import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router";
import type { Me } from "@recipebox/shared";
import { type Provider, signInProviders, signInUrl, useMe } from "./sign-in.js";

/** Leaves the app for another address; an object so tests can replace it, since jsdom's location can't be stubbed. */
export const leavePage = { to: (url: string): void => window.location.assign(url) };

/** localStorage: just "aad" or "google", nothing else about the editor (X-16, X-15). */
export const REMEMBERED_PROVIDER_KEY = "recipebox.signInProvider";
/** sessionStorage: set before the redirect, so a visit tries only once (X-16). */
export const AUTO_SIGN_IN_TRIED_KEY = "recipebox.autoSignInTried";

// Every storage access is guarded: storage can be switched off or throw (private modes, quotas). Without it there is simply no
// automatic sign-in.

function rememberedProvider(): Provider | undefined {
  try {
    const value = localStorage.getItem(REMEMBERED_PROVIDER_KEY);
    return value === "aad" || value === "google" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * X-16: remembered only for an editor (X-6). Signing in with an account that isn't an editor forgets what was remembered; a
 * visitor changes nothing.
 */
export function rememberEditor(me: Me): void {
  if (!me.signedIn) return;
  if (!me.isEditor) {
    forgetProvider();
    return;
  }
  if (me.provider === undefined) return;
  try {
    if (localStorage.getItem(REMEMBERED_PROVIDER_KEY) !== me.provider) localStorage.setItem(REMEMBERED_PROVIDER_KEY, me.provider);
  } catch {
    // No storage, no automatic sign-in.
  }
}

/** X-16: signing out forgets the provider, so the app doesn't sign the editor straight back in. */
export function forgetProvider(): void {
  try {
    localStorage.removeItem(REMEMBERED_PROVIDER_KEY);
  } catch {
    // Nothing could have been remembered.
  }
}

function triedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(AUTO_SIGN_IN_TRIED_KEY) !== null;
  } catch {
    // Can't tell, so don't try: without the flag a failed sign-in would redirect again on every return.
    return true;
  }
}

/** Records the attempt; false if it can't be recorded, in which case there must be no attempt. */
function markTried(): boolean {
  try {
    sessionStorage.setItem(AUTO_SIGN_IN_TRIED_KEY, "1");
    return sessionStorage.getItem(AUTO_SIGN_IN_TRIED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Where to go to sign in again automatically, or undefined to stay. Only when /me answered "not signed in" (not when it failed
 * or is still loading), a provider is remembered and still offered, the device is online, the page isn't a shopping list link
 * (PLAN-9), and this visit hasn't tried yet (X-16).
 */
function autoSignInTarget(me: Me | undefined, pathname: string, returnPath: string): string | undefined {
  if (me === undefined || me.signedIn) return undefined;
  if (!navigator.onLine) return undefined;
  if (matchPath("/list/:token", pathname) !== null) return undefined;
  const provider = rememberedProvider();
  if (provider === undefined || !signInProviders().includes(provider)) return undefined;
  if (triedThisVisit()) return undefined;
  return signInUrl(provider, returnPath);
}

/**
 * X-16, decided once, on the first answer from /me after the app opens; a session that ends later in the visit (a 401 reloads
 * /me) doesn't send the editor away mid-task. Also remembers the provider whenever /me confirms an editor, including after
 * signing in by hand. Returns true while leaving for the provider's sign-in, so the page can keep showing that it is loading
 * instead of flashing the visitor's page.
 */
export function useAutoSignIn(): boolean {
  const { data, isPending } = useMe();
  const location = useLocation();
  // undefined until /me has settled; then the sign-in address, or null to stay.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const leaving = useRef(false);

  // Decided in render, not in an effect, so the visitor's page never shows for a frame before leaving.
  if (target === undefined && !isPending) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    setTarget(autoSignInTarget(data, location.pathname, returnPath) ?? null);
  }

  useEffect(() => {
    if (data !== undefined) rememberEditor(data);
  }, [data]);

  useEffect(() => {
    if (typeof target !== "string" || leaving.current) return;
    // Marked before leaving, so coming back still signed out shows the visitor's page instead of trying again.
    if (!markTried()) {
      setTarget(null);
      return;
    }
    leaving.current = true;
    leavePage.to(target);
  }, [target]);

  // X-16: Back from the provider's page can restore this page from the back/forward cache, with no reload, still "leaving".
  // Show the visitor's page then; the visit's flag is already set, so it doesn't try again.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted || !leaving.current) return;
      leaving.current = false;
      setTarget(null);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return typeof target === "string";
}
