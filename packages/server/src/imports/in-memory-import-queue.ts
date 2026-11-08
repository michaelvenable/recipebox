import type { ImportId } from "@recipebox/domain";
import {
  type ImportMessageSource,
  type ImportQueue,
  importMessageText,
  type ReceivedImportMessage,
} from "./import-queue.js";

/**
 * An `ImportQueue` for fast tests: keeps the text of every message sent, in order, until it is received and deleted. A
 * received message is hidden until deleted; it never becomes visible again. Sends can be made to fail.
 */
export class InMemoryImportQueue implements ImportQueue, ImportMessageSource {
  private readonly sent: { text: string; received: boolean }[] = [];
  /** When true, `send` throws, as when Queue Storage is unreachable. */
  failSends = false;

  async send(importId: ImportId): Promise<void> {
    if (this.failSends) throw new Error("Queue Storage is unavailable");
    this.sent.push({ text: importMessageText(importId), received: false });
  }

  /** Puts a message with any text on the queue, as something other than the API might. */
  sendText(text: string): void {
    this.sent.push({ text, received: false });
  }

  async receive(): Promise<ReceivedImportMessage | undefined> {
    const message = this.sent.find((m) => !m.received);
    if (message === undefined) return undefined;
    message.received = true;
    return {
      text: message.text,
      delete: async () => {
        const index = this.sent.indexOf(message);
        if (index >= 0) this.sent.splice(index, 1);
      },
    };
  }

  /** The text of every message not yet deleted, in order, including received ones. */
  messages(): string[] {
    return this.sent.map((m) => m.text);
  }
}
