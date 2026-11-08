import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportId } from "@recipebox/domain";
import type { ImportMessageSource, ImportQueue } from "../../src/imports/import-queue.js";
import { parseImportMessage } from "../../src/imports/import-queue.js";

export interface QueueUnderTest {
  queue: ImportQueue & ImportMessageSource;
  /** The text of the messages on the queue, oldest first. A received message not yet deleted may or may not be listed. */
  messages(): Promise<string[]>;
}

/**
 * Behavior every `ImportQueue` must have (IMP-1; docs/architecture.md, "Recipe import"). `createQueue` is called before each
 * test and must give an empty queue.
 */
export function importQueueContract(name: string, createQueue: () => Promise<QueueUnderTest>): void {
  describe(`${name} (ImportQueue contract)`, () => {
    let subject: QueueUnderTest;

    beforeEach(async () => {
      subject = await createQueue();
    });

    it("puts one message per import, holding only its id, in order", async () => {
      const a = importId();
      const b = importId();
      await subject.queue.send(a);
      await subject.queue.send(b);
      const messages = (await subject.messages()).map((text) => JSON.parse(text) as unknown);
      expect(messages).toStrictEqual([{ importId: a.value }, { importId: b.value }]);
    });

    it("receives nothing from an empty queue", async () => {
      expect(await subject.queue.receive()).toBeUndefined();
    });

    it("receives the oldest message, and deleting it removes it for good", async () => {
      const a = importId();
      const b = importId();
      await subject.queue.send(a);
      await subject.queue.send(b);

      const received = await subject.queue.receive();
      expect(parseImportMessage(received?.text ?? "")?.value).toBe(a.value);
      await received?.delete();

      const next = await subject.queue.receive();
      expect(parseImportMessage(next?.text ?? "")?.value).toBe(b.value);
      await next?.delete();
      expect(await subject.queue.receive()).toBeUndefined();
      expect(await subject.messages()).toEqual([]);
    });

    it("hides a received message from other receivers until it is deleted", async () => {
      await subject.queue.send(importId());
      const received = await subject.queue.receive();
      expect(received).toBeDefined();
      expect(await subject.queue.receive()).toBeUndefined();
      await received?.delete();
    });
  });
}

function importId(): ImportId {
  const id = ImportId.create(randomUUID());
  if (!id.ok) throw new Error("not a UUID");
  return id.value;
}
