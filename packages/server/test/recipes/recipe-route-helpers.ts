import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { Instant, NoteId, Recipe, RecipeId, type RecipeContentInput } from "@recipebox/domain";
import { EditorRecipe, ErrorResponse } from "@recipebox/shared";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import { EDITOR, NON_EDITOR, appWith, instant } from "../app-helpers.js";

export const JSON_HEADERS = { "content-type": "application/json" };
export const AS_EDITOR = { "x-dev-identity": EDITOR };
export const AS_NON_EDITOR = { "x-dev-identity": NON_EDITOR };
export const AS_VISITOR = {};

/** Fields only editors may see (docs/api.md, "Shapes"; X-1). */
export const PRIVATE_FIELDS = [
  "toMake",
  "cookedAt",
  "lastCookedAt",
  "timesCooked",
  "deletedAt",
  "removalDueAt",
  "onToMakeList",
  "notes",
];

/** The server's clock as tests control it (X-12). */
export class TestClock {
  private current: Instant;

  constructor(iso: string) {
    this.current = instant(iso);
  }

  set(iso: string): void {
    this.current = instant(iso);
  }

  readonly now = (): Instant => this.current;
}

/** Ids 00000000-0000-4000-8000-000000000001, …002, … in order of creation. */
export function sequentialIds(): () => RecipeId {
  let n = 0;
  return () => recipeId(`00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
}

/** Note ids 11111111-0000-4000-8000-000000000001, …002, … in order of creation (REC-25). */
export function sequentialNoteIds(): () => NoteId {
  let n = 0;
  return () => noteId(`11111111-0000-4000-8000-${String(++n).padStart(12, "0")}`);
}

export function noteId(text: string): NoteId {
  const id = NoteId.create(text);
  if (!id.ok) throw new Error(`Not a note id: ${text}`);
  return id.value;
}

export function recipeId(text: string): RecipeId {
  const id = RecipeId.create(text);
  if (!id.ok) throw new Error(`Not a recipe id: ${text}`);
  return id.value;
}

export interface RecipeTestApp {
  app: FastifyInstance;
  repository: InMemoryRecipeRepository;
  clock: TestClock;
}

export async function recipeApp(now = "2026-10-01T09:00:00.000Z"): Promise<RecipeTestApp> {
  const repository = new InMemoryRecipeRepository();
  const clock = new TestClock(now);
  const app = await appWith({}, false, {
    recipes: repository,
    clock: clock.now,
    newRecipeId: sequentialIds(),
    newNoteId: sequentialNoteIds(),
  });
  return { app, repository, clock };
}

export function content(name: string, extra: Partial<RecipeContentInput> = {}): RecipeContentInput {
  return { name, ingredients: ["1 thing"], steps: ["Do it."], ...extra };
}

let seeded = 0;
let seededNotes = 0;

/**
 * Stores a recipe directly in the repository, with history, list state and notes that endpoints of later tasks (cookings,
 * to-make, notes) would otherwise set. Times are applied in order: cooked, added to the list, notes added, deleted. `createdAt`
 * is its added time (REC-22), SEEDED_AT unless given; `null` stores it as a recipe from before added times were recorded, which
 * has none.
 */
export async function seed(
  repository: InMemoryRecipeRepository,
  input: RecipeContentInput,
  state: {
    createdAt?: string | null;
    cookedAt?: string[];
    toMakeAt?: string;
    notes?: { text: string; at: string }[];
    deletedAt?: string;
  } = {},
): Promise<Recipe> {
  const id = recipeId(`aaaaaaaa-0000-4000-8000-${String(++seeded).padStart(12, "0")}`);
  const created = Recipe.create(id, input, instant(state.createdAt ?? SEEDED_AT));
  if (!created.ok) throw new Error(`Invalid seed recipe: ${JSON.stringify(created.errors)}`);
  const recipe = state.createdAt === null ? withoutAddedTime(created.value) : created.value;
  for (const at of state.cookedAt ?? []) expectOk(recipe.markCooked(instant(at)));
  if (state.toMakeAt !== undefined) expectOk(recipe.addToMakeList(instant(state.toMakeAt)));
  for (const note of state.notes ?? []) {
    const id = noteId(`dddddddd-0000-4000-8000-${String(++seededNotes).padStart(12, "0")}`);
    expectOk(recipe.addNote(id, note.text, instant(note.at)));
  }
  if (state.deletedAt !== undefined) recipe.delete(instant(state.deletedAt));
  await repository.save(recipe);
  return recipe;
}

/** The added time of a seeded recipe when the test doesn't give one (REC-22). */
export const SEEDED_AT = "2026-09-01T09:00:00.000Z";

/** The recipe as it would be stored before added times were recorded (REC-22): the same document without `createdAt`. */
function withoutAddedTime(recipe: Recipe): Recipe {
  const { createdAt: _, ...stored } = recipe.toSnapshot();
  return Recipe.fromSnapshot(stored);
}

function expectOk(result: { ok: boolean }): void {
  if (!result.ok) throw new Error(`Seeding failed: ${JSON.stringify(result)}`);
}

type Headers = Record<string, string>;

export function get(app: FastifyInstance, url: string, as: Headers = AS_VISITOR): Promise<LightMyRequestResponse> {
  return app.inject({ method: "GET", url, headers: as });
}

export function change(
  app: FastifyInstance,
  method: "POST" | "PUT" | "DELETE",
  url: string,
  payload: unknown = {},
  as: Headers = AS_EDITOR,
): Promise<LightMyRequestResponse> {
  return app.inject({ method, url, headers: { ...JSON_HEADERS, ...as }, payload: JSON.stringify(payload) });
}

export async function createRecipe(app: FastifyInstance, input: unknown): Promise<EditorRecipe> {
  const res = await change(app, "POST", "/recipes", input);
  expect(res.statusCode, res.body).toBe(201);
  return EditorRecipe.parse(res.json());
}

/** The response is an `ErrorResponse` with this status, and these error codes in order. */
export function expectErrors(res: LightMyRequestResponse, status: number, codes: readonly string[]): ErrorResponse {
  expect(res.statusCode, res.body).toBe(status);
  const body = ErrorResponse.parse(res.json());
  expect(body.errors.map((e) => e.code)).toEqual(codes);
  return body;
}

/** Every stored snapshot, by id, to show a refused request changed nothing. */
export async function storedSnapshots(repository: InMemoryRecipeRepository): Promise<Record<string, unknown>> {
  const all = await repository.list();
  return Object.fromEntries(all.map((r) => [r.id.value, r.toSnapshot()]));
}
