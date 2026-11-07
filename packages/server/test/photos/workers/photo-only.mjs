// A photo worker that answers with one image and no thumbnail: right for an import page photo, wrong for a recipe photo
// (import-page-processing.test.ts).
import { parentPort } from "node:worker_threads";

parentPort.postMessage({ ok: true, photo: new Uint8Array([0xff, 0xd8, 0xff]) });
