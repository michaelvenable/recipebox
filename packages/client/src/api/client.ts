// A small fetch wrapper for the RecipeBox API (docs/api.md, "Conventions"; docs/architecture.md, "Sign-in").
import { type ErrorItem, ErrorResponse } from "@recipebox/shared";

/** Anything that parses a response body, such as a Zod schema from @recipebox/shared. */
export interface Schema<T> {
  parse(input: unknown): T;
}

/** A refused request: the HTTP status and the server's `ErrorResponse` items (empty if the body wasn't one). */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly errors: readonly ErrorItem[];

  constructor(status: number, errors: readonly ErrorItem[]) {
    super(errors[0]?.message ?? `The server answered ${status}.`);
    this.status = status;
    this.errors = errors;
  }

  get codes(): string[] {
    return this.errors.map((e) => e.code);
  }
}

/** The API in production, from docs/api.md; development defaults to the local server. */
const PRODUCTION_API_URL = "https://api.recipes.mikevenable.net";
const DEVELOPMENT_API_URL = "http://localhost:3000";

/** Must match DEV_IDENTITY_HEADER in packages/server/src/http/caller.ts. */
export const DEV_IDENTITY_HEADER = "x-dev-identity";

/**
 * Every upload carries this header (CSRF; docs/architecture.md, "Sign-in"): a form on another site can't add it. Must match
 * UPLOAD_HEADER and UPLOAD_HEADER_VALUE in packages/server/src/http/content-type.ts.
 */
export const UPLOAD_HEADER = "x-requested-by";
export const UPLOAD_HEADER_VALUE = "recipebox";

/** The API's address without a trailing slash. Read on each call, so tests can change the environment. */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  const url = configured !== undefined && configured !== "" ? configured : import.meta.env.DEV ? DEVELOPMENT_API_URL : PRODUCTION_API_URL;
  return url.replace(/\/+$/, "");
}

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  // The development sign-in stub. `import.meta.env.DEV` is replaced with `false` in a production build, so this branch and
  // the header are removed from it entirely; the server also ignores the header outside development and test.
  if (import.meta.env.DEV) {
    const identity = import.meta.env.VITE_DEV_IDENTITY;
    if (identity !== undefined && identity !== "") headers[DEV_IDENTITY_HEADER] = identity;
  }
  return headers;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(response.status, []);
  }
  const parsed = ErrorResponse.safeParse(body);
  return new ApiError(response.status, parsed.success ? parsed.data.errors : []);
}

interface SendOptions {
  body?: unknown;
  /** A multipart upload instead of a JSON body; only apiUpload sends one. */
  form?: FormData;
  signal?: AbortSignal | undefined;
}

async function send(method: string, path: string, init: SendOptions): Promise<Response> {
  const headers = baseHeaders();
  const request: RequestInit = { method, headers, credentials: "include" };
  if (init.form !== undefined) {
    // No content type here: the browser writes multipart/form-data with the boundary it chose.
    headers[UPLOAD_HEADER] = UPLOAD_HEADER_VALUE;
    request.body = init.form;
  } else if (init.body !== undefined) {
    // CSRF protection: every change is JSON (docs/architecture.md, "Sign-in").
    headers["content-type"] = "application/json";
    request.body = JSON.stringify(init.body);
  }
  if (init.signal !== undefined) request.signal = init.signal;
  const response = await fetch(`${apiBaseUrl()}${path}`, request);
  if (!response.ok) throw await errorFrom(response);
  return response;
}

/** `GET path`, with the body parsed by `schema`. A body that doesn't match is a contract bug and throws. */
export async function apiGet<T>(path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T> {
  const response = await send("GET", path, { signal });
  return schema.parse(await response.json());
}

export type ChangeMethod = "POST" | "PUT" | "DELETE";

/** A change with a JSON body (`{}`, the EmptyRequest, when there is no input), with the response parsed by `schema`. */
export async function apiChange<T>(method: ChangeMethod, path: string, schema: Schema<T>, body: unknown = {}): Promise<T> {
  const response = await send(method, path, { body });
  return schema.parse(await response.json());
}

/**
 * `PUT path` (or `POST`, for `POST /imports`) with one file as `multipart/form-data`, an upload, the exception to the JSON rule
 * (docs/api.md, Conventions), with the `X-Requested-By` header every upload needs. The server accepts it only with exactly one
 * file part and nothing else.
 */
export async function apiUpload<T>(path: string, schema: Schema<T>, file: File, method: "PUT" | "POST" = "PUT"): Promise<T> {
  const form = new FormData();
  form.append("photo", file);
  const response = await send(method, path, { form });
  return schema.parse(await response.json());
}

/** A change answered with 204 No Content, such as DELETE /recipes/{id}. */
export async function apiChangeNoContent(method: ChangeMethod, path: string, body: unknown = {}): Promise<void> {
  await send(method, path, { body });
}
