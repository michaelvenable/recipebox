// Turns an uploaded image into the two images that are stored (REC-7; docs/architecture.md, "Photos"). Type and size limits
// live here, in the upload handler's code, because image bytes never enter the domain (docs/domain-model.md).
import { Worker, type WorkerOptions } from "node:worker_threads";
// Not used on this thread, but loaded here on purpose: sharp's documentation asks for it to be loaded on the main thread before
// any worker uses it, so its native libraries stay loaded when a worker ends (glibc Linux, which the API runs on).
import "sharp";
import {
  type ConversionPurpose,
  type ConversionResult,
  type ImageType,
  STORED_CONTENT_TYPE,
} from "./photo-conversion.js";

export {
  type ImageType,
  IMPORT_PAGE_MAX_SIDE,
  MAX_INPUT_PIXELS,
  PHOTO_MAX_SIDE,
  STORED_CONTENT_TYPE,
  THUMBNAIL_MAX_SIDE,
} from "./photo-conversion.js";

/** REC-7: "up to 15 MB". */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** How long a worker may take to decode one upload before it is ended (docs/architecture.md, "Photos"). */
export const DECODE_TIMEOUT_MS = 30_000;

/** How many decodes (workers) run at once (docs/architecture.md, "Photos"). */
export const DECODE_CONCURRENCY = 1;

/** How many more uploads may wait for a decode; beyond that an upload is refused as busy (docs/architecture.md, "Photos"). */
export const DECODE_QUEUE_SIZE = 8;

/**
 * Runs decodes at most `concurrency` at a time, in arrival order, with at most `queueSize` waiting. A task that fails releases
 * its place like one that succeeds, so the next one starts.
 */
export class DecodeQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly concurrency: number = DECODE_CONCURRENCY,
    private readonly queueSize: number = DECODE_QUEUE_SIZE,
  ) {}

  /** Runs `task` when a place is free. Undefined, without running it, when the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T> | undefined {
    if (this.running >= this.concurrency && this.waiting.length >= this.queueSize) return undefined;
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.running += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            this.waiting.shift()?.();
          });
      };
      if (this.running < this.concurrency) start();
      else this.waiting.push(start);
    });
  }
}

/** The queue all uploads share, unless a test passes its own. */
const sharedDecodeQueue = new DecodeQueue();

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
}

/**
 * The image type, read from the file's own bytes (its signature). The file name and the type the browser claims are never used:
 * a text file renamed photo.jpg is not a JPEG. Undefined for anything that is not one of the accepted types (REC-7), including
 * HEIC.
 */
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return undefined;
}

export interface ProcessedPhoto {
  /** The display image: at most PHOTO_MAX_SIDE on its longer side. */
  photo: Buffer;
  /** At most THUMBNAIL_MAX_SIDE on its longer side. */
  thumbnail: Buffer;
  contentType: typeof STORED_CONTENT_TYPE;
}

export type ProcessingResult =
  | { ok: true; value: ProcessedPhoto }
  /** `unsupportedType`: not JPEG, PNG or WebP. `unreadable`: one of those by its signature, but it can't be decoded. */
  /** `busy`: too many uploads are already waiting for a decode; nothing was decoded. */
  | { ok: false; reason: "unsupportedType" | "unreadable" | "busy" };

export interface PhotoProcessingOptions {
  /** Defaults to DECODE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The worker's module. Tests replace it with one that hangs or crashes; otherwise photo-worker.ts or its compiled .js. */
  workerUrl?: URL;
  /** Starts a worker; defaults to startWorker. Tests wrap it to watch the workers. */
  createWorker?: (workerUrl: URL, options: WorkerOptions) => Worker;
  /** Defaults to one queue shared by all uploads, of DECODE_CONCURRENCY and DECODE_QUEUE_SIZE. Tests pass their own. */
  queue?: DecodeQueue;
  /** Where to log why an image was refused as unreadable. */
  log?: { warn(details: object, message: string): void };
}

/**
 * The worker module next to this one. Under Vitest and tsx this module runs from its TypeScript source, so the worker does too;
 * in a compiled build (tsc's output in dist/) both are .js.
 */
function defaultWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith(".ts") ? "./photo-worker.ts" : "./photo-worker.js", import.meta.url);
}

/**
 * Starts the worker module. A compiled .js module is started directly. TypeScript source needs tsx's loader, which a worker
 * doesn't inherit: Vitest transforms modules itself rather than through Node's loaders, and `tsx watch` registers its loader on
 * the main thread only. So such a worker starts with a small script that registers tsx and then imports the module. tsx is a
 * development dependency; a compiled build never takes this path.
 */
export function startWorker(workerUrl: URL, options: WorkerOptions): Worker {
  if (!workerUrl.pathname.endsWith(".ts")) return new Worker(workerUrl, options);
  const tsx = import.meta.resolve("tsx/esm/api");
  const bootstrap =
    `import(${JSON.stringify(tsx)}).then((tsx) => { tsx.register(); return import(${JSON.stringify(workerUrl.href)}); });`;
  return new Worker(bootstrap, { ...options, eval: true });
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Decodes the upload in a worker thread of its own, which is ended as soon as it answers or after `timeoutMs`; the result is
 * given once the worker has exited, so the next decode never overlaps it. Anything else
 * than a well-formed answer (the worker throws, has an unhandled rejection, exits, or doesn't answer in time) refuses the image;
 * none of it reaches this thread, so the API keeps serving.
 */
function convertInWorker(
  bytes: Buffer,
  type: ImageType,
  purpose: ConversionPurpose,
  { timeoutMs = DECODE_TIMEOUT_MS, workerUrl = defaultWorkerUrl(), createWorker = startWorker }: PhotoProcessingOptions,
): Promise<ConversionResult> {
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (result: ConversionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Ending the worker also frees whatever memory the decode used.
      if (worker === undefined) {
        resolve(result);
        return;
      }
      worker
        .terminate()
        .catch(() => undefined)
        .finally(() => resolve(result));
    };
    const fail = (detail: string): void => finish({ ok: false, detail });

    try {
      worker = createWorker(workerUrl, { workerData: { bytes, type, purpose } });
    } catch (error) {
      fail(`could not start the photo worker: ${String(error)}`);
      return;
    }
    timer = setTimeout(() => fail(`no answer within ${timeoutMs} ms`), timeoutMs);
    // "error" covers an uncaught exception and an unhandled rejection in the worker; the worker then exits.
    worker.on("error", (error) => fail(`the photo worker failed: ${String(error)}`));
    worker.on("messageerror", (error) => fail(`unreadable answer from the photo worker: ${String(error)}`));
    worker.on("exit", (code) => fail(`the photo worker exited with code ${code} without answering`));
    worker.on("message", (message: unknown) => {
      const answer = message as Partial<Record<"ok" | "photo" | "thumbnail" | "detail", unknown>> | null;
      // A recipe photo needs its thumbnail; an import page photo has none.
      const thumbnailOk = purpose === "recipe" ? isBytes(answer?.thumbnail) : answer?.thumbnail === undefined;
      if (answer?.ok === true && isBytes(answer.photo) && thumbnailOk) {
        finish({ ok: true, photo: answer.photo, ...(isBytes(answer.thumbnail) ? { thumbnail: answer.thumbnail } : {}) });
      } else {
        fail(typeof answer?.detail === "string" ? answer.detail : "malformed answer from the photo worker");
      }
    });
  });
}

/**
 * Checks and converts an uploaded image (REC-7):
 * - the type is detected from the bytes; anything but JPEG, PNG or WebP is refused;
 * - images over MAX_INPUT_PIXELS are refused before they are decoded;
 * - the camera's rotation is applied and all metadata is dropped (photo-conversion.ts);
 * - a display image and a thumbnail are produced, both JPEG, from one decode of the source.
 * Decoding happens in a worker thread (convertInWorker), one at a time through the decode queue; the time limit starts when the
 * decode does. When the queue is full the upload is refused as `busy`. The size limit (MAX_PHOTO_BYTES) is enforced earlier,
 * while the upload is read.
 */
export async function processPhoto(bytes: Buffer, options: PhotoProcessingOptions = {}): Promise<ProcessingResult> {
  const result = await decodeInQueue(bytes, "recipe", options);
  if (!result.ok) return result;
  const { photo, thumbnail } = result.value;
  if (thumbnail === undefined) throw new Error("The photo worker answered a recipe photo without a thumbnail");
  return {
    ok: true,
    value: { photo: toBuffer(photo), thumbnail: toBuffer(thumbnail), contentType: STORED_CONTENT_TYPE },
  };
}

export interface ProcessedImportPage {
  /** The page photo: at most IMPORT_PAGE_MAX_SIDE on its longer side. */
  image: Buffer;
  contentType: typeof STORED_CONTENT_TYPE;
}

export type ImportPageResult =
  | { ok: true; value: ProcessedImportPage }
  | { ok: false; reason: "unsupportedType" | "unreadable" | "busy" };

/**
 * Checks and converts the page photo of an import (IMP-2; docs/architecture.md, "Recipe import") with the same checks, decode
 * worker and queue as a recipe photo (processPhoto): the same accepted types, pixel limit, rotation and removal of all
 * metadata, so no location reaches the reading service. It makes one JPEG of at most IMPORT_PAGE_MAX_SIDE on its longer side
 * and no thumbnail.
 */
export async function processImportPage(bytes: Buffer, options: PhotoProcessingOptions = {}): Promise<ImportPageResult> {
  const result = await decodeInQueue(bytes, "importPage", options);
  if (!result.ok) return result;
  return { ok: true, value: { image: toBuffer(result.value.photo), contentType: STORED_CONTENT_TYPE } };
}

/** The type check, then one decode through the shared queue, for either purpose. */
async function decodeInQueue(
  bytes: Buffer,
  purpose: ConversionPurpose,
  options: PhotoProcessingOptions,
): Promise<
  | { ok: true; value: { photo: Uint8Array; thumbnail?: Uint8Array } }
  | { ok: false; reason: "unsupportedType" | "unreadable" | "busy" }
> {
  const type = detectImageType(bytes);
  if (type === undefined) return { ok: false, reason: "unsupportedType" };
  const decoding = (options.queue ?? sharedDecodeQueue).run(() => convertInWorker(bytes, type, purpose, options));
  if (decoding === undefined) {
    options.log?.warn({ type, purpose }, "photo refused: too many uploads are waiting to be decoded");
    return { ok: false, reason: "busy" };
  }
  const result = await decoding;
  if (!result.ok) {
    options.log?.warn({ type, purpose, detail: result.detail }, "photo refused as unreadable");
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, value: result };
}
