export interface DomainError {
  /** Stable, machine-readable, e.g. "name.tooLong". */
  code: string;
  /** Path of the offending input, e.g. "ingredients[2]", for UI highlighting. */
  field?: string;
  /** Human-readable default. */
  message: string;
}

export function domainError(code: string, message: string, field?: string): DomainError {
  return field === undefined ? { code, message } : { code, field, message };
}

/** Re-labels errors from a value object with the field they came from inside a larger input. */
export function atField(errors: readonly DomainError[], field: string): DomainError[] {
  return errors.map((e) => ({ ...e, field }));
}
