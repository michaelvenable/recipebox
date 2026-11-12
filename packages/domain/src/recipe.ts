import { domainError, type DomainError } from "./errors.js";
import { Instant } from "./instant.js";
import { MAX_NOTES, Note, NoteId, NoteText } from "./note.js";
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
  /** Omitted when there is none; documents stored before REC-24 have no servings. */
  servings?: number;
  /** Lowercase, unique, alphabetical. */
  tags: string[];
  photo?: { blobName: string; contentType: string };
  /** ISO 8601 timestamp. */
  toMake?: { addedAt: string };
  /** ISO 8601 timestamps, newest first; duplicates allowed (COOK-4, withdrawn). */
  cookedAt: string[];
  /** ISO 8601 timestamp; present only while in the trash. */
  deletedAt?: string;
  /** ISO 8601 timestamp: the recipe's added time (REC-22). Documents stored before it was recorded have none. */
  createdAt?: string;
  /** Newest first; omitted when there are none, so documents stored before REC-25 load unchanged. */
  notes?: RecipeNoteSnapshot[];
  schemaVersion: 1;
}

/** One note in the stored document (REC-25). */
export interface RecipeNoteSnapshot {
  /** Lowercase UUID. */
  id: string;
  text: string;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

/**
 * The aggregate root: one recipe with its photo, to-make status, cooking history, notes and trash state, stored as one document.
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
    /** Set once, by `create`; nothing changes it (REC-22). Undefined for recipes stored before it was recorded. */
    private readonly createdTime: Instant | undefined,
    /** Newest first (REC-25). */
    private noteList: Note[],
  ) {}

  /**
   * A new recipe (REC-1), or one an import adds to the collection (IMP-10). `at` is the server's current time (X-12) and
   * becomes the recipe's added time (REC-22).
   */
  static create(id: RecipeId, content: RecipeContentInput, at: Instant): Result<Recipe> {
    const created = RecipeContent.create(content);
    if (!created.ok) return created;
    return ok(new Recipe(id, created.value, undefined, undefined, [], undefined, at, []));
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

  /**
   * When the recipe was added (REC-22). It never changes: edits, photo changes, deleting and restoring keep it. Undefined
   * for a recipe stored before added times were recorded; such a recipe never shows as recently added.
   */
  get createdAt(): Instant | undefined {
    return this.createdTime;
  }

  // Content

  /** Replaces all content, including tags; photo, to-make status, history and notes are untouched (REC-5, REC-25). */
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
   * Takes the recipe out of the trash with content, photo, tags, history and notes unchanged; it stays off the to-make list
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

  // Notes

  /**
   * Adds a note with the server's time (REC-25, X-12). `id` is made outside the domain, like a `RecipeId`. Fails if the text is
   * blank or too long after trimming, or if the recipe already has 50 notes.
   */
  addNote(id: NoteId, text: string, at: Instant): Result<Note> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const parsed = NoteText.create(text);
    if (!parsed.ok) return parsed;
    if (this.noteList.length >= MAX_NOTES) {
      return fail(domainError("notes.tooMany", `A recipe can have at most ${MAX_NOTES} notes.`));
    }
    // A fresh id that is already taken means the server's id source is broken: a bug, not user input.
    if (this.noteList.some((n) => n.id.equals(id))) throw new Error(`Note id ${id.value} is already used on this recipe`);
    const note = new Note(id, parsed.value, at);
    // Insert in order rather than assume `at` is the newest: the server's clock may step back. Ahead of notes with the same
    // time, so the note just added is listed first.
    const index = this.noteList.findIndex((n) => !at.isBefore(n.addedAt));
    this.noteList.splice(index === -1 ? this.noteList.length : index, 0, note);
    return ok(note);
  }

  /**
   * Deletes a note, at once (REC-25). `id` is the text from the request: one that isn't a note of this recipe, malformed or
   * not, fails with `note.notFound`, for example when another device has already deleted it.
   */
  deleteNote(id: string): Result<void> {
    const refused = this.refuseIfInTrash();
    if (refused) return refused;
    const parsed = NoteId.create(id);
    const index = parsed.ok ? this.noteList.findIndex((n) => n.id.equals(parsed.value)) : -1;
    if (index === -1) return fail(domainError("note.notFound", "This note doesn't exist. It may have been deleted already."));
    this.noteList.splice(index, 1);
    return ok(undefined);
  }

  /** Newest first (REC-25). */
  get notes(): readonly Note[] {
    return Object.freeze([...this.noteList]);
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
    if (c.servings !== undefined) snapshot.servings = c.servings.value;
    if (this.photoRef !== undefined) {
      snapshot.photo = { blobName: this.photoRef.blobName, contentType: this.photoRef.contentType };
    }
    if (this.toMakeAddedAt !== undefined) snapshot.toMake = { addedAt: this.toMakeAddedAt.toIso() };
    if (this.deletedTime !== undefined) snapshot.deletedAt = this.deletedTime.toIso();
    if (this.createdTime !== undefined) snapshot.createdAt = this.createdTime.toIso();
    if (this.noteList.length > 0) {
      snapshot.notes = this.noteList.map((n) => ({ id: n.id.value, text: n.text.value, addedAt: n.addedAt.toIso() }));
    }
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
        servings: s.servings,
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
    // Optional: documents stored before REC-22 have no added time, and none is made up for them.
    const createdAt = s.createdAt === undefined ? undefined : storedInstant(s, "createdAt", s.createdAt);
    // Optional: documents stored before REC-25 have no notes.
    const notes = (s.notes ?? []).map((n, i) => storedNote(s, i, n));
    if (notes.length > MAX_NOTES) throw invalidSnapshot(s, `more than ${MAX_NOTES} notes`);
    if (notes.some((n, i) => i > 0 && notes[i - 1]!.addedAt.isBefore(n.addedAt))) {
      throw invalidSnapshot(s, "notes are not newest first");
    }
    if (new Set(notes.map((n) => n.id.value)).size !== notes.length) throw invalidSnapshot(s, "two notes have the same id");
    return new Recipe(id, content, photo, addedAt, cookedAt, deletedAt, createdAt, notes);
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
    servings: content.servings?.value,
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

function storedNote(s: RecipeSnapshot, i: number, stored: RecipeNoteSnapshot): Note {
  const part = `notes[${i}]`;
  const id = orThrow(s, `${part}.id`, NoteId.create(stored.id));
  const text = orThrow(s, `${part}.text`, NoteText.create(stored.text));
  // As for content: stored text must already be in the form validation produces.
  if (id.value !== stored.id || text.value !== stored.text) throw invalidSnapshot(s, `${part} is not in its validated form`);
  return new Note(id, text, storedInstant(s, `${part}.addedAt`, stored.addedAt));
}

function describe(errors: readonly DomainError[]): string {
  return errors.map((e) => (e.field === undefined ? e.code : `${e.code} (${e.field})`)).join(", ");
}

function invalidSnapshot(s: RecipeSnapshot, reason: string): Error {
  return new Error(`Invalid stored recipe ${String(s.id)}: ${reason}`);
}
