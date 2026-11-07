// Sending the shopping list as a link (PLAN-9, docs/api.md): an editor makes the link, and anyone with it can read the list for
// 7 days. The one exception to X-1's private to-make list.
//
// Making a link follows docs/architecture.md, "How a change is applied", as far as it applies to something new: requireEditor
// (X-6), read the stored recipes, build the list with the domain from them and the server's time (X-12) and a token made here,
// then save the snapshot. Nothing from the request is stored: the body must be `{}`.
import type { FastifyInstance, FastifyReply } from "fastify";
import { SharedShoppingList, ShareToken, shoppingList } from "@recipebox/domain";
import type { SharedShoppingList as SharedShoppingListResponse, ShoppingListLink } from "@recipebox/shared";
import type { Clock, ShareTokenGenerator } from "../clock.js";
import { requireEditor } from "../http/caller.js";
import type { RecipeRepository } from "../recipes/recipe-repository.js";
import { toSharedShoppingList } from "../recipes/recipe-responses.js";
import { refuseUnlessEmpty, sendErrors } from "../recipes/recipe-routes.js";
import type { SharedListRepository } from "./shared-list-repository.js";

export interface SharedListRouteDependencies {
  recipes: RecipeRepository;
  sharedLists: SharedListRepository;
  clock: Clock;
  newShareToken: ShareTokenGenerator;
}

interface TokenParams {
  token: string;
}

/** Where the client shows a sent list (packages/client/src/routes.tsx); the client joins it to its own origin. */
export function sharedListPath(token: ShareToken): string {
  return `/list/${token.value}`;
}

/**
 * PLAN-9: one answer for a link that never existed, a malformed one and an expired one, so trying links reveals nothing
 * (docs/mockups/SharedListExpired.dc.html).
 */
function sendLinkNotFound(reply: FastifyReply): FastifyReply {
  return sendErrors(reply, 404, [{ code: "sharedList.notFound", message: "This link has expired or doesn't exist." }]);
}

export function registerSharedListRoutes(
  app: FastifyInstance,
  { recipes, sharedLists, clock, newShareToken }: SharedListRouteDependencies,
): void {
  // PLAN-9, X-6: editor-only. The list is the domain's shoppingList (PLAN-8) of the stored recipes, never one sent by the
  // client, and the times are the server's (X-12). Each call makes a new link; earlier ones keep working.
  app.post(
    "/plan/shopping-list/shares",
    { preHandler: requireEditor },
    async (request, reply): Promise<ShoppingListLink | FastifyReply> => {
      reply.header("cache-control", "private, no-store");
      const refused = refuseUnlessEmpty(request.body, reply);
      if (refused !== undefined) return refused;
      const created = SharedShoppingList.create(newShareToken(), shoppingList(await recipes.list()), clock());
      // shoppingList.empty: the plan's state refuses it, as recipe states do (docs/api.md, 409).
      if (!created.ok) return sendErrors(reply, 409, created.errors);
      const list = created.value;
      await sharedLists.add(list);
      const link: ShoppingListLink = {
        token: list.token.value,
        path: sharedListPath(list.token),
        expiresAt: list.expiresAt.toIso(),
      };
      return reply.code(201).send(link);
    },
  );

  // PLAN-9: public, signed in or not, and the same for everyone. Whether the link still works is the domain's, by the server's
  // clock (X-12). The address is a password: no cache may keep the answer, and no page it leads to learns it.
  app.get<{ Params: TokenParams }>(
    "/shopping-lists/:token",
    async (request, reply): Promise<SharedShoppingListResponse | FastifyReply> => {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      const token = ShareToken.create(request.params.token);
      if (!token.ok) return sendLinkNotFound(reply);
      const list = await sharedLists.get(token.value);
      if (list === undefined || !list.isAvailable(clock())) return sendLinkNotFound(reply);
      return toSharedShoppingList(list);
    },
  );
}
