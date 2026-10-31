import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Instant, PhotoRef, Recipe, RecipeId, type RecipeContentInput, type Result } from "@recipebox/domain";
import type { RecipeRepository } from "../../src/recipes/recipe-repository.js";

/**
 * Behavior every `RecipeRepository` must have, run against each implementation. `createRepository` is called before each
 * test and must return a repository that holds no recipes.
 */
export function recipeRepositoryContract(name: string, createRepository: () => Promise<RecipeRepository>): void {
  describe(`${name} (RecipeRepository contract)`, () => {
    let repository: RecipeRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    it("returns a saved recipe with the same snapshot", async () => {
      const recipe = fullRecipe();
      await repository.save(recipe);

      const loaded = await repository.get(recipe.id);

      expect(loaded?.toSnapshot()).toEqual(recipe.toSnapshot());
    });

    it("returns undefined for an unknown id", async () => {
      await repository.save(newRecipe("Pancakes"));

      expect(await repository.get(newId())).toBeUndefined();
    });

    it("replaces the stored recipe when saved again", async () => {
      const recipe = newRecipe("Pancakes");
      await repository.save(recipe);
      valueOf(recipe.revise(content("Buttermilk pancakes")));
      valueOf(recipe.markCooked(at("2026-10-02T18:00:00Z")));

      await repository.save(recipe);

      const loaded = await repository.get(recipe.id);
      expect(loaded?.toSnapshot()).toEqual(recipe.toSnapshot());
      expect(loaded?.content.name.value).toBe("Buttermilk pancakes");
      expect(await repository.list()).toHaveLength(1);
    });

    // A repository that merged the new snapshot into the stored one, instead of replacing it, would keep these stale fields.
    describe("drops optional fields that are gone when saved again", () => {
      it("no toMake after the recipe is taken off the to-make list (PLAN-4)", async () => {
        const recipe = newRecipe("Pancakes");
        valueOf(recipe.addToMakeList(at("2026-10-05T07:00:00Z")));
        await repository.save(recipe);
        valueOf(recipe.removeFromMakeList());

        await repository.save(recipe);

        const loaded = (await repository.get(recipe.id))?.toSnapshot();
        expect(loaded).not.toHaveProperty("toMake");
        expect(loaded).toStrictEqual(recipe.toSnapshot());
      });

      it("no deletedAt after the recipe is restored from the trash (REC-15)", async () => {
        const recipe = newRecipe("Pancakes");
        recipe.delete(at("2026-10-03T08:00:00Z"));
        await repository.save(recipe);
        valueOf(recipe.restore(at("2026-10-04T08:00:00Z")));

        await repository.save(recipe);

        const loaded = (await repository.get(recipe.id))?.toSnapshot();
        expect(loaded).not.toHaveProperty("deletedAt");
        expect(loaded).toStrictEqual(recipe.toSnapshot());
      });

      it("no photo after the photo is removed (REC-7)", async () => {
        const recipe = newRecipe("Pancakes");
        valueOf(recipe.setPhoto(valueOf(PhotoRef.create({ blobName: "recipes/photo.jpg", contentType: "image/jpeg" }))));
        await repository.save(recipe);
        valueOf(recipe.removePhoto());

        await repository.save(recipe);

        const loaded = (await repository.get(recipe.id))?.toSnapshot();
        expect(loaded).not.toHaveProperty("photo");
        expect(loaded).toStrictEqual(recipe.toSnapshot());
      });
    });

    it("lists every recipe, including those in the trash (REC-6)", async () => {
      const kept = newRecipe("Pancakes");
      const trashed = newRecipe("Waffles");
      trashed.delete(at("2026-10-03T08:00:00Z"));
      await repository.save(kept);
      await repository.save(trashed);

      const listed = await repository.list();

      expect(byId(listed)).toEqual(byId([kept, trashed]));
      expect(listed.find((r) => r.id.equals(trashed.id))?.isDeleted).toBe(true);
    });

    it("lists nothing when empty", async () => {
      expect(await repository.list()).toEqual([]);
    });

    it("removes a recipe permanently (REC-16)", async () => {
      const removed = newRecipe("Pancakes");
      const kept = newRecipe("Waffles");
      await repository.save(removed);
      await repository.save(kept);

      await repository.remove(removed.id);

      expect(await repository.get(removed.id)).toBeUndefined();
      expect(byId(await repository.list())).toEqual(byId([kept]));
    });

    it("does nothing when removing an unknown id", async () => {
      const kept = newRecipe("Pancakes");
      await repository.save(kept);

      await expect(repository.remove(newId())).resolves.toBeUndefined();

      expect(byId(await repository.list())).toEqual(byId([kept]));
    });

    it("keeps the stored recipe unchanged when a loaded recipe is changed but not saved", async () => {
      const recipe = newRecipe("Pancakes");
      await repository.save(recipe);
      const stored = recipe.toSnapshot();

      const loaded = await repository.get(recipe.id);
      if (loaded === undefined) throw new Error("expected the saved recipe");
      valueOf(loaded.revise(content("Changed")));
      valueOf(loaded.addToMakeList(at("2026-10-04T12:00:00Z")));
      recipe.delete(at("2026-10-04T12:00:00Z"));

      expect((await repository.get(recipe.id))?.toSnapshot()).toEqual(stored);
      expect((await repository.list()).map((r) => r.toSnapshot())).toEqual([stored]);
    });
  });
}

function newId(): RecipeId {
  return valueOf(RecipeId.create(randomUUID()));
}

function content(name: string): RecipeContentInput {
  return { name, ingredients: ["2 eggs", "1 cup flour"], steps: ["Mix.", "Cook."], tags: ["breakfast"] };
}

function newRecipe(name: string): Recipe {
  return valueOf(Recipe.create(newId(), content(name)));
}

/** A recipe using every optional part of the snapshot, so a round trip checks them all. */
function fullRecipe(): Recipe {
  const recipe = valueOf(
    Recipe.create(newId(), {
      name: "Smørrebrød 🍞",
      ingredients: ["Rye bread", "Butter"],
      steps: ["Butter the bread.", "Add toppings."],
      totalTimeMinutes: 15,
      tags: ["lunch", "danish"],
    }),
  );
  valueOf(recipe.setPhoto(valueOf(PhotoRef.create({ blobName: "recipes/photo.jpg", contentType: "image/jpeg" }))));
  valueOf(recipe.markCooked(at("2026-09-01T12:00:00Z")));
  valueOf(recipe.markCooked(at("2026-09-01T12:00:00Z")));
  valueOf(recipe.markCooked(at("2026-10-01T12:30:00.123Z")));
  valueOf(recipe.addToMakeList(at("2026-10-05T07:00:00Z")));
  return recipe;
}

function at(iso: string): Instant {
  return valueOf(Instant.fromIso(iso));
}

function byId(recipes: readonly Recipe[]): unknown[] {
  return recipes.map((r) => r.toSnapshot()).sort((a, b) => a.id.localeCompare(b.id));
}

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}
