// A photo worker: decodes one upload and answers with the two stored images (docs/architecture.md, "Photos"). Started by
// processPhoto (photo-processing.ts) for each upload and ended as soon as it has answered, so whatever the decoder does with a
// malformed file (throw where no try/catch sees it, never finish, hold on to memory) ends with the worker.
import { parentPort, workerData } from "node:worker_threads";
import { type ConversionRequest, convertPhoto } from "./photo-conversion.js";

if (parentPort === null) throw new Error("photo-worker.ts runs only as a worker thread");
parentPort.postMessage(await convertPhoto(workerData as ConversionRequest));
