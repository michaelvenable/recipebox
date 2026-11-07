import { domainError, type DomainError } from "./errors.js";
import { Instant } from "./instant.js";
import { PhotoRef } from "./photo-ref.js";
import { MAX_TAGS, RecipeContent, type RecipeContentInput } from "./recipe-content.js";
import { RecipeId } from "./recipe-id.js";
import { fail, ok, type Result } from "./result.js";
import { Tag } from "./tag.js";

/** How long a deleted recipe can still be restored (REC-16). Fixed; changing it is out of scope. */
export const TRASH_RETENTION_DAYS = 30;

/** The stored Cosmos document (domain-model.md, "Snapshot"). */
export interface RecipeSnapshot {
  id: string;
  name: string;
  ingredients: string[];
  /** Omitted when there is none; documents stored before REC-20 have no prep. */
  prep?: string[];
  steps: string[];
  totalTimeMinutes?: number;
  /** Lowercase, unique, alphabetical. */
  tags: string[];
  photo?: { blobName: string; contentType: string };
  /** ISO 8601 timestamp. */
  toMake?: { addedAt: string };
  /** ISO 8601 timestamps, newest first; duplicates allowed (COOK-4, withdrawn). */
  cookedAt: string[];
  /** ISO 8601 timestamp; present only while in the trash. */
  deletedAt?: string;
  schemaVersion: 1;
}

/**
 * The aggregate root: one recipe with its photo, to-make status, cooking history and trash state, stored as one document.
 * Every change goes through a method here. Every `Instant` passed in is the server's clock (X-12).
 */
export class Recipe {
  private constructor(
    private readonly recipeId: RecipeId,
    private recipeContent: RecipeContent,
    private photoRef: PhotoRef | undefined,
    private toMakeAddedAt: Instant | undefined,
    /** Newest first (COOK-5). */
    private cookings: Instant[],
    private deletedTime: Instant | undefined,
  ) {}

  static create(id: RecipeId, content: RecipeContentInput): Result<Recipe> {
    const created = RecipeContent.create(content);
    if (!created.ok) return created;
    return ok(new Recipe(id, created.value, undefined, undefined, [], undefined));
  }

  get id(): RecipeId {
    return this.recipeId;
  }

  get content(): RecipeContent {
    return this.recipeContent;
  }

  get photo(): PhotoRef | undefined {
    return this.photoRef;
  }

  // Content

  /** Replaces all content, including tags; photo, to-make status and history are untouched (REC-5). */
  revise(content: RecipeContentInput): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const revised = RecipeContent.create(content);
    if (!revised.ok) return revised;
    this.recipeContent = revised.value;
    return ok(undefined);
  }

  /** Returns the photo it replaced, so the infrastructure can delete that blob (REC-7). */
  setPhoto(photo: PhotoRef): Result<{ replaced?: PhotoRef }> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const previous = this.photoRef;
    this.photoRef = photo;
    // Setting the same photo again replaces nothing; reporting it would get the current blob deleted.
    return ok(previous === undefined || previous.equals(photo) ? {} : { replaced: previous });
  }

  /** Returns the photo it removed, so the infrastructure can delete that blob (REC-7). */
  removePhoto(): Result<{ removed?: PhotoRef }> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const previous = this.photoRef;
    this.photoRef = undefined;
    return ok(previous === undefined ? {} : { removed: previous });
  }

  // Deletion

  /** Moves the recipe to the trash and takes it off the to-make list (REC-6, PLAN-6). Already deleted: no-op. */
  delete(at: Instant): void {
    if (this.deletedTime !== undefined) return;
    this.deletedTime = at;
    this.toMakeAddedAt = undefined;
  }

  /**
   * Takes the recipe out of the trash with content, photo, tags and history unchanged; it stays off the to-make list
   * (REC-15, PLAN-6). Refused at or after `removalDueAt` (REC-16). Not deleted: no-op.
   */
  restore(at: Instant): Result<void> {
    const due = this.removalDueAt();
    if (due === undefined) return ok(undefined);
    if (!at.isBefore(due)) {
      return fail(domainError("trash.expired", "This recipe has been in the trash for 30 days and can no longer be restored."));
    }
    this.deletedTime = undefined;
    return ok(undefined);
  }

  get isDeleted(): boolean {
    return this.deletedTime !== undefined;
  }

  get deletedAt(): Instant | undefined {
    return this.deletedTime;
  }

  /** When the trash period ends (REC-14, REC-16). Carrying out the removal is the infrastructure's job. */
  removalDueAt(): Instant | undefined {
    return this.deletedTime?.plusDays(TRASH_RETENTION_DAYS);
  }

  // Tags

  /** Already attached: no-op, even at 20 tags. Otherwise fails if the tag is invalid or 20 are attached (REC-10, REC-11). */
  attachTag(tag: string): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const parsed = Tag.create(tag);
    if (!parsed.ok) return parsed;
    const current = this.recipeContent.tags;
    if (current.some((t) => t.equals(parsed.value))) return ok(undefined);
    if (current.length >= MAX_TAGS) {
      return fail(domainError("tags.tooMany", `A recipe can have at most ${MAX_TAGS} tags.`, "tags"));
    }
    this.recipeContent = withTags(this.recipeContent, [...current, parsed.value]);
    return ok(undefined);
  }

  /** If the tag isn't attached, does nothing (REC-10). */
  removeTag(tag: string): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const parsed = Tag.create(tag);
    // A text that isn't a valid tag can't be attached, so there is nothing to remove.
    if (!parsed.ok) return ok(undefined);
    const current = this.recipeContent.tags;
    const remaining = current.filter((t) => !t.equals(parsed.value));
    if (remaining.length !== current.length) {
      this.recipeContent = withTags(this.recipeContent, remaining);
    }
    return ok(undefined);
  }

  /** Alphabetical (REC-11). */
  get tags(): readonly Tag[] {
    return this.recipeContent.tags;
  }

  // To-make list

  /** Already on the list: no-op, keeping the original added time (PLAN-1, PLAN-2). */
  addToMakeList(at: Instant): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    if (this.toMakeAddedAt === undefined) this.toMakeAddedAt = at;
    return ok(undefined);
  }

  /** Not on the list: no-op. Content and history are untouched (PLAN-4). */
  removeFromMakeList(): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    this.toMakeAddedAt = undefined;
    return ok(undefined);
  }

  get isOnMakeList(): boolean {
    return this.toMakeAddedAt !== undefined;
  }

  get addedToMakeListAt(): Instant | undefined {
    return this.toMakeAddedAt;
  }

  // Cooking history

  /** Always records an entry, even a duplicate (COOK-1, COOK-4 withdrawn), and takes the recipe off the list (PLAN-5). */
  markCooked(at: Instant): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    // Insert in order rather than assume `at` is the newest: the server's clock may step back.
    const index = this.cookings.findIndex((c) => c.isBefore(at));
    this.cookings.splice(index === -1 ? this.cookings.length : index, 0, at);
    this.toMakeAddedAt = undefined;
    return ok(undefined);
  }

  /** Newest first (COOK-5). */
  get cookedAt(): readonly Instant[] {
    return Object.freeze([...this.cookings]);
  }

  /** Derived from `cookedAt`, never stored, so it can't drift (COOK-5). */
  get lastCookedAt(): Instant | undefined {
    return this.cookings[0];
  }

  /** Derived from `cookedAt`, never stored, so it can't drift (COOK-5). */
  get timesCooked(): number {
    return this.cookings.length;
  }

  // Persistence

  toSnapshot(): RecipeSnapshot {
    const c = this.recipeContent;
    const snapshot: RecipeSnapshot = {
      id: this.recipeId.value,
      name: c.name.value,
      ingredients: c.ingredients.map((e) => e.value),
      steps: c.steps.map((e) => e.value),
      tags: c.tags.map((t) => t.value),
      cookedAt: this.cookings.map((i) => i.toIso()),
      schemaVersion: 1,
    };
    if (c.prep.length > 0) snapshot.prep = c.prep.map((e) => e.value);
    if (c.totalTime !== undefined) snapshot.totalTimeMinutes = c.totalTime.value;
    if (this.photoRef !== undefined) {
      snapshot.photo = { blobName: this.photoRef.blobName, contentType: this.photoRef.contentType };
    }
    if (this.toMakeAddedAt !== undefined) snapshot.toMake = { addedAt: this.toMakeAddedAt.toIso() };
    if (this.deletedTime !== undefined) snapshot.deletedAt = this.deletedTime.toIso();
    return snapshot;
  }

  /**
   * Rebuilds a recipe from its stored document, re-validating through the value objects. Throws on invalid data: bad data
   * in the database is a bug, not user input (domain-model.md).
   */
  static fromSnapshot(s: RecipeSnapshot): Recipe {
    const schemaVersion: unknown = s.schemaVersion;
    if (schemaVersion !== 1) {
      throw invalidSnapshot(s, `unsupported schemaVersion ${String(schemaVersion)}`);
    }
    const id = orThrow(s, "id", RecipeId.create(s.id));
    // Parsing would silently canonicalize the id and times too, so stored text must already be in canonical form.
    if (id.value !== s.id) throw invalidSnapshot(s, "id is not in its canonical form");
    const content = orThrow(
      s,
      "content",
      RecipeContent.create({
        name: s.name,
        ingredients: s.ingredients,
        prep: s.prep,
        steps: s.steps,
        totalTimeMinutes: s.totalTimeMinutes,
        tags: s.tags,
      }),
    );
    // Validating would silently clean up text that was never valid to store (untrimmed, blank entries, unsorted or
    // duplicate tags), so stored content must already be in the form validation produces.
    if (
      content.name.value !== s.name ||
      !sameTexts(content.ingredients, s.ingredients) ||
      !sameTexts(content.prep, s.prep ?? []) ||
      !sameTexts(content.steps, s.steps) ||
      !sameTexts(content.tags, s.tags)
    ) {
      throw invalidSnapshot(s, "content is not in its validated form");
    }
    const photo = s.photo === undefined ? undefined : orThrow(s, "photo", PhotoRef.create(s.photo));
    const addedAt = s.toMake === undefined ? undefined : storedInstant(s, "toMake.addedAt", s.toMake.addedAt);
    const cookedAt = s.cookedAt.map((iso, i) => storedInstant(s, `cookedAt[${i}]`, iso));
    if (cookedAt.some((at, i) => i > 0 && cookedAt[i - 1]!.isBefore(at))) {
      throw invalidSnapshot(s, "cookedAt is not newest first");
    }
    const deletedAt = s.deletedAt === undefined ? undefined : storedInstant(s, "deletedAt", s.deletedAt);
    if (deletedAt !== undefined && addedAt !== undefined) {
      throw invalidSnapshot(s, "a deleted recipe can't be on the to-make list (PLAN-6)");
    }
    return new Recipe(id, content, photo, addedAt, cookedAt, deletedAt);
  }

  /** REC-17: every change except `restore` is refused while the recipe is in the trash, and nothing changes. */
  private refuseIfInTrash(): Result<never> | undefined {
    if (this.deletedTime === undefined) return undefined;
    return fail(domainError("recipe.inTrash", "This recipe is in the trash. Restore it before changing it."));
  }
}

function contentInput(content: RecipeContent): RecipeContentInput {
  return {
    name: content.name.value,
    ingredients: content.ingredients.map((e) => e.value),
    prep: content.prep.map((e) => e.value),
    steps: content.steps.map((e) => e.value),
    totalTimeMinutes: content.totalTime?.value,
    tags: content.tags.map((t) => t.value),
  };
}

/** The same content with a different tag set; rebuilt through `RecipeContent` so tags stay unique and sorted (REC-11). */
function withTags(content: RecipeContent, tags: readonly Tag[]): RecipeContent {
  const rebuilt = RecipeContent.create({ ...contentInput(content), tags: tags.map((t) => t.value) });
  if (!rebuilt.ok) {
    throw new Error(`Valid content became invalid when changing tags: ${JSON.stringify(rebuilt.errors)}`);
  }
  return rebuilt.value;
}

function sameTexts(values: readonly { value: string }[], stored: readonly string[]): boolean {
  return values.length === stored.length && values.every((v, i) => v.value === stored[i]);
}

function orThrow<T>(s: RecipeSnapshot, part: string, result: Result<T>): T {
  if (!result.ok) throw invalidSnapshot(s, `invalid ${part}: ${describe(result.errors)}`);
  return result.value;
}

function storedInstant(s: RecipeSnapshot, part: string, iso: string): Instant {
  const instant = orThrow(s, part, Instant.fromIso(iso));
  if (instant.toIso() !== iso) throw invalidSnapshot(s, `${part} is not in its canonical form`);
  return instant;
}

function describe(errors: readonly DomainError[]): string {
  return errors.map((e) => (e.field === undefined ? e.code : `${e.code} (${e.field})`)).join(", ");
}

function invalidSnapshot(s: RecipeSnapshot, reason: string): Error {
  return new Error(`Invalid stored recipe ${String(s.id)}: ${reason}`);
}
