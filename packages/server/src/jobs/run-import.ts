import type { ImportId } from "@recipebox/domain";
import { type ImportMessageSource, parseImportMessage } from "../imports/import-queue.js";
import type { ImportLogger, ImportOutcome } from "../imports/process-import.js";

export interface ImportJobDependencies {
  queue: ImportMessageSource;
  /** Processes one import (processImport with its stores, reader and clock). */
  process: (importId: ImportId) => Promise<ImportOutcome>;
  logger: Pick<ImportLogger, "info" | "error">;
}

/**
 * What one run did: `empty` if no message was waiting, `processed` if one was handled (whatever became of the import, which
 * is logged), `error` if something unexpected went wrong, which the job reports with a non-zero exit code.
 */
export type ImportJobResult = "empty" | "processed" | "error";

/**
 * One execution of the import job (docs/architecture.md, "Recipe import"): takes one message from the queue, processes its
 * import, and deletes the message whatever the outcome, since a failed import is never retried (IMP-11).
 */
export async function runImportJob({ queue, process, logger }: ImportJobDependencies): Promise<ImportJobResult> {
  const message = await queue.receive();
  if (message === undefined) {
    logger.info({}, "no import waiting");
    return "empty";
  }
  let result: ImportJobResult = "processed";
  const importId = parseImportMessage(message.text);
  try {
    if (importId === undefined) {
      // The text is not logged: it isn't one of ours, so it could hold anything.
      logger.error({}, "an import message without a valid import id; deleted");
      result = "error";
    } else {
      const outcome = await process(importId);
      // The app's own storage failed: the run is reported as failed too.
      if (outcome === "error" || outcome === "internal-error") result = "error";
    }
  } catch (error) {
    logger.error({ err: error, importId: importId?.value }, "could not process an import");
    result = "error";
  } finally {
    await message.delete();
  }
  return result;
}
