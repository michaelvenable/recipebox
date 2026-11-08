import { ImportId, IMPORT_MINUTES } from "@recipebox/domain";

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

/** The import id in a message's text, or undefined if the text isn't a message `importMessageText` makes. */
export function parseImportMessage(text: string): ImportId | undefined {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const keys = Object.keys(message);
  const importId = (message as Partial<ImportMessage>).importId;
  if (keys.length !== 1 || typeof importId !== "string") return undefined;
  const id = ImportId.create(importId);
  return id.ok ? id.value : undefined;
}

/**
 * How long a received message stays hidden from other receivers: the 10 minutes an import may take (IMPORT_MINUTES). A
 * message is received after its import started, so if the job stops before deleting it, it is seen again only once its import
 * has timed out, and the next run ends it as `timed-out` rather than reading the photo again (IMP-11: no retries).
 */
export const IMPORT_MESSAGE_VISIBILITY_SECONDS = IMPORT_MINUTES * 60;

/** A message taken from the queue, hidden from other receivers until it is deleted or IMPORT_MESSAGE_VISIBILITY_SECONDS pass. */
export interface ReceivedImportMessage {
  text: string;
  /** Removes the message from the queue for good. */
  delete(): Promise<void>;
}

/** Where the import job takes its messages from (docs/architecture.md, "Recipe import"). */
export interface ImportMessageSource {
  /** The oldest message waiting, or undefined if there is none. */
  receive(): Promise<ReceivedImportMessage | undefined>;
}
