import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PhotoRef, Recipe, type RecipeId } from "@recipebox/domain";
import { type CleanupLogger, MAX_ORPHANS_PER_RUN, runCleanup } from "../../src/jobs/run-cleanup.js";
import { imageNamesOf, newPhotoName } from "../../src/photos/photo-names.js";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import type { RecipeRepository, RecipeVersion } from "../../src/recipes/recipe-repository.js";
import { instant } from "../app-helpers.js";
import { content, recipeId, TestClock } from "../recipes/recipe-route-helpers.js";

/** Deleted at this time, a recipe's removal is due 30 days later, at DUE (REC-16). */
const DELETED = "2026-09-01T09:00:00.000Z";
const DUE = "2026-10-01T09:00:00.000Z";
const JUST_BEFORE_DUE = "2026-10-01T08:59:59.999Z";

class RecordingLogger implements CleanupLogger {
  readonly errors: { details: object; message: string }[] = [];
  info(): void {}
  error(details: object, message: string): void {
    this.errors.push({ details, message });
  }
}

let clock: TestClock;
let recipes: InMemoryRecipeRepository;
let photos: InMemoryPhotoStore;
let logger: RecordingLogger;

beforeEach(() => {
  // Images are uploaded long before the cleanup runs, unless a test says otherwise.
  clock = new TestClock("2026-08-01T09:00:00.000Z");
  recipes = new InMemoryRecipeRepository();
  photos = new InMemoryPhotoStore(clock.now);
  logger = new RecordingLogger();
});

function cleanup(deps: Partial<Parameters<typeof runCleanup>[0]> = {}) {
  return runCleanup({ recipes, photos, clock: clock.now, logger, ...deps });
}

/** Stores a photo's display image and thumbnail at the clock's current time, as an upload does. */
async function storeImages(id: RecipeId): Promise<PhotoRef> {
  const ref = PhotoRef.create({ blobName: newPhotoName(id), contentType: "image/jpeg" });
  if (!ref.ok) throw new Error("invalid photo ref");
  for (const name of imageNamesOf(ref.value)) await photos.put(name, Buffer.from(name), "image/jpeg");
  return ref.value;
}

/** A stored recipe with a photo, deleted at `deletedAt` if given. */
async function recipeWithPhoto(deletedAt?: string): Promise<Recipe> {
  const id = recipeId(randomUUID());
  const created = Recipe.create(id, content(`Recipe ${id.value}`), instant("2026-09-01T09:00:00.000Z"));
  if (!created.ok) throw new Error("invalid recipe");
  const recipe = created.value;
  const set = recipe.setPhoto(await storeImages(id));
  if (!set.ok) throw new Error("could not set photo");
  if (deletedAt !== undefined) recipe.delete(instant(deletedAt));
  await recipes.save(recipe);
  return recipe;
}

function imagesOf(recipe: Recipe): string[] {
  return imageNamesOf(recipe.photo!);
}

describe("REC-16 permanent removal", () => {
  it("removes a recipe exactly at removalDueAt, with its photo and thumbnail", async () => {
    const due = await recipeWithPhoto(DELETED);
    clock.set(DUE);

    const summary = await cleanup();

    expect(await recipes.get(due.id)).toBeUndefined();
    expect(photos.names()).toEqual([]);
    expect(summary).toEqual({ recipesRemoved: 1, imagesDeleted: 2, orphansDeleted: 0, failures: 0 });
  });

  it("removes a recipe well past removalDueAt", async () => {
    const due = await recipeWithPhoto(DELETED);
    clock.set("2026-10-02T10:00:00.000Z");

    await cleanup();

    expect(await recipes.get(due.id)).toBeUndefined();
    expect(photos.names()).toEqual([]);
  });

  it("keeps a recipe 1 ms before removalDueAt, with its images", async () => {
    const notYet = await recipeWithPhoto(DELETED);
    clock.set(JUST_BEFORE_DUE);

    const summary = await cleanup();

    expect((await recipes.get(notYet.id))?.toSnapshot()).toEqual(notYet.toSnapshot());
    expect(photos.names()).toEqual(imagesOf(notYet).sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("keeps recipes not in the trash, with their images", async () => {
    const kept = await recipeWithPhoto();
    clock.set("2027-10-01T09:00:00.000Z");

    await cleanup();

    expect((await recipes.get(kept.id))?.toSnapshot()).toEqual(kept.toSnapshot());
    expect(photos.names()).toEqual(imagesOf(kept).sort());
  });

  it("removes only the due recipes among others", async () => {
    const due = await recipeWithPhoto(DELETED);
    const notDue = await recipeWithPhoto("2026-09-15T09:00:00.000Z");
    const live = await recipeWithPhoto();
    clock.set(DUE);

    const summary = await cleanup();

    expect(await recipes.get(due.id)).toBeUndefined();
    expect(await recipes.get(notDue.id)).toBeDefined();
    expect(await recipes.get(live.id)).toBeDefined();
    expect(photos.names()).toEqual([...imagesOf(notDue), ...imagesOf(live)].sort());
    expect(summary.recipesRemoved).toBe(1);
  });

  it("removes a due recipe without a photo", async () => {
    const created = Recipe.create(recipeId(randomUUID()), content("No photo"), instant("2026-09-01T09:00:00.000Z"));
    if (!created.ok) throw new Error("invalid recipe");
    created.value.delete(instant(DELETED));
    await recipes.save(created.value);
    clock.set(DUE);

    const summary = await cleanup();

    expect(await recipes.get(created.value.id)).toBeUndefined();
    expect(summary).toEqual({ recipesRemoved: 1, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("doesn't remove a recipe restored after it was listed", async () => {
    const restored = await recipeWithPhoto(DELETED);
    clock.set(DUE);
    // A restore handled by the API just before the deadline, saved after the job listed the recipes.
    const racing = new RacingRepository(recipes, async () => {
      const recipe = (await recipes.get(restored.id))!;
      expect(recipe.restore(instant(JUST_BEFORE_DUE)).ok).toBe(true);
      await recipes.save(recipe);
    });

    const summary = await cleanup({ recipes: racing });

    expect((await recipes.get(restored.id))?.isDeleted).toBe(false);
    expect(photos.names()).toEqual(imagesOf(restored).sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("doesn't remove a recipe restored and deleted again after it was listed", async () => {
    const redeleted = await recipeWithPhoto(DELETED);
    clock.set(DUE);
    const racing = new RacingRepository(recipes, async () => {
      const recipe = (await recipes.get(redeleted.id))!;
      expect(recipe.restore(instant(JUST_BEFORE_DUE)).ok).toBe(true);
      recipe.delete(instant(JUST_BEFORE_DUE));
      await recipes.save(recipe);
    });

    await cleanup({ recipes: racing });

    expect((await recipes.get(redeleted.id))?.isDeleted).toBe(true);
    expect(photos.names()).toEqual(imagesOf(redeleted).sort());
  });

  it("doesn't remove a recipe restored between the job's read and its remove, nor delete its images", async () => {
    const restored = await recipeWithPhoto(DELETED);
    clock.set(DUE);
    // A restore handled by the API just before the deadline, saved after the job read the recipe as due.
    const racing = new RacingRemoveRepository(recipes, async () => {
      const recipe = (await recipes.get(restored.id))!;
      expect(recipe.restore(instant(JUST_BEFORE_DUE)).ok).toBe(true);
      await recipes.save(recipe);
    });

    const summary = await cleanup({ recipes: racing });

    expect((await recipes.get(restored.id))?.isDeleted).toBe(false);
    expect(photos.names()).toEqual(imagesOf(restored).sort());
    // Losing the race is expected, not a failure.
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("goes on after one removed recipe's image can't be deleted, leaving the image to the orphan sweep", async () => {
    const failing = await recipeWithPhoto(DELETED);
    const other = await recipeWithPhoto(DELETED);
    clock.set(DUE);
    const failingName = imagesOf(failing)[1]!;

    const summary = await cleanup({ photos: new FailingDeletes(photos, [failingName]) });

    expect(await recipes.get(other.id)).toBeUndefined();
    // The document goes before its images, so it is gone; the image left behind is now an orphan, which the sweep in the
    // same run also fails to delete.
    expect(await recipes.get(failing.id)).toBeUndefined();
    expect(photos.names()).toEqual([failingName]);
    expect(summary).toEqual({ recipesRemoved: 2, imagesDeleted: 3, orphansDeleted: 0, failures: 2 });
    expect(logger.errors).toHaveLength(2);

    // The next run's sweep deletes it.
    const retry = await cleanup();
    expect(photos.names()).toEqual([]);
    expect(retry).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 1, failures: 0 });
  });

  it("goes on after one recipe's document can't be removed", async () => {
    const failing = await recipeWithPhoto(DELETED);
    const other = await recipeWithPhoto(DELETED);
    clock.set(DUE);

    const summary = await cleanup({ recipes: new FailingRemoves(recipes, [failing.id.value]) });

    expect(await recipes.get(other.id)).toBeUndefined();
    expect(await recipes.get(failing.id)).toBeDefined();
    expect(summary.recipesRemoved).toBe(1);
    expect(summary.failures).toBe(1);

    // The next run finishes the job.
    const retry = await cleanup();
    expect(await recipes.get(failing.id)).toBeUndefined();
    expect(retry).toEqual({ recipesRemoved: 1, imagesDeleted: 2, orphansDeleted: 0, failures: 0 });
  });

  it("is harmless to run twice", async () => {
    const due = await recipeWithPhoto(DELETED);
    const kept = await recipeWithPhoto("2026-09-15T09:00:00.000Z");
    clock.set(DUE);

    await cleanup();
    const second = await cleanup();

    expect(await recipes.get(due.id)).toBeUndefined();
    expect(await recipes.get(kept.id)).toBeDefined();
    expect(photos.names()).toEqual(imagesOf(kept).sort());
    expect(second).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("counts a failure to list recipes and changes nothing", async () => {
    const due = await recipeWithPhoto(DELETED);
    clock.set(DUE);

    const summary = await cleanup({ recipes: new FailingList(recipes, 1) });

    expect(await recipes.get(due.id)).toBeDefined();
    expect(photos.names()).toHaveLength(2);
    expect(summary.failures).toBe(1);
  });
});

describe("Orphaned photo files (architecture.md, Trash cleanup)", () => {
  const STORED = "2026-10-01T09:00:00.000Z";

  async function orphan(): Promise<string> {
    const name = newPhotoName(recipeId(randomUUID()));
    await photos.put(name, Buffer.from("orphan"), "image/jpeg");
    return name;
  }

  it("deletes an unreferenced image older than 24 hours", async () => {
    clock.set(STORED);
    await orphan();
    clock.set("2026-10-02T09:00:00.001Z");

    const summary = await cleanup();

    expect(photos.names()).toEqual([]);
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 1, failures: 0 });
  });

  it("keeps an unreferenced image up to 24 hours old, since an upload stores images before saving the recipe", async () => {
    clock.set(STORED);
    const young = await orphan();
    clock.set("2026-10-02T09:00:00.000Z");

    const summary = await cleanup();

    expect(photos.names()).toEqual([young]);
    expect(summary.orphansDeleted).toBe(0);
  });

  it("keeps old images, thumbnails included, that a recipe refers to, in or out of the trash", async () => {
    const live = await recipeWithPhoto();
    const trashed = await recipeWithPhoto("2026-09-15T09:00:00.000Z");
    clock.set(DUE);

    const summary = await cleanup();

    expect(photos.names()).toEqual([...imagesOf(live), ...imagesOf(trashed)].sort());
    expect(summary.orphansDeleted).toBe(0);
  });

  it("deletes old orphans next to referenced images and removed recipes", async () => {
    const live = await recipeWithPhoto();
    const old = await orphan();
    await recipeWithPhoto(DELETED);
    clock.set(DUE);

    const summary = await cleanup();

    expect(photos.names()).toEqual(imagesOf(live).sort());
    expect(photos.names()).not.toContain(old);
    expect(summary).toEqual({ recipesRemoved: 1, imagesDeleted: 2, orphansDeleted: 1, failures: 0 });
  });

  it("goes on after one orphan can't be deleted, counting the failure", async () => {
    const failing = await orphan();
    await orphan();
    clock.set(DUE);

    const summary = await cleanup({ photos: new FailingDeletes(photos, [failing]) });

    expect(photos.names()).toEqual([failing]);
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 1, failures: 1 });
  });

  it("is harmless to run twice", async () => {
    const live = await recipeWithPhoto();
    await orphan();
    clock.set(DUE);

    await cleanup();
    const second = await cleanup();

    expect(photos.names()).toEqual(imagesOf(live).sort());
    expect(second).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 });
  });

  it("considers only names of the form photos/{recipeId}/...: other old, unreferenced files are kept", async () => {
    const others = [
      "exports/backup.json",
      "backup.jpg",
      "photos/not-a-recipe-id/a.jpg",
      `photos/${randomUUID()}/nested/a.jpg`,
    ];
    for (const name of others) await photos.put(name, Buffer.from("other"), "application/octet-stream");
    const old = await orphan();
    clock.set(DUE);

    const summary = await cleanup();

    expect(photos.names()).toEqual([...others].sort());
    expect(photos.names()).not.toContain(old);
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 1, failures: 0 });
  });

  it(`deletes up to ${MAX_ORPHANS_PER_RUN} old orphans`, async () => {
    expect(MAX_ORPHANS_PER_RUN).toBe(10);
    const live = await recipeWithPhoto();
    for (let i = 0; i < 10; i++) await orphan();
    clock.set(DUE);

    const summary = await cleanup();

    expect(photos.names()).toEqual(imagesOf(live).sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 10, failures: 0 });
  });

  it(`deletes none of more than ${MAX_ORPHANS_PER_RUN} old orphans, and counts a failure`, async () => {
    const live = await recipeWithPhoto();
    const orphans: string[] = [];
    for (let i = 0; i < 11; i++) orphans.push(await orphan());
    clock.set(DUE);

    const summary = await cleanup();

    expect(photos.names()).toEqual([...imagesOf(live), ...orphans].sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 1 });
    expect(logger.errors).toHaveLength(1);
  });

  it("still removes due recipes and their images when the orphan limit is exceeded", async () => {
    const due = await recipeWithPhoto(DELETED);
    for (let i = 0; i < 11; i++) await orphan();
    clock.set(DUE);

    const summary = await cleanup();

    expect(await recipes.get(due.id)).toBeUndefined();
    expect(photos.names()).toHaveLength(11);
    expect(summary).toEqual({ recipesRemoved: 1, imagesDeleted: 2, orphansDeleted: 0, failures: 1 });
  });

  // Were the sweep to go on with no recipes listed, every old image would look unused, the live recipe's included.
  it("deletes no image and counts one failure when the sweep's recipe listing fails", async () => {
    const live = await recipeWithPhoto();
    const old = await orphan();
    clock.set(DUE);

    const summary = await cleanup({ recipes: new FailingList(recipes, 2) });

    expect(photos.names()).toEqual([...imagesOf(live), old].sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 1 });
    expect(logger.errors).toHaveLength(1);
  });

  it("deletes no image and counts one failure when the image listing fails", async () => {
    const live = await recipeWithPhoto();
    const old = await orphan();
    clock.set(DUE);

    const summary = await cleanup({ photos: new FailingPhotoList(photos) });

    expect(photos.names()).toEqual([...imagesOf(live), old].sort());
    expect(summary).toEqual({ recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 1 });
    expect(logger.errors).toHaveLength(1);
  });
});

/** Passes every call to the repository the tests seed, so a subclass can interfere with one kind of call. */
class WrappedRepository implements RecipeRepository {
  constructor(protected readonly inner: RecipeRepository) {}

  get(id: RecipeId) {
    return this.inner.get(id);
  }
  list() {
    return this.inner.list();
  }
  save(recipe: Recipe) {
    return this.inner.save(recipe);
  }
  add(recipe: Recipe) {
    return this.inner.add(recipe);
  }
  remove(id: RecipeId) {
    return this.inner.remove(id);
  }
  getWithVersion(id: RecipeId) {
    return this.inner.getWithVersion(id);
  }
  removeIfUnchanged(id: RecipeId, version: RecipeVersion) {
    return this.inner.removeIfUnchanged(id, version);
  }
}

/** Runs `between` once, right after the first listing, as a concurrent API request would. */
class RacingRepository extends WrappedRepository {
  private raced = false;

  constructor(
    inner: RecipeRepository,
    private readonly between: () => Promise<void>,
  ) {
    super(inner);
  }

  override async list() {
    const listed = await this.inner.list();
    if (!this.raced) {
      this.raced = true;
      await this.between();
    }
    return listed;
  }
}

/** Runs `between` once, after the job has read a recipe for removal and before it removes it. */
class RacingRemoveRepository extends WrappedRepository {
  private raced = false;

  constructor(
    inner: RecipeRepository,
    private readonly between: () => Promise<void>,
  ) {
    super(inner);
  }

  override async removeIfUnchanged(id: RecipeId, version: RecipeVersion) {
    if (!this.raced) {
      this.raced = true;
      await this.between();
    }
    return this.inner.removeIfUnchanged(id, version);
  }
}

class FailingRemoves extends WrappedRepository {
  constructor(
    inner: RecipeRepository,
    private readonly failing: readonly string[],
  ) {
    super(inner);
  }

  override async removeIfUnchanged(id: RecipeId, version: RecipeVersion) {
    if (this.failing.includes(id.value)) throw new Error(`cannot remove ${id.value}`);
    return this.inner.removeIfUnchanged(id, version);
  }
}

/** Fails the `failingCall`-th listing (1 for the first); the job lists once for removals and once for the orphan sweep. */
class FailingList extends WrappedRepository {
  private calls = 0;

  constructor(
    inner: RecipeRepository,
    private readonly failingCall: number,
  ) {
    super(inner);
  }

  override async list() {
    if (++this.calls === this.failingCall) throw new Error("database unavailable");
    return this.inner.list();
  }
}

class FailingDeletes extends InMemoryPhotoStore {
  constructor(
    private readonly inner: InMemoryPhotoStore,
    private readonly failing: readonly string[],
  ) {
    super();
  }

  override put(name: string, bytes: Buffer, contentType: string) {
    return this.inner.put(name, bytes, contentType);
  }
  override get(name: string) {
    return this.inner.get(name);
  }
  override list() {
    return this.inner.list();
  }
  override async delete(name: string) {
    if (this.failing.includes(name)) throw new Error(`cannot delete ${name}`);
    return this.inner.delete(name);
  }
}

class FailingPhotoList extends FailingDeletes {
  constructor(inner: InMemoryPhotoStore) {
    super(inner, []);
  }

  override async list(): Promise<never> {
    throw new Error("storage unavailable");
  }
}
