import type { ImportId } from "@recipebox/domain";

/**
 * The queue that starts the import job (docs/architecture.md, "Recipe import"): one message per started import, holding only
 * its id. Storage queue in main.ts, in memory in route tests.
 */
export interface ImportQueue {
  /** Puts a message for the import on the queue. Throws if it couldn't be queued. */
  send(importId: ImportId): Promise<void>;
}

/** A queue message's body. Only the id: the job reads the record and the page photo itself. */
export interface ImportMessage {
  importId: string;
}

/** The text of the message for `importId`. */
export function importMessageText(importId: ImportId): string {
  return JSON.stringify({ importId: importId.value } satisfies ImportMessage);
}
