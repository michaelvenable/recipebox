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

  it("lets crawlers fetch pages in robots.txt, so they see the noindex and drop the page", () => {
    // A crawler barred by robots.txt never reads noindex, and can still list a linked address without its content.
    expect(robotsTxt).toMatch(/^User-agent: \*$/m);
    expect(robotsTxt).toMatch(/^Disallow:$/m);
    expect(robotsTxt).not.toMatch(/^Disallow: *\S/m);
  });
});

describe("REC-21 entry boxes", () => {
  it("can be dragged taller or shorter, which sizing the box to its text would prevent", () => {
    const textArea = styles.slice(styles.indexOf(".text-area {"), styles.indexOf("}", styles.indexOf(".text-area {")));
    expect(textArea).toContain("resize: vertical;");
    expect(styles).not.toMatch(/^\s*field-sizing:/m);
  });
});

describe("IMP-1 the Rotate button of each import photo", () => {
  it("is at least 44 px tall", () => {
    const start = styles.indexOf(".import-photo-rotate {");
    const rotate = styles.slice(start, styles.indexOf("}", start));
    expect(rotate).toContain("min-height: var(--touch);");
    expect(styles).toMatch(/--touch: 44px;/);
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
