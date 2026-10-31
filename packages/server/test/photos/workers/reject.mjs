// A photo worker with an unhandled rejection and no answer (photo-processing.test.ts).
setTimeout(async () => {
  throw new RangeError("offset is out of bounds");
}, 0);
