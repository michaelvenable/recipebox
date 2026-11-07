// Sending the shopping list as a link and opening one (PLAN-9; docs/api.md).
import { SharedShoppingList, ShoppingListLink } from "@recipebox/shared";
import { apiChange, apiGet } from "./client.js";

/**
 * POST /plan/shopping-list/shares: a new link to the shopping list as it is now. Editors only (X-6). The server builds the list
 * from the stored plan and picks the code and the times (X-12); nothing but `{}` is sent.
 */
export function sendShoppingList(): Promise<ShoppingListLink> {
  return apiChange("POST", "/plan/shopping-list/shares", ShoppingListLink);
}

/** GET /shopping-lists/{token}: a sent list, for anyone with the link. 404 when it has expired or never existed. */
export function fetchSharedList(token: string, signal?: AbortSignal): Promise<SharedShoppingList> {
  return apiGet(`/shopping-lists/${encodeURIComponent(token)}`, SharedShoppingList, signal);
}

/** The address to send: the app's own origin and its page for the list (routes.tsx). */
export function sharedListUrl(token: string): string {
  return `${window.location.origin}/list/${encodeURIComponent(token)}`;
}
