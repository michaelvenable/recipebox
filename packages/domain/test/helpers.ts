import { expect } from "vitest";
import type { DomainError, Result } from "../src/index.js";

export function valueOf<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function errorsOf<T>(result: Result<T>): DomainError[] {
  if (result.ok) {
    throw new Error("Expected a failed result, got ok");
  }
  return result.errors;
}

/** The (code, field) pairs of a failed result, for compact assertions. */
export function errorKeys<T>(result: Result<T>): { code: string; field: string | undefined }[] {
  return errorsOf(result).map((e) => ({ code: e.code, field: e.field }));
}

export function expectEveryErrorHasMessage<T>(result: Result<T>): void {
  for (const e of errorsOf(result)) {
    expect(e.message.length).toBeGreaterThan(0);
  }
}
