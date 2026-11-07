import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Instant, Recipe, RecipeId, type Result, SharedShoppingList, shoppingList } from "@recipebox/domain";
import { randomShareToken } from "../../src/clock.js";
import type { SharedListRepository } from "../../src/shopping-lists/shared-list-repository.js";

/**
 * Behavior every `SharedListRepository` must have (PLAN-9), run against each implementation. `createRepository` is called
 * before each test.
 */
export function sharedListRepositoryContract(name: string, createRepository: () => Promise<SharedListRepository>): void {
  describe(`${name} (SharedListRepository contract)`, () => {
    let repository: SharedListRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    it("returns a stored list with the same snapshot", async () => {
      const list = sentList();
      await repository.add(list);
      expect((await repository.get(list.token))?.toSnapshot()).toEqual(list.toSnapshot());
    });

    it("returns undefined for an unknown token", async () => {
      await repository.add(sentList());
      expect(await repository.get(randomShareToken())).toBeUndefined();
    });

    it("never replaces a stored list: the same token again throws and the first list stays", async () => {
      const list = sentList();
      await repository.add(list);
      const other = valueOf(SharedShoppingList.create(list.token, items("Other"), at("2026-11-08T09:00:00Z")));
      await expect(repository.add(other)).rejects.toThrow();
      expect((await repository.get(list.token))?.toSnapshot()).toEqual(list.toSnapshot());
    });

    it("keeps lists apart by token", async () => {
      const a = sentList("A");
      const b = sentList("B");
      await repository.add(a);
      await repository.add(b);
      expect((await repository.get(a.token))?.items[0]?.recipeName.value).toBe("A");
      expect((await repository.get(b.token))?.items[0]?.recipeName.value).toBe("B");
    });
  });
}

/** A list sent on 2026-11-07 at 09:00 with one planned recipe's two ingredients. */
export function sentList(recipeName = "Shakshuka"): SharedShoppingList {
  return valueOf(SharedShoppingList.create(randomShareToken(), items(recipeName), at("2026-11-07T09:00:00Z")));
}

function items(recipeName: string) {
  const id = valueOf(RecipeId.create(randomUUID()));
  const recipe = valueOf(Recipe.create(id, { name: recipeName, ingredients: ["6 eggs", "1 can tomatoes"], steps: ["Cook."] }));
  valueOf(recipe.addToMakeList(at("2026-11-01T09:00:00Z")));
  return shoppingList([recipe]);
}

function at(iso: string): Instant {
  return valueOf(Instant.fromIso(iso));
}

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}
