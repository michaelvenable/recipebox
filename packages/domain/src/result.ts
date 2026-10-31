import type { DomainError } from "./errors.js";

/** Expected failures are values, not exceptions (domain-model.md, design principle 4). */
export type Result<T> = { ok: true; value: T } | { ok: false; errors: DomainError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(errors: DomainError | readonly DomainError[]): Result<T> {
  const list: DomainError[] = isList(errors) ? [...errors] : [errors];
  if (list.length === 0) {
    throw new Error("fail() needs at least one error");
  }
  return { ok: false, errors: list };
}

function isList(errors: DomainError | readonly DomainError[]): errors is readonly DomainError[] {
  return Array.isArray(errors);
}
