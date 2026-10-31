// A photo worker that answers with something other than two images (photo-processing.test.ts).
import { parentPort } from "node:worker_threads";

parentPort.postMessage({ ok: true, photo: "not bytes" });
