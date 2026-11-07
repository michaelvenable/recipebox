// The recipe endpoints (docs/api.md) other than photos (photos/photo-routes.ts): list, tags, view, create, edit, delete, trash
// and restore; attaching and removing tags and tag suggestions; the "to make" list and its shopping list; cooking history and
// the "haven't made in a while" view.
//
// Every change follows docs/architecture.md, "How a change is applied": requireEditor (X-6), read the stored recipe, call one
// domain method with the request's input and the server's time (X-12), answer domain errors without saving, then save the
// snapshot. No document sent by the client is ever saved, and no request field is ever used as a time.
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  type DomainError,
  findRecipes,
  orderForRediscovery,
  Recipe,
  RecipeId,
  type Result,
  shoppingList,
  suggestTags,
  tagsInUse,
  toMakeList,
  trashContents,
} from "@recipebox/domain";
import {
  type EditorRecipe,
  type EditorRecipeSummary,
  EmptyRequest,
  type ErrorItem,
  type ErrorResponse,
  type PublicRecipe,
  RecipeContentInput,
  type RecipeSummary,
  type RediscoverEntry,
  type ShoppingItem,
  type Tag,
  type TagCount,
  TagRequest,
  type ToMakeEntry,
  type TrashEntry,
} from "@recipebox/shared";
import type { Clock, RecipeIdGenerator } from "../clock.js";
import { requireEditor } from "../http/caller.js";
import { parseBody } from "../http/request-body.js";
import type { RecipeRepository } from "./recipe-repository.js";
import {
  isEditor,
  toEditorRecipe,
  toEditorRecipeSummary,
  toRecipeFor,
  toRecipeSummary,
  toRediscoverEntry,
  toShoppingItem,
  toTag,
  toTagCount,
  toToMakeEntry,
  toTrashEntry,
} from "./recipe-responses.js";

export interface RecipeRouteDependencies {
  recipes: RecipeRepository;
  clock: Clock;
  newRecipeId: RecipeIdGenerator;
}

interface IdParams {
  id: string;
}

interface ListQuery {
  name?: unknown;
  tags?: unknown;
}

interface SuggestionQuery {
  typed?: unknown;
  recipeId?: unknown;
}

/**
 * Status for a refused change (docs/api.md, errors table): 409 when the recipe's state refuses it (REC-16, REC-17),
 * otherwise 400 for invalid input.
 */
const STATE_ERRORS: Readonly<Record<string, number>> = {
  "recipe.inTrash": 409,
  "trash.expired": 409,
};

export function statusFor(errors: readonly DomainError[]): number {
  for (const e of errors) {
    const status = STATE_ERRORS[e.code];
    if (status !== undefined) return status;
  }
  return 400;
}

function errorItems(errors: readonly DomainError[]): ErrorItem[] {
  return errors.map((e) => (e.field === undefined ? { code: e.code, message: e.message } : { ...e }));
}

export function sendErrors(reply: FastifyReply, status: number, errors: readonly DomainError[]): FastifyReply {
  const body: ErrorResponse = { errors: errorItems(errors) };
  return reply.code(status).send(body);
}

/**
 * The same answer for a recipe that doesn't exist, a malformed id and (when reading) a recipe in the trash, so a visitor can't
 * tell them apart (REC-4, REC-6, X-1). An editor changing a trashed recipe gets 409 recipe.inTrash instead (REC-17).
 */
export function sendNotFound(reply: FastifyReply): FastifyReply {
  return sendErrors(reply, 404, [{ code: "recipe.notFound", message: "This recipe doesn't exist." }]);
}

/** Recipe ids are UUIDs; a malformed one is treated as not found (docs/api.md, "Conventions"). */
export function recipeIdOf(raw: string): RecipeId | undefined {
  const id = RecipeId.create(raw);
  return id.ok ? id.value : undefined;
}

/**
 * REC-17 for a change whose input is checked before the domain is called: an editor changing a recipe in the trash is told so,
 * whatever the input, as the domain would answer (code recipe.inTrash, 409).
 */
export function sendInTrash(reply: FastifyReply): FastifyReply {
  return sendErrors(reply, 409, [
    { code: "recipe.inTrash", message: "This recipe is in the trash. Restore it before changing it." },
  ]);
}

/** 400 unless the body is `{}` (EmptyRequest); a time sent along is refused like any other field (X-12). */
export function refuseUnlessEmpty(body: unknown, reply: FastifyReply): FastifyReply | undefined {
  const parsed = parseBody(EmptyRequest, body);
  return parsed.ok ? undefined : reply.code(400).send({ errors: parsed.errors } satisfies ErrorResponse);
}

/** A query parameter given at most once; repeated parameters are refused rather than guessed at. */
function queryText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

/** `tags` is comma-separated (docs/api.md). Absent or empty means no tag filter; reading each tag is the domain's job. */
function pickedTags(text: string | undefined): string[] {
  if (text === undefined || text === "") return [];
  return text.split(",").filter((tag) => tag !== "");
}

export function registerRecipeRoutes(app: FastifyInstance, { recipes, clock, newRecipeId }: RecipeRouteDependencies): void {
  /** The recipe for `id`, if it exists; trashed recipes included. */
  async function load(rawId: string): Promise<Recipe | undefined> {
    const id = recipeIdOf(rawId);
    return id === undefined ? undefined : recipes.get(id);
  }

  /**
   * Steps 2-5 of "How a change is applied" (docs/architecture.md), after requireEditor and the body check: read the stored
   * recipe, apply one domain method (given the server's time where it records one, X-12), answer its errors without saving
   * (400, or 409 recipe.inTrash for a recipe in the trash, REC-17), otherwise save and return the recipe.
   */
  async function applyChange(
    reply: FastifyReply,
    rawId: string,
    change: (recipe: Recipe) => Result<unknown>,
  ): Promise<EditorRecipe | FastifyReply> {
    const recipe = await load(rawId);
    if (recipe === undefined) return sendNotFound(reply);
    const changed = change(recipe);
    if (!changed.ok) return sendErrors(reply, statusFor(changed.errors), changed.errors);
    await recipes.save(recipe);
    return toEditorRecipe(recipe);
  }

  // Responses here differ per caller (X-1: visitors and editors get different shapes) or are editor-only, so no shared cache
  // may keep one and hand it to someone else.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  // REC-8, REC-9, REC-13: search, tag filter and sorting are the domain's (docs/architecture.md, "Search and filtering").
  app.get<{ Querystring: ListQuery }>(
    "/recipes",
    async (request, reply): Promise<RecipeSummary[] | EditorRecipeSummary[] | FastifyReply> => {
      const name = queryText(request.query.name);
      const tags = queryText(request.query.tags);
      if (name === null || tags === null) {
        return sendErrors(reply, 400, [
          { code: "request.invalid", message: "Give each of name and tags at most once; tags are comma-separated." },
        ]);
      }
      const found = findRecipes(await recipes.list(), { name: name ?? "", tags: pickedTags(tags) });
      return isEditor(request.caller) ? found.map(toEditorRecipeSummary) : found.map(toRecipeSummary);
    },
  );

  // REC-13: public, like the recipes themselves (X-1).
  app.get("/tags", async (): Promise<TagCount[]> => tagsInUse(await recipes.list()).map(toTagCount));

  // REC-4: a recipe in the trash is not found, for editors too (docs/api.md).
  app.get<{ Params: IdParams }>("/recipes/:id", async (request, reply): Promise<PublicRecipe | EditorRecipe | FastifyReply> => {
    const recipe = await load(request.params.id);
    if (recipe === undefined || recipe.isDeleted) return sendNotFound(reply);
    return toRecipeFor(request.caller, recipe);
  });

  // REC-1: the id comes from the server; the content from the request.
  app.post("/recipes", { preHandler: requireEditor }, async (request, reply): Promise<EditorRecipe | FastifyReply> => {
    const input = parseBody(RecipeContentInput, request.body);
    if (!input.ok) return reply.code(400).send({ errors: input.errors } satisfies ErrorResponse);
    const created = Recipe.create(newRecipeId(), input.value);
    if (!created.ok) return sendErrors(reply, statusFor(created.errors), created.errors);
    await recipes.save(created.value);
    return reply.code(201).send(toEditorRecipe(created.value));
  });

  // REC-5. For a recipe in the trash the domain refuses the change with recipe.inTrash, answered 409 (REC-17, docs/api.md).
  // Only editors reach the lookup (requireEditor runs first), so a visitor can't tell a trashed id from an unknown one (X-1).
  app.put<{ Params: IdParams }>(
    "/recipes/:id/content",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      const input = parseBody(RecipeContentInput, request.body);
      if (!input.ok) return reply.code(400).send({ errors: input.errors } satisfies ErrorResponse);
      const recipe = await load(request.params.id);
      if (recipe === undefined) return sendNotFound(reply);
      const revised = recipe.revise(input.value);
      if (!revised.ok) return sendErrors(reply, statusFor(revised.errors), revised.errors);
      await recipes.save(recipe);
      return toEditorRecipe(recipe);
    },
  );

  // REC-6. Deleting a recipe already in the trash changes nothing and is not an error (REC-17).
  app.delete<{ Params: IdParams }>("/recipes/:id", { preHandler: requireEditor }, async (request, reply) => {
    const body = parseBody(EmptyRequest, request.body);
    if (!body.ok) return reply.code(400).send({ errors: body.errors } satisfies ErrorResponse);
    const recipe = await load(request.params.id);
    if (recipe === undefined) return sendNotFound(reply);
    recipe.delete(clock());
    await recipes.save(recipe);
    return reply.code(204).send();
  });

  // REC-14: editor-only (X-1).
  app.get("/trash", { preHandler: requireEditor }, async (): Promise<TrashEntry[]> =>
    trashContents(await recipes.list()).map(toTrashEntry),
  );

  // REC-15, REC-16: the 30 days are measured by the server's clock.
  app.post<{ Params: IdParams }>(
    "/trash/:id/restore",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      const body = parseBody(EmptyRequest, request.body);
      if (!body.ok) return reply.code(400).send({ errors: body.errors } satisfies ErrorResponse);
      const recipe = await load(request.params.id);
      if (recipe === undefined) return sendNotFound(reply);
      const restored = recipe.restore(clock());
      if (!restored.ok) return sendErrors(reply, statusFor(restored.errors), restored.errors);
      await recipes.save(recipe);
      return toEditorRecipe(recipe);
    },
  );

  // REC-10, REC-11: the tag travels in the body (TagRequest), not the address, because browsers rewrite tags such as "." or
  // ".." in an address (docs/api.md). The domain reads it (trimmed, lowercased). Attaching one the recipe already has changes
  // nothing, even at 20 tags.
  app.post<{ Params: IdParams }>(
    "/recipes/:id/tags",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      const input = parseBody(TagRequest, request.body);
      if (!input.ok) return reply.code(400).send({ errors: input.errors } satisfies ErrorResponse);
      return applyChange(reply, request.params.id, (recipe) => recipe.attachTag(input.value.tag));
    },
  );

  // REC-10: removing a tag the recipe doesn't have changes nothing.
  app.delete<{ Params: IdParams }>(
    "/recipes/:id/tags",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      const input = parseBody(TagRequest, request.body);
      if (!input.ok) return reply.code(400).send({ errors: input.errors } satisfies ErrorResponse);
      return applyChange(reply, request.params.id, (recipe) => recipe.removeTag(input.value.tag));
    },
  );

  // REC-12: editor-only, since only editors attach tags (X-6). Without recipeId (or with an empty one) the suggestions are for
  // a new recipe. A recipe in the trash is not found, as when reading it (REC-4).
  app.get<{ Querystring: SuggestionQuery }>(
    "/tag-suggestions",
    { preHandler: requireEditor },
    async (request, reply): Promise<Tag[] | FastifyReply> => {
      const typed = queryText(request.query.typed);
      const recipeId = queryText(request.query.recipeId);
      if (typed === null || recipeId === null) {
        return sendErrors(reply, 400, [{ code: "request.invalid", message: "Give each of typed and recipeId at most once." }]);
      }
      let forRecipe: Recipe | undefined;
      if (recipeId !== undefined && recipeId !== "") {
        const stored = await load(recipeId);
        if (stored === undefined || stored.isDeleted) return sendNotFound(reply);
        forRecipe = stored;
      }
      return suggestTags(await recipes.list(), forRecipe, typed ?? "").map(toTag);
    },
  );

  // PLAN-3: which recipes are listed and in what order is the domain's (toMakeList).
  app.get("/plan", { preHandler: requireEditor }, async (): Promise<ToMakeEntry[]> =>
    toMakeList(await recipes.list()).map(toToMakeEntry),
  );

  // PLAN-8: read-only; which ingredients are listed and in what order is the domain's (shoppingList). Ticks are the client's
  // and never reach the server.
  app.get("/plan/shopping-list", { preHandler: requireEditor }, async (): Promise<ShoppingItem[]> =>
    shoppingList(await recipes.list()).map(toShoppingItem),
  );

  // PLAN-1, PLAN-2: the added time is the server's (X-12); adding again keeps the original one.
  app.post<{ Params: IdParams }>(
    "/recipes/:id/add-to-plan",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> =>
      refuseUnlessEmpty(request.body, reply) ??
      applyChange(reply, request.params.id, (recipe) => recipe.addToMakeList(clock())),
  );

  // PLAN-4: content and cooking history are untouched; removing a recipe that isn't on the list changes nothing.
  app.post<{ Params: IdParams }>(
    "/recipes/:id/remove-from-plan",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> =>
      refuseUnlessEmpty(request.body, reply) ??
      applyChange(reply, request.params.id, (recipe) => recipe.removeFromMakeList()),
  );

  // COOK-1, PLAN-5: "I cooked this today" records the server's time (X-12), never one from the request, and takes the recipe
  // off the to-make list. Marking it again records another entry (COOK-4, withdrawn).
  app.post<{ Params: IdParams }>(
    "/recipes/:id/cookings",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> =>
      refuseUnlessEmpty(request.body, reply) ??
      applyChange(reply, request.params.id, (recipe) => recipe.markCooked(clock())),
  );

  // COOK-6: editor-only (X-1); the order is the domain's.
  app.get("/recommendations", { preHandler: requireEditor }, async (): Promise<RediscoverEntry[]> =>
    orderForRediscovery(await recipes.list()).map(toRediscoverEntry),
  );
}
