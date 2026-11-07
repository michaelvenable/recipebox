import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportId } from "@recipebox/domain";
import type { ImportQueue } from "../../src/imports/import-queue.js";

export interface QueueUnderTest {
  queue: ImportQueue;
  /** The text of every message on the queue, oldest first. */
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
  });
}

function importId(): ImportId {
  const id = ImportId.create(randomUUID());
  if (!id.ok) throw new Error("not a UUID");
  return id.value;
}
