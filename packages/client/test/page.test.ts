/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read from disk: Vitest replaces imported CSS with an empty module.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const indexHtml = read("../index.html");
const robotsTxt = read("../public/robots.txt");
const styles = read("../src/styles.css");

describe("X-10 not in search engines", () => {
  it("asks search engines not to index the page", () => {
    expect(indexHtml).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/);
  });

  it("disallows every crawler in robots.txt", () => {
    expect(robotsTxt).toMatch(/^User-agent: \*$/m);
    expect(robotsTxt).toMatch(/^Disallow: \/$/m);
  });
});

describe("X-14 dark theme follows the device", () => {
  it("redefines the palette when the device prefers dark", () => {
    const dark = styles.slice(styles.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark).not.toBe(styles);
    for (const token of ["--bg", "--surface", "--text", "--muted", "--accent", "--on-accent"]) {
      expect(dark).toContain(`${token}:`);
    }
  });
});
