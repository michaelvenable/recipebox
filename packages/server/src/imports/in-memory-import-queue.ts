import type { ImportId } from "@recipebox/domain";
import { type ImportQueue, importMessageText } from "./import-queue.js";

/** An `ImportQueue` for fast tests: keeps the text of every message sent, in order. Sends can be made to fail. */
export class InMemoryImportQueue implements ImportQueue {
  private readonly sent: string[] = [];
  /** When true, `send` throws, as when Queue Storage is unreachable. */
  failSends = false;

  async send(importId: ImportId): Promise<void> {
    if (this.failSends) throw new Error("Queue Storage is unavailable");
    this.sent.push(importMessageText(importId));
  }

  /** The text of every message sent, in order. */
  messages(): string[] {
    return [...this.sent];
  }
}
