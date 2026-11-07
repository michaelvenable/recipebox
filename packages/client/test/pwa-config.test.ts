/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKGROUND_COLOR, THEME_COLOR, manifest, navigateFallbackDenylist, pwaOptions } from "../pwa.config.js";

const path = (relative: string) => new URL(relative, import.meta.url);
const read = (relative: string) => readFileSync(path(relative), "utf8");

/** Width and height from a PNG's IHDR chunk, which always comes first. */
function pngSize(relative: string): { width: number; height: number } {
  const bytes = readFileSync(path(relative));
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Whether the service worker answers a navigation to `pathAndSearch` with the app, as Workbox's NavigationRoute decides. */
function servesApp(pathAndSearch: string): boolean {
  return !navigateFallbackDenylist.some((pattern) => pattern.test(pathAndSearch));
}

describe("X-4 web app manifest", () => {
  it("names the app and opens it standalone at the root", () => {
    expect(manifest).toMatchObject({
      name: "Recipe Box",
      short_name: "Recipe Box",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#2E6A4F",
      background_color: "#2E6A4F",
    });
  });

  it("starts on the accent green, which suits a light or dark splash screen and matches the icon (X-14)", () => {
    const styles = read("../src/styles.css").toLowerCase();
    const light = styles.slice(0, styles.indexOf("@media (prefers-color-scheme: dark)"));
    expect(light).toContain(`--accent: ${THEME_COLOR.toLowerCase()};`);
    expect(BACKGROUND_COLOR).toBe(THEME_COLOR);
    expect(read("../scripts/generate-icons.mjs")).toContain(`const ACCENT = "${BACKGROUND_COLOR}";`);
  });

  it("lists 192 and 512 icons and a 512 maskable icon, each a PNG of the stated size", () => {
    const icons = manifest.icons ?? [];
    expect(icons.map(({ sizes, purpose }) => `${sizes} ${purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
    for (const icon of icons) {
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      expect(icon.type).toBe("image/png");
      expect(pngSize(`../public${icon.src}`)).toEqual({ width, height });
    }
  });

  it("has a 180 × 180 apple-touch-icon and an SVG icon", () => {
    expect(pngSize("../public/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(read("../public/icons/icon.svg")).toMatch(/^<svg /);
  });
});

describe("X-4 index.html for installing", () => {
  const html = read("../index.html");

  it("links the icons and sets the theme color for light and dark", () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(existsSync(path("../public/apple-touch-icon.png"))).toBe(true);
    expect(html).toContain('<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />');
    expect(html).toMatch(/<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="#[0-9a-f]{6}" \/>/);
    expect(html).toMatch(/<meta name="theme-color" media="\(prefers-color-scheme: dark\)" content="#[0-9a-f]{6}" \/>/);
  });

  it("names the app and opens it full screen when added to an iPhone or iPad home screen", () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Recipe Box" />');
  });

  it("no longer loads fonts from another site: they are part of the app", () => {
    expect(html).not.toContain("fonts.googleapis.com");
    expect(read("../src/main.tsx")).toContain('import "@fontsource/atkinson-hyperlegible/400.css";');
  });
});

describe("X-4 service worker", () => {
  const workbox = pwaOptions.workbox ?? {};

  it("precaches only the app's own built files", () => {
    expect(workbox.globPatterns).toEqual(["**/*.{html,js,css,woff2,png,svg}"]);
  });

  it("caches nothing at run time, so API responses and the session always come from the network (X-1)", () => {
    expect(workbox.runtimeCaching).toEqual([]);
  });

  it("answers the app's pages with index.html, including searches with a dot in them", () => {
    expect(workbox.navigateFallback).toBe("/index.html");
    for (const page of [
      "/",
      "/?q=st.+louis",
      "/recipes/0f8fad5b-d9cb-469f-a165-70867728950e",
      "/recipes/0f8fad5b-d9cb-469f-a165-70867728950e/edit",
      "/recipes/new",
      "/plan",
      "/plan/shopping",
      // PLAN-9: a sent shopping list. Link codes are base64url, so they never have a dot.
      "/list/k7Qm2xV9pR4tZ8wL-a1B_c",
      "/recommendations",
      "/trash",
      "/account",
      // X-15: linked from the Google sign-in consent screen, so it must open as a deep link.
      "/privacy",
    ]) {
      expect(servesApp(page), page).toBe(true);
    }
  });

  it("leaves /.auth and file paths to the network", () => {
    for (const path of ["/.auth", "/.auth/login/google", "/.auth/me", "/.auth?x=1", "/robots.txt", "/sw.js", "/icons/x.png"]) {
      expect(servesApp(path), path).toBe(false);
    }
  });

  it("waits for the user before switching to a new version", () => {
    expect(pwaOptions.registerType).toBe("prompt");
    expect(pwaOptions.injectRegister).toBe(false);
    expect(workbox.skipWaiting).toBe(false);
    expect(workbox.clientsClaim).toBe(false);
  });

  it("is not used in development", () => {
    expect(pwaOptions.devOptions?.enabled).toBe(false);
  });
});

describe("X-4 and X-10 Static Web Apps configuration", () => {
  interface Route {
    route: string;
    headers?: Record<string, string>;
  }
  const config = JSON.parse(read("../public/staticwebapp.config.json")) as {
    navigationFallback: { rewrite: string; exclude: string[] };
    routes: Route[];
    globalHeaders: Record<string, string>;
  };
  const headersFor = (route: string) => config.routes.find((r) => r.route === route)?.headers ?? {};

  it("answers the app's pages with index.html, but not built files or /.auth", () => {
    expect(config.navigationFallback.rewrite).toBe("/index.html");
    expect(config.navigationFallback.exclude).toEqual(expect.arrayContaining(["/assets/*", "/icons/*", "/.auth/*"]));
  });

  /** Whether a navigationFallback exclude pattern (Static Web Apps wildcards: `*` and `{a,b}`) matches `path`. */
  function excluded(path: string): boolean {
    return config.navigationFallback.exclude.some((pattern) => {
      const source = pattern
        .replace(/[.+?^$()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\{([^}]*)\}/g, (_all, list: string) => `(?:${list.split(",").join("|")})`);
      return new RegExp(`^${source}$`).test(path);
    });
  }

  it("PLAN-9 answers a sent shopping list's page with the app", () => {
    expect(excluded("/list/k7Qm2xV9pR4tZ8wL-a1B_c")).toBe(false);
    expect(excluded("/assets/index-abc.js")).toBe(true);
    expect(excluded("/robots.txt")).toBe(true);
  });

  it("X-15 answers the Privacy page with the app, so its address opens directly; X-10's header covers it too", () => {
    expect(excluded("/privacy")).toBe(false);
    expect(config.routes.some((r) => r.route === "/privacy" || r.route.startsWith("/privacy/"))).toBe(false);
  });

  it("PLAN-9 never passes a sent shopping list's address on from its page", () => {
    expect(headersFor("/list/*")["Referrer-Policy"]).toBe("no-referrer");
  });

  it("never lets browsers keep an old service worker, page or manifest", () => {
    for (const route of ["/sw.js", "/", "/index.html", "/manifest.webmanifest"]) {
      expect(headersFor(route)["Cache-Control"], route).toBe("no-cache");
    }
  });

  it("X-10 asks search engines not to index any response", () => {
    expect(config.globalHeaders["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});
