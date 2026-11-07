// Sending the shopping list as a link (PLAN-9, docs/api.md): an editor makes the link, and for 7 days anyone with it can read
// the current shopping list. The one exception to X-1's private to-make list.
//
// Making a link follows docs/architecture.md, "How a change is applied", as far as it applies to something new: requireEditor
// (X-6), read the stored recipes (only to refuse an empty plan), create the link with the domain from the server's time (X-12)
// and a token made here, then save its snapshot: the code and the time, nothing of the list. Nothing from the request is
// stored: the body must be `{}`.
import type { FastifyInstance, FastifyReply } from "fastify";
import { ShareToken, ShoppingListLink, shoppingList } from "@recipebox/domain";
import type { SharedShoppingList, ShoppingListLink as ShoppingListLinkResponse } from "@recipebox/shared";
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
  // PLAN-9, X-6: editor-only. An empty plan, by the domain's shoppingList (PLAN-8) of the stored recipes, has nothing to send.
  // The code and the time are the server's (X-12). Each call makes a new link; earlier ones keep working.
  app.post(
    "/plan/shopping-list/shares",
    { preHandler: requireEditor },
    async (request, reply): Promise<ShoppingListLinkResponse | FastifyReply> => {
      reply.header("cache-control", "private, no-store");
      const refused = refuseUnlessEmpty(request.body, reply);
      if (refused !== undefined) return refused;
      const created = ShoppingListLink.create(newShareToken(), shoppingList(await recipes.list()), clock());
      // shoppingList.empty: the plan's state refuses it, as recipe states do (docs/api.md, 409).
      if (!created.ok) return sendErrors(reply, 409, created.errors);
      const link = created.value;
      await sharedLists.add(link);
      const body: ShoppingListLinkResponse = {
        token: link.token.value,
        path: sharedListPath(link.token),
        expiresAt: link.expiresAt.toIso(),
      };
      return reply.code(201).send(body);
    },
  );

  // PLAN-9: public, signed in or not, and the same for everyone. Whether the link still works is the domain's, by the server's
  // clock (X-12). The list is live: the same shoppingList (PLAN-8) as GET /plan/shopping-list, built from the stored recipes
  // on every request, empty when the plan is. The address is a password: no cache may keep the answer, and no page it leads
  // to learns it.
  app.get<{ Params: TokenParams }>(
    "/shopping-lists/:token",
    async (request, reply): Promise<SharedShoppingList | FastifyReply> => {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      const token = ShareToken.create(request.params.token);
      if (!token.ok) return sendLinkNotFound(reply);
      const link = await sharedLists.get(token.value);
      if (link === undefined || !link.isAvailable(clock())) return sendLinkNotFound(reply);
      return toSharedShoppingList(shoppingList(await recipes.list()), link);
    },
  );
}
