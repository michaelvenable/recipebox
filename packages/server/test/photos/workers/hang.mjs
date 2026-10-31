// A photo worker that never answers, like a decoder stuck in a loop (photo-processing.test.ts). When the test passes a port as
// workerData.started, it says "started" there first, so the test knows the worker was running before it was ended.
import { workerData } from "node:worker_threads";

workerData?.started?.postMessage("started");
for (;;) {
  // Busy, so only terminate() can end it.
}
