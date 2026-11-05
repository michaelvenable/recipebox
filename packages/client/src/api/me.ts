import { Me } from "@recipebox/shared";
import { apiGet } from "./client.js";

/** GET /me: whether the caller is signed in, as whom, and whether they are an editor (X-11). */
export function fetchMe(signal?: AbortSignal): Promise<Me> {
  return apiGet("/me", Me, signal);
}
