// Draws the app icon (X-4) and renders the PNG sizes the web app manifest and iOS need. Run once after changing the drawing,
// from the repository root, and commit the outputs:
//
//   node packages/client/scripts/generate-icons.mjs
//
// sharp comes from the server workspace (hoisted to the root node_modules); the client doesn't depend on it.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = new URL("../public/", import.meta.url);
const iconsDir = new URL("icons/", publicDir);

const ACCENT = "#2E6A4F"; // --accent, light palette (src/styles.css)
const PAPER = "#F6F6F3"; // --bg, light palette
const BOX = "#7FC4A0"; // --accent, dark palette

/**
 * A recipe card standing in a box, on the accent green. Everything sits inside the central circle of radius 0.4 × size, the safe
 * zone of a maskable icon, so the same drawing works when Android crops it to a circle or squircle. `rounded` gives the square
 * rounded corners and transparent edges, for places that show the icon as is (browser tab, desktop install); `false` fills the
 * whole square, for maskable icons and iOS, which round the corners themselves.
 */
function iconSvg({ rounded }) {
  const background = rounded
    ? `<rect width="512" height="512" rx="112" fill="${ACCENT}"/>`
    : `<rect width="512" height="512" fill="${ACCENT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${background}
  <rect x="160" y="112" width="192" height="176" rx="14" fill="${PAPER}"/>
  <rect x="190" y="148" width="132" height="16" rx="8" fill="${ACCENT}"/>
  <rect x="190" y="184" width="104" height="12" rx="6" fill="${ACCENT}" opacity="0.55"/>
  <rect x="190" y="212" width="118" height="12" rx="6" fill="${ACCENT}" opacity="0.55"/>
  <rect x="120" y="236" width="272" height="160" rx="24" fill="${BOX}"/>
  <rect x="206" y="292" width="100" height="36" rx="10" fill="${PAPER}"/>
</svg>
`;
}

async function png(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL(file, publicDir)));
}

await mkdir(iconsDir, { recursive: true });
const rounded = iconSvg({ rounded: true });
const square = iconSvg({ rounded: false });

await writeFile(new URL("icon.svg", iconsDir), rounded);
await png(rounded, 192, "icons/icon-192.png");
await png(rounded, 512, "icons/icon-512.png");
await png(square, 512, "icons/icon-maskable-512.png");
await png(square, 180, "apple-touch-icon.png");
console.log("Wrote public/icons/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png and public/apple-touch-icon.png.");
