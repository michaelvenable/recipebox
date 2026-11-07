// Installable app (X-4): the web app manifest and the service worker, built by vite-plugin-pwa (vite.config.ts). Kept apart from
// the Vite config so the tests can check what the service worker may and may not cache (test/pwa-config.test.ts).
import type { ManifestOptions, VitePWAOptions } from "vite-plugin-pwa";

/**
 * The colors the installed app starts with: the accent green of the light palette (--accent in src/styles.css), also the icon's
 * background. The splash screen uses BACKGROUND_COLOR whatever the device's theme (the manifest can't follow it, X-14), and the
 * green suits both, where the light page color would flash white in dark mode.
 */
export const THEME_COLOR = "#2E6A4F";
export const BACKGROUND_COLOR = THEME_COLOR;

export const manifest: Partial<ManifestOptions> = {
  id: "/",
  name: "Recipe Box",
  short_name: "Recipe Box",
  description: "Our household's recipes, to view on a phone or tablet while cooking.",
  lang: "en",
  start_url: "/",
  scope: "/",
  display: "standalone",
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  // Drawn by scripts/generate-icons.mjs.
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/**
 * Navigations the service worker leaves to the network instead of answering with the app's index.html:
 * - /.auth/…: Static Web Apps' own sign-in endpoints. Sign-in itself happens on the API's host (docs/architecture.md, "Sign-in"),
 *   which this service worker never sees, but the session must always be decided by the server.
 * - anything that looks like a file (a dot in the last path segment), such as /robots.txt or /sw.js, so a missing file is a 404
 *   rather than the app. The app's own routes have no dots (src/routes.tsx; recipe IDs are UUIDs). Workbox tests the path with
 *   its query string, so a dot in the query (a search for "a.b") doesn't count.
 */
export const navigateFallbackDenylist: RegExp[] = [/^\/\.auth(?:[/?]|$)/, /^[^?]*\.[^/?]*(?:\?|$)/];

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: "generateSW",
  filename: "sw.js",
  manifestFilename: "manifest.webmanifest",
  manifest,
  // The glob patterns below already take every icon; the plugin adds the manifest itself to the precache.
  includeManifestIcons: false,
  // The app registers the worker itself (src/pwa/service-worker.ts), so it can ask before switching to a new version.
  injectRegister: false,
  registerType: "prompt",
  // No service worker in `vite dev`; it would serve stale modules.
  devOptions: { enabled: false },
  workbox: {
    // The app shell only: the built HTML, scripts, styles, self-hosted fonts and icons, all from this site. Only woff2 fonts:
    // every browser with service workers reads woff2, so the woff copies are never fetched.
    globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist,
    // Nothing is cached at run time. In particular the API (another origin) and /.auth always go to the network: recipes,
    // editor-only data (X-1) and the session are never stored on the device by the service worker.
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
    // A new version waits until the user chooses to reload (src/layout/notices.tsx), never mid-edit.
    skipWaiting: false,
    clientsClaim: false,
  },
};
