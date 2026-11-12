import { domainError, type DomainError } from "./errors.js";
import { Instant } from "./instant.js";
import { Recipe } from "./recipe.js";
import { RecipeId } from "./recipe-id.js";
import { RecipeName } from "./recipe-name.js";
import { fail, ok, type Result } from "./result.js";
import { Servings } from "./servings.js";
import { Tag } from "./tag.js";

/** How long an import may take, from the upload, by the server's clock (IMP-11, X-12). Fixed by the spec. */
export const IMPORT_MINUTES = 10;

// IMP-8: an imported recipe gets at most 5 tags.
const MAX_IMPORTED_TAGS = 5;

// Canonical 8-4-4-4-12 hex form, accepted in either case and stored in lowercase, as for `RecipeId`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An import's id: a UUID made by the server, stored in lowercase; created outside the domain like `RecipeId`. */
export class ImportId {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<ImportId> {
    if (raw.trim().length === 0) {
      return fail(domainError("importId.required", "An import ID is required.", "importId"));
    }
    if (!UUID.test(raw)) {
      return fail(domainError("importId.invalid", "An import ID must be a UUID.", "importId"));
    }
    return ok(new ImportId(raw.toLowerCase()));
  }

  get value(): string {
    return this.text;
  }

  equals(other: ImportId): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}

export type ImportStatus = "reading" | "done" | "failed";

/**
 * The stored Cosmos document (domain-model.md, "Recipe import snapshot"): one per import, its id the import's id (IMP-3).
 * The failure reason is not stored; the server logs it (IMP-11).
 */
export interface RecipeImportSnapshot {
  /** The import id. */
  id: string;
  /** ISO 8601 timestamp. */
  startedAt: string;
  status: ImportStatus;
  /** Only when done. */
  recipeId?: string;
  /** Only when done. */
  recipeName?: string;
}

/** What was read from the photo, after the server has checked its shape. */
export interface ReadRecipe {
  name: string;
  ingredients: string[];
  prep: string[];
  steps: string[];
  totalTimeMinutes?: number;
  /** Only when the page states how many people it serves (IMP-6, REC-24). */
  servings?: number;
  tags: string[];
}

/**
 * One import of a recipe from a photo; any number can be in progress at once (IMP-3). It is in progress while it is reading
 * and less than 10 minutes have passed since it started, by the server's clock (IMP-11, X-12).
 */
export class RecipeImport {
  private constructor(
    private readonly importId: ImportId,
    private readonly started: Instant,
    private status: ImportStatus,
    private result: { id: RecipeId; name: RecipeName } | undefined,
  ) {}

  /** A new import, reading. `at` is the server's current time (X-12). */
  static start(id: ImportId, at: Instant): RecipeImport {
    return new RecipeImport(id, at, "reading", undefined);
  }

  get id(): ImportId {
    return this.importId;
  }

  get startedAt(): Instant {
    return this.started;
  }

  /** IMP-11: one still reading at or after `startedAt` + 10 minutes has failed, though its stored status is "reading". */
  statusAt(now: Instant): ImportStatus {
    if (this.status === "reading" && !now.isBefore(this.deadline())) return "failed";
    return this.status;
  }

  /** IMP-5: whether its card is shown, by the server's clock (X-12). */
  isInProgress(now: Instant): boolean {
    return this.statusAt(now) === "reading";
  }

  /**
   * The recipe has been added (IMP-10); keeps its id and name. Refused with `import.finished` if the import already ended,
   * and with `import.timedOut` at or after the 10 minutes, so a recipe read too late is not added (IMP-11). `at` is the
   * server's current time (X-12).
   */
  succeed(recipe: Recipe, at: Instant): Result<void> {
    if (this.status !== "reading") {
      return fail(domainError("import.finished", "This import has already ended."));
    }
    if (!at.isBefore(this.deadline())) {
      return fail(domainError("import.timedOut", `This import took longer than ${IMPORT_MINUTES} minutes.`));
    }
    this.status = "done";
    this.result = { id: recipe.id, name: recipe.content.name };
    return ok(undefined);
  }

  /** The import failed (IMP-11). An import that already ended doesn't change. */
  fail(): void {
    if (this.status === "reading") this.status = "failed";
  }

  get recipeId(): RecipeId | undefined {
    return this.result?.id;
  }

  get recipeName(): RecipeName | undefined {
    return this.result?.name;
  }

  toSnapshot(): RecipeImportSnapshot {
    const snapshot: RecipeImportSnapshot = {
      id: this.importId.value,
      startedAt: this.started.toIso(),
      status: this.status,
    };
    if (this.result !== undefined) {
      snapshot.recipeId = this.result.id.value;
      snapshot.recipeName = this.result.name.value;
    }
    return snapshot;
  }

  /**
   * Rebuilds an import from its stored document, re-validating through the value objects. Throws on invalid data: bad data
   * in the database is a bug, not user input (domain-model.md). The stored document must be exactly the snapshot.
   */
  static fromSnapshot(s: RecipeImportSnapshot): RecipeImport {
    const status: unknown = s.status;
    if (status !== "reading" && status !== "done" && status !== "failed") {
      throw invalidSnapshot(`unknown status ${JSON.stringify(status)}`);
    }
    const expected = ["id", "startedAt", "status", ...(status === "done" ? ["recipeId", "recipeName"] : [])];
    const keys = Object.keys(s).sort();
    if (keys.length !== expected.length || !expected.sort().every((k, i) => keys[i] === k)) {
      throw invalidSnapshot(`unexpected fields ${JSON.stringify(keys)} for status ${status}`);
    }
    const importId = orThrow("id", ImportId.create(typeof s.id === "string" ? s.id : ""));
    // Parsing would silently canonicalize ids and times, so stored text must already be in canonical form.
    if (importId.value !== s.id) throw invalidSnapshot("id is not in its canonical form");
    const started = orThrow("startedAt", Instant.fromIso(s.startedAt));
    if (started.toIso() !== s.startedAt) throw invalidSnapshot("startedAt is not in its canonical form");
    let result: { id: RecipeId; name: RecipeName } | undefined;
    if (status === "done") {
      const recipeId = orThrow("recipeId", RecipeId.create(s.recipeId ?? ""));
      if (recipeId.value !== s.recipeId) throw invalidSnapshot("recipeId is not in its canonical form");
      const recipeName = orThrow("recipeName", RecipeName.create(s.recipeName ?? ""));
      if (recipeName.value !== s.recipeName) throw invalidSnapshot("recipeName is not in its validated form");
      result = { id: recipeId, name: recipeName };
    }
    return new RecipeImport(importId, started, status, result);
  }

  private deadline(): Instant {
    return this.started.plusMinutes(IMPORT_MINUTES);
  }
}

/**
 * Builds the recipe that was read from a photo (IMP-7), through `Recipe.create` so every content rule applies (REC-1,
 * REC-2, REC-11) and its errors come back unchanged. Only tags already in use are kept (IMP-8): each read tag is read like
 * tag input (REC-11); one that is invalid or not in `tagsInUse` is dropped, as are duplicates; the first 5 left, in the
 * order read, are kept. Dropped tags are never an error, and an import never creates a tag (REC-12). `at` is the server's
 * time when the recipe is added to the collection (IMP-10, X-12), and becomes its added time (REC-22).
 */
export function importedRecipe(id: RecipeId, read: ReadRecipe, tagsInUse: readonly Tag[], at: Instant): Result<Recipe> {
  const kept: Tag[] = [];
  for (const raw of read.tags) {
    if (kept.length === MAX_IMPORTED_TAGS) break;
    const tag = Tag.create(raw);
    if (!tag.ok) continue;
    if (!tagsInUse.some((t) => t.equals(tag.value))) continue;
    if (kept.some((t) => t.equals(tag.value))) continue;
    kept.push(tag.value);
  }
  return Recipe.create(
    id,
    {
      name: read.name,
      ingredients: read.ingredients,
      prep: read.prep,
      steps: read.steps,
      totalTimeMinutes: read.totalTimeMinutes,
      // IMP-6: servings read outside 1–100 are dropped rather than failing the import.
      servings: read.servings !== undefined && Servings.create(read.servings).ok ? read.servings : undefined,
      tags: kept.map((t) => t.value),
    },
    at,
  );
}

function orThrow<T>(part: string, result: Result<T>): T {
  if (!result.ok) throw invalidSnapshot(`invalid ${part}: ${describe(result.errors)}`);
  return result.value;
}

function describe(errors: readonly DomainError[]): string {
  return errors.map((e) => e.code).join(", ");
}

// No recipe text in the message: errors are logged, and IMP-11 keeps recipe text out of the logs.
function invalidSnapshot(reason: string): Error {
  return new Error(`Invalid stored recipe import: ${reason}`);
}
