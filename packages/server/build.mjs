// Production build of the API, the trash cleanup job and the import job to plain JavaScript, for the container image (Dockerfile
// at the repository root; docs/architecture.md, "Overview", "Trash cleanup" and "Recipe import"). Plain JavaScript so the image
// needs neither tsx nor TypeScript at runtime.
//
// Bundled rather than compiled with tsc: @recipebox/domain and @recipebox/shared are workspace packages that export their
// TypeScript sources, so tsc's output would still import .ts files. The bundle inlines them (and what they depend on, such as
// zod); the server's own npm dependencies stay external and are installed in the image, since sharp has a native binary and the
// Azure SDKs are large.
//
// The output is flat (dist/app/main.js, cleanup.js, import.js, photo-worker.js) because photo-processing.ts starts the worker
// from "./photo-worker.js" next to the module that runs it, which after bundling is main.js or import.js (docs/architecture.md,
// "Photos").
import { readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outdir = "dist/app";
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@recipebox/"));

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: ["src/main.ts", "src/jobs/cleanup.ts", "src/jobs/import.ts", "src/photos/photo-worker.ts"],
  entryNames: "[name]",
  outdir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  sourcemap: true,
  logLevel: "info",
});
// The image copies dist/app without the server's package.json, so the bundle says itself that its .js files are ES modules.
await writeFile(`${outdir}/package.json`, `${JSON.stringify({ type: "module" }, null, 2)}\n`);
