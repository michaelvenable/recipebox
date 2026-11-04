import { MessageChannel, type Worker, type WorkerOptions } from "node:worker_threads";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import {
  DECODE_CONCURRENCY,
  DECODE_QUEUE_SIZE,
  DECODE_TIMEOUT_MS,
  DecodeQueue,
  startWorker,
  detectImageType,
  MAX_INPUT_PIXELS,
  MAX_PHOTO_BYTES,
  PHOTO_MAX_SIDE,
  processPhoto,
  type ProcessedPhoto,
  THUMBNAIL_MAX_SIDE,
} from "../../src/photos/photo-processing.js";
import {
  CAMERA_MAKE,
  colorAt,
  exifOf,
  expectColor,
  expectStrippedJpeg,
  gif,
  jpeg,
  paddedJpeg,
  phoneHeic,
  phoneJpeg,
  png,
  TEXT_FILE,
  webp,
} from "./test-images.js";

async function processed(bytes: Buffer): Promise<ProcessedPhoto> {
  const result = await processPhoto(bytes);
  if (!result.ok) throw new Error(`Expected the image to be accepted, got ${result.reason}`);
  return result.value;
}

/** Both images show the 40 x 60 test picture the right way up: red on top, blue below. */
async function expectUpright(bytes: Buffer): Promise<void> {
  const { width, height } = await sharp(bytes).metadata();
  expect([width, height]).toEqual([40, 60]);
  expectColor(await colorAt(bytes, 20, 5), "red");
  expectColor(await colorAt(bytes, 20, 55), "blue");
}

describe("REC-7 accepted types, detected from the file's bytes", () => {
  it.each([
    ["JPEG", jpeg, "jpeg"],
    ["PNG", png, "png"],
    ["WebP", webp, "webp"],
  ] as const)("detects %s by its signature", async (_name, make, type) => {
    expect(detectImageType(await make())).toBe(type);
  });

  it.each([
    ["a text file (named photo.jpg by its sender)", async () => TEXT_FILE],
    ["a GIF", gif],
    ["a HEIC from an iPhone (iOS converts photos picked in the browser to JPEG)", async () => phoneHeic()],
    ["an AVIF (HEIF, but AV1 rather than HEVC)", avif],
    ["a TIFF", () => sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).tiff().toBuffer()],
    ["an SVG", async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')],
    ["an empty file", async () => Buffer.alloc(0)],
    ["two bytes of a JPEG signature", async () => Buffer.from([0xff, 0xd8])],
  ])("refuses %s", async (_name, make) => {
    const bytes = await make();
    expect(detectImageType(bytes)).toBeUndefined();
    expect(await processPhoto(bytes)).toEqual({ ok: false, reason: "unsupportedType" });
  });

  it("refuses a file with an accepted signature that can't be decoded", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    expect(await processPhoto(broken)).toEqual({ ok: false, reason: "unreadable" });
  });

});

describe('REC-7 images over 50 megapixels are refused before decoding (architecture "Photos")', () => {
  it("allows 50 megapixels", () => {
    expect(MAX_INPUT_PIXELS).toBe(50_000_000);
  });

  it("refuses a PNG just over 50 megapixels", async () => {
    // 8,200 x 6,100 = 50.02 megapixels of one color: a small file that would need hundreds of megabytes of memory.
    const bomb = await sharp({ create: { width: 8_200, height: 6_100, channels: 3, background: "white" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(MAX_PHOTO_BYTES);
    expect(await processPhoto(bomb)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("accepts a 48-megapixel phone photo (8064 x 6048)", async () => {
    const photo = await sharp({ create: { width: 8_064, height: 6_048, channels: 3, background: "red" } })
      .jpeg()
      .toBuffer();
    const result = await processed(photo);
    expect((await sharp(result.photo).metadata()).width).toBe(PHOTO_MAX_SIDE);
    expect((await sharp(result.thumbnail).metadata()).width).toBe(THUMBNAIL_MAX_SIDE);
  }, 30_000);
});

describe('REC-7 a damaged or hostile file cannot harm the server (architecture "Photos": decoding is isolated)', () => {
  const escaped: unknown[] = [];
  const record = (error: unknown): void => {
    escaped.push(error);
  };
  beforeEach(() => {
    escaped.length = 0;
    process.on("unhandledRejection", record);
    process.on("uncaughtException", record);
  });
  afterEach(() => {
    process.off("unhandledRejection", record);
    process.off("uncaughtException", record);
  });

  /** Gives anything a decode left behind (timers, promises) time to fail in this process. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

  it("refuses an image whose decoder doesn't answer within the time limit", async () => {
    const started = Date.now();
    const result = await processPhoto(await jpeg(), { workerUrl: workerFixture("hang"), timeoutMs: 300 });
    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(escaped).toEqual([]);
  });

  it.each([
    ["exits without answering", "exit"],
    ["throws outside any try/catch", "throw"],
    ["has an unhandled rejection", "reject"],
    ["answers with something other than two images", "malformed"],
  ])("refuses an image whose decoder %s", async (_name, worker) => {
    const result = await processPhoto(await jpeg(), { workerUrl: workerFixture(worker) });
    expect(result).toEqual({ ok: false, reason: "unreadable" });
    await settle();
    expect(escaped).toEqual([]);
  });

  it("still converts images after a decoder failed", async () => {
    await processPhoto(await jpeg(), { workerUrl: workerFixture("throw") });
    await expectUpright((await processed(await phoneJpeg())).photo);
  });
});

describe("REC-7 photos display correctly oriented", () => {
  it("applies a JPEG's EXIF orientation to both images", async () => {
    const result = await processed(await phoneJpeg());
    await expectUpright(result.photo);
    await expectUpright(result.thumbnail);
  });

  it("applies a WebP's EXIF orientation", async () => {
    await expectUpright((await processed(await webp())).photo);
  });
});

describe("REC-7, X-1 stored images carry no metadata", () => {
  it.each([
    ["JPEG", phoneJpeg],
    ["PNG", png],
    ["WebP", webp],
  ] as const)("drops EXIF, GPS location and all other metadata from a %s", async (_name, make) => {
    const source = await make();
    const exif = await exifOf(source);
    expect(exif?.Image?.Make).toBe(CAMERA_MAKE);
    expect(exif?.GPSInfo?.GPSLatitudeRef).toBe("N");

    const result = await processed(source);

    expect(result.contentType).toBe("image/jpeg");
    await expectStrippedJpeg(result.photo);
    await expectStrippedJpeg(result.thumbnail);
  });

  it("makes transparent areas white", async () => {
    const result = await processed(await png());
    expectColor(await colorAt(result.photo, 59, 39), "white");
    expectColor(await colorAt(result.photo, 0, 0), "red");
  });
});

describe("REC-7 display image and thumbnail sizes", () => {
  it(`fits the display image within ${PHOTO_MAX_SIDE} px and the thumbnail within ${THUMBNAIL_MAX_SIDE} px`, async () => {
    const result = await processed(await jpeg(3000, 1500));
    const photo = await sharp(result.photo).metadata();
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect([photo.width, photo.height]).toEqual([2000, 1000]);
    expect([thumbnail.width, thumbnail.height]).toEqual([400, 200]);
  });

  it("does not enlarge a small image", async () => {
    const result = await processed(await jpeg(300, 200));
    expect((await sharp(result.photo).metadata()).width).toBe(300);
    expect((await sharp(result.thumbnail).metadata()).width).toBe(300);
  });

  it("accepts a JPEG of exactly 15 MB, dropping its padding", async () => {
    const big = paddedJpeg(await jpeg(), MAX_PHOTO_BYTES);
    const result = await processed(big);
    await expectStrippedJpeg(result.photo);
    expect(result.photo.length).toBeLessThan(100_000);
  });
});

describe('REC-7 every photo worker is ended (architecture "Photos": the worker is ended afterwards)', () => {
  it.each([
    ["answers with the images", undefined],
    ["exits without answering", "exit"],
    ["throws outside any try/catch", "throw"],
    ["has an unhandled rejection", "reject"],
    ["answers with something other than two images", "malformed"],
  ])("ends the worker when it %s, before the result is given", async (_name, fixture) => {
    const watch = new WorkerWatch();
    const options = { createWorker: watch.createWorker, queue: new DecodeQueue() };
    const result = await processPhoto(
      await jpeg(),
      fixture === undefined ? options : { ...options, workerUrl: workerFixture(fixture) },
    );
    expect(result.ok).toBe(fixture === undefined);
    expect(watch.workers).toHaveLength(1);
    expect(watch.workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(watch.workers[0]!.exitedAt).toBeDefined();
  });

  it("ends a worker that is still running when the time limit is reached", async () => {
    const watch = new WorkerWatch();
    const decoding = processPhoto(await jpeg(), {
      workerUrl: workerFixture("hang"),
      timeoutMs: 300,
      createWorker: watch.createWorker,
      queue: new DecodeQueue(),
    });
    await watch.started(0);
    expect(watch.workers[0]!.exitedAt).toBeUndefined();
    expect(await decoding).toEqual({ ok: false, reason: "unreadable" });
    expect(watch.workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(watch.workers[0]!.exitedAt).toBeDefined();
  });
});

describe('REC-7 one decode at a time, up to 8 waiting (architecture "Photos")', () => {
  it("runs 1 decode at a time with up to 8 waiting", () => {
    expect(DECODE_CONCURRENCY).toBe(1);
    expect(DECODE_QUEUE_SIZE).toBe(8);
  });

  it("never runs more than one worker at once, however many uploads arrive together", async () => {
    const watch = new WorkerWatch();
    const queue = new DecodeQueue();
    const image = await jpeg();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => processPhoto(image, { createWorker: watch.createWorker, queue })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(watch.workers).toHaveLength(6);
    expect(watch.maxLive).toBe(1);
  }, 30_000);

  it("starts the time limit when the decode begins, so an upload waiting behind a slow one gets its full time", async () => {
    const watch = new WorkerWatch();
    const options = {
      workerUrl: workerFixture("hang"),
      timeoutMs: 400,
      createWorker: watch.createWorker,
      queue: new DecodeQueue(),
    };
    const image = await jpeg();
    const arrived = Date.now();
    const [first, second] = await Promise.all([
      processPhoto(image, options),
      processPhoto(image, options).then((result) => ({ result, at: Date.now() })),
    ]);
    expect(first).toEqual({ ok: false, reason: "unreadable" });
    expect(second.result).toEqual({ ok: false, reason: "unreadable" });
    const [slow, queued] = watch.workers;
    expect(queued!.createdAt).toBeGreaterThanOrEqual(slow!.exitedAt!);
    expect(second.at - queued!.createdAt).toBeGreaterThanOrEqual(400 - 5);
    expect(second.at - arrived).toBeGreaterThanOrEqual(2 * 400 - 10);
  });

  it("refuses an upload as busy when the queue is full, without starting a worker", async () => {
    const watch = new WorkerWatch();
    const options = {
      workerUrl: workerFixture("hang"),
      timeoutMs: 300,
      createWorker: watch.createWorker,
      queue: new DecodeQueue(1, 2),
    };
    const image = await jpeg();
    const accepted = [processPhoto(image, options), processPhoto(image, options), processPhoto(image, options)];

    expect(await processPhoto(image, options)).toEqual({ ok: false, reason: "busy" });
    expect(watch.workers.length).toBeLessThanOrEqual(1);

    expect(await Promise.all(accepted)).toEqual(Array(3).fill({ ok: false, reason: "unreadable" }));
    expect(watch.workers).toHaveLength(3);
    expect((await processPhoto(image, { createWorker: watch.createWorker, queue: options.queue })).ok).toBe(true);
  });

  it("keeps decoding queued uploads after decodes that failed or timed out", async () => {
    const watch = new WorkerWatch();
    const shared = { createWorker: watch.createWorker, queue: new DecodeQueue(), timeoutMs: 300 };
    const image = await jpeg();
    const results = await Promise.all([
      processPhoto(image, { ...shared, workerUrl: workerFixture("throw") }),
      processPhoto(image, { ...shared, workerUrl: workerFixture("hang") }),
      processPhoto(image, { ...shared, workerUrl: workerFixture("exit") }),
      processPhoto(image, { ...shared, workerUrl: workerFixture("hang") }),
      processPhoto(image, { ...shared, timeoutMs: DECODE_TIMEOUT_MS }),
    ]);
    expect(results.slice(0, 4)).toEqual(Array(4).fill({ ok: false, reason: "unreadable" }));
    expect(results[4]!.ok).toBe(true);
    expect(watch.maxLive).toBe(1);
  }, 30_000);

  it("frees a place when a task fails", async () => {
    const queue = new DecodeQueue(1, 0);
    await expect(queue.run(() => Promise.reject(new Error("decoder failed")))).rejects.toThrow("decoder failed");
    expect(await queue.run(async () => "next")).toBe("next");
  });
});

interface WatchedWorker {
  terminate: MockInstance<Worker["terminate"]>;
  createdAt: number;
  exitedAt?: number;
  started: Promise<void>;
}

/** A worker factory that starts real workers and records when each starts and exits, and how many run at once. */
class WorkerWatch {
  readonly workers: WatchedWorker[] = [];
  live = 0;
  maxLive = 0;

  readonly createWorker = (workerUrl: URL, options: WorkerOptions): Worker => {
    // The hang fixture says "started" on this port, so a test knows it was running before it was ended.
    const { port1, port2 } = new MessageChannel();
    const worker = startWorker(workerUrl, {
      ...options,
      workerData: { ...(options.workerData as object), started: port2 },
      transferList: [port2],
    });
    const watched: WatchedWorker = {
      terminate: vi.spyOn(worker, "terminate"),
      createdAt: Date.now(),
      started: new Promise((resolve) => port1.once("message", () => resolve())),
    };
    this.workers.push(watched);
    this.live += 1;
    this.maxLive = Math.max(this.maxLive, this.live);
    worker.on("exit", () => {
      this.live -= 1;
      watched.exitedAt = Date.now();
      port1.close();
    });
    return worker;
  };

  /** Resolves once the `index`th worker has been created and has said it started. */
  async started(index: number): Promise<void> {
    while (this.workers[index] === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
    await this.workers[index].started;
  }
}

function workerFixture(name: string): URL {
  return new URL(`./workers/${name}.mjs`, import.meta.url);
}

function avif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).avif().toBuffer();
}
