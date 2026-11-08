import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  importMessageText,
  IMPORT_MESSAGE_VISIBILITY_SECONDS,
  parseImportMessage,
} from "../../src/imports/import-queue.js";
import { InMemoryImportQueue } from "../../src/imports/in-memory-import-queue.js";
import { InMemoryImportRepository } from "../../src/imports/in-memory-import-repository.js";
import { processImport } from "../../src/imports/process-import.js";
import { runImportJob } from "../../src/jobs/run-import.js";
import { answer, ImportJobFixture, LEVEL } from "../imports/process-import-helpers.js";

let job: ImportJobFixture;
let queue: InMemoryImportQueue;

beforeEach(() => {
  job = new ImportJobFixture();
  queue = new InMemoryImportQueue();
});

function run(process = (id: Parameters<typeof processImport>[0]) => processImport(id, job.dependencies())) {
  return runImportJob({ queue, process, logger: job.logger });
}

describe("IMP-11 the import job: one message, processed once, never retried", () => {
  it("exits cleanly when no message is waiting", async () => {
    expect(await run()).toBe("empty");
  });

  it("processes the import a message names and deletes the message", async () => {
    const id = await job.startImport();
    await queue.send(id);

    expect(await run()).toBe("processed");

    expect((await job.record(id)).toSnapshot().status).toBe("done");
    expect(queue.messages()).toEqual([]);
  });

  it("takes one message per run, oldest first", async () => {
    const first = await job.startImport();
    const second = await job.startImport();
    await queue.send(first);
    await queue.send(second);

    await run();

    expect((await job.record(first)).toSnapshot().status).toBe("done");
    expect((await job.record(second)).toSnapshot().status).toBe("reading");
    expect(queue.messages()).toEqual([importMessageText(second)]);
  });

  it("deletes the message of a failed import: it is not retried", async () => {
    const id = await job.startImport();
    job.reader.answer = async () => answer({ found: false });
    await queue.send(id);

    expect(await run()).toBe("processed");

    expect(queue.messages()).toEqual([]);
    expect(await run()).toBe("empty");
  });

  it("deletes the message when processing throws, and reports an error", async () => {
    const id = await job.startImport();
    await queue.send(id);

    expect(await run(async () => Promise.reject(new Error("Cosmos DB is unavailable")))).toBe("error");

    expect(queue.messages()).toEqual([]);
    expect(job.errors()).toEqual([expect.objectContaining({ importId: id.value })]);
  });

  it("a record that can't be loaded: one recipe-import-failed line, the run an error, the message deleted", async () => {
    const id = await job.startImport();
    await queue.send(id);
    const imports = new InMemoryImportRepository();
    imports.get = async () => {
      throw new Error("Cosmos DB is unavailable");
    };

    expect(await run((importId) => processImport(importId, job.dependencies({ imports })))).toBe("error");

    expect(job.errors()).toEqual([
      {
        level: LEVEL.error,
        time: expect.any(Number),
        event: "recipe-import-failed",
        importId: id.value,
        reason: "internal-error",
        msg: "recipe import failed",
      },
    ]);
    expect(queue.messages()).toEqual([]);
  });

  it("deletes a message without a valid import id, without processing or logging its text", async () => {
    queue.sendText('{"importId":"Banana Bread"}');
    const process = vi.fn();

    expect(await run(process)).toBe("error");

    expect(process).not.toHaveBeenCalled();
    expect(queue.messages()).toEqual([]);
    expect(JSON.stringify(job.lines)).not.toContain("Banana");
  });

  it("hides a received message for the import's 10 minutes: a stopped run's message comes back as timed-out", () => {
    expect(IMPORT_MESSAGE_VISIBILITY_SECONDS).toBe(600);
  });
});

describe("import queue messages (docs/architecture.md, 'Recipe import')", () => {
  it("reads the import id from a message the API sends", async () => {
    const id = await job.startImport();
    expect(parseImportMessage(importMessageText(id))?.value).toBe(id.value);
  });

  it.each([
    ["not JSON", "hello"],
    ["no import id", "{}"],
    ["an import id that isn't a UUID", '{"importId":"42"}'],
    ["another field", '{"importId":"3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1d","extra":1}'],
    ["an array", '["3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1d"]'],
  ])("refuses %s", (_case, text) => {
    expect(parseImportMessage(text)).toBeUndefined();
  });
});
