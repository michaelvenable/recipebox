// A photo worker that throws outside any try/catch (photo-processing.test.ts).
setTimeout(() => {
  throw new RangeError("offset is out of bounds");
}, 0);
