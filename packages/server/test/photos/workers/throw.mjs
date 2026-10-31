// A photo worker that throws outside any try/catch, as libheif-js's display() did from its setTimeout (photo-processing.test.ts).
setTimeout(() => {
  throw new RangeError("offset is out of bounds");
}, 0);
