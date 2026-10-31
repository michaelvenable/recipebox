import type { ErrorItem } from "@recipebox/shared";

/** The part of a shared Zod schema this module uses; the server reaches Zod only through `@recipebox/shared`. */
interface Issue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}
export interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: ErrorItem[] };

/** "ingredients.2" style paths, written the way the domain names fields: "ingredients[2]". */
function fieldOf(path: readonly PropertyKey[]): string | undefined {
  let field = "";
  for (const part of path) {
    if (typeof part === "number") field += `[${part}]`;
    else field += field === "" ? String(part) : `.${String(part)}`;
  }
  return field === "" ? undefined : field;
}

function unknownKeys(issue: Issue): string[] {
  const keys: unknown = (issue as { keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.map(String) : [];
}

/**
 * Checks a request body against its shared, strict schema (docs/api.md, "Conventions"). Every problem is reported, each as an
 * `ErrorItem`; a field the shape doesn't list, such as a time (X-12), is one of them.
 */
export function parseBody<T>(schema: Schema<T>, body: unknown): Parsed<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: ErrorItem[] = [];
  for (const issue of parsed.error.issues) {
    const keys = issue.code === "unrecognized_keys" ? unknownKeys(issue) : [];
    if (keys.length > 0) {
      const parent = fieldOf(issue.path);
      for (const key of keys) {
        const field = parent === undefined ? key : `${parent}.${key}`;
        errors.push({ code: "request.unknownField", field, message: `"${field}" is not an accepted field.` });
      }
      continue;
    }
    const field = fieldOf(issue.path);
    errors.push(
      field === undefined
        ? { code: "request.invalid", message: issue.message }
        : { code: "request.invalid", field, message: issue.message },
    );
  }
  return { ok: false, errors };
}
