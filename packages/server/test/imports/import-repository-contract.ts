import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportId, Instant, Recipe, RecipeId, RecipeImport, type Result } from "@recipebox/domain";
import type { ImportRepository } from "../../src/imports/import-repository.js";

/**
 * Behavior every `ImportRepository` must have (IMP-3; docs/architecture.md, "Recipe import"), run against each implementation.
 * `createRepository` is called before each test and must give an empty store.
 */
export function importRepositoryContract(name: string, createRepository: () => Promise<ImportRepository>): void {
  describe(`${name} (ImportRepository contract)`, () => {
    let repository: ImportRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    function snapshotsOf(list: RecipeImport[]): unknown[] {
      return list.map((i) => i.toSnapshot()).sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    it("has no imports at first", async () => {
      expect(await repository.list()).toEqual([]);
    });

    it("returns a stored import with the same snapshot", async () => {
      const first = startedImport();
      await repository.add(first);
      expect(snapshotsOf(await repository.list())).toEqual([first.toSnapshot()]);
    });

    it("IMP-3: keeps any number of imports, each in progress on its own", async () => {
      const a = startedImport("2026-11-07T09:00:00Z");
      const b = startedImport("2026-11-07T09:00:30Z");
      const c = startedImport("2026-11-07T09:01:00Z");
      await Promise.all([repository.add(a), repository.add(b), repository.add(c)]);
      expect(snapshotsOf(await repository.list())).toEqual(snapshotsOf([a, b, c]));
    });

    it("never replaces an import when adding: the same id again throws and the first stays", async () => {
      const first = startedImport("2026-11-07T09:00:00Z");
      await repository.add(first);
      const again = RecipeImport.start(first.id, at("2026-11-07T10:00:00Z"));
      await expect(repository.add(again)).rejects.toThrow();
      expect(snapshotsOf(await repository.list())).toEqual([first.toSnapshot()]);
    });

    it("saves a change to one import and leaves the others alone", async () => {
      const a = startedImport();
      const b = startedImport();
      await repository.add(a);
      await repository.add(b);
      a.fail();
      await repository.save(a);
      expect(snapshotsOf(await repository.list())).toEqual(snapshotsOf([a, b]));
      expect((await repository.list()).find((i) => i.id.equals(b.id))?.toSnapshot().status).toBe("reading");
    });

    it("stores a done import with the recipe's id and name", async () => {
      const done = startedImport();
      await repository.add(done);
      valueOf(done.succeed(bananaBread(), at("2026-11-07T09:01:00Z")));
      await repository.save(done);
      const stored = (await repository.list())[0];
      expect(stored?.toSnapshot()).toEqual(done.toSnapshot());
      expect(stored?.recipeName?.value).toBe("Banana Bread");
    });

    it("returns independent copies: changing one stores nothing", async () => {
      await repository.add(startedImport());
      (await repository.list())[0]?.fail();
      expect((await repository.list())[0]?.toSnapshot().status).toBe("reading");
    });
  });
}

/** An import started at `iso`, with a new id. */
export function startedImport(iso = "2026-11-07T09:00:00Z"): RecipeImport {
  return RecipeImport.start(valueOf(ImportId.create(randomUUID())), at(iso));
}

function bananaBread(): Recipe {
  const id = valueOf(RecipeId.create(randomUUID()));
  return valueOf(Recipe.create(id, { name: "Banana Bread", ingredients: ["3 bananas"], steps: ["Bake."] }));
}

function at(iso: string): Instant {
  return valueOf(Instant.fromIso(iso));
}

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}
