// The core recipe endpoints (docs/api.md): list, tags, view, create, edit, delete, trash and restore.
//
// Every change follows docs/architecture.md, "How a change is applied": requireEditor (X-6), read the stored recipe, call one
// domain method with the request's input and the server's time (X-12), answer domain errors without saving, then save the
// snapshot. No document sent by the client is ever saved, and no request field is ever used as a time.
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  type DomainError,
  findRecipes,
  Recipe,
  RecipeId,
  tagsInUse,
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
  type TagCount,
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
  toTagCount,
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

/**
 * Status for a refused change (docs/api.md, errors table): 409 when the recipe's state refuses it (REC-16, REC-17),
 * otherwise 400 for invalid input.
 */
const STATE_ERRORS: Readonly<Record<string, number>> = {
  "recipe.inTrash": 409,
  "trash.expired": 409,
};

function statusFor(errors: readonly DomainError[]): number {
  for (const e of errors) {
    const status = STATE_ERRORS[e.code];
    if (status !== undefined) return status;
  }
  return 400;
}

function errorItems(errors: readonly DomainError[]): ErrorItem[] {
  return errors.map((e) => (e.field === undefined ? { code: e.code, message: e.message } : { ...e }));
}

function sendErrors(reply: FastifyReply, status: number, errors: readonly DomainError[]): FastifyReply {
  const body: ErrorResponse = { errors: errorItems(errors) };
  return reply.code(status).send(body);
}

/**
 * The same answer for a recipe that doesn't exist, a malformed id and (when reading) a recipe in the trash, so a visitor can't
 * tell them apart (REC-4, REC-6, X-1). An editor changing a trashed recipe gets 409 recipe.inTrash instead (REC-17).
 */
function sendNotFound(reply: FastifyReply): FastifyReply {
  return sendErrors(reply, 404, [{ code: "recipe.notFound", message: "This recipe doesn't exist." }]);
}

/** Recipe ids are UUIDs; a malformed one is treated as not found (docs/api.md, "Conventions"). */
function recipeIdOf(raw: string): RecipeId | undefined {
  const id = RecipeId.create(raw);
  return id.ok ? id.value : undefined;
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
}
