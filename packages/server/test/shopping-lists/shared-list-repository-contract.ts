import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Instant, Recipe, RecipeId, type Result, ShoppingListLink, shoppingList } from "@recipebox/domain";
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

    it("returns a stored link with the same snapshot", async () => {
      const link = madeLink();
      await repository.add(link);
      expect((await repository.get(link.token))?.toSnapshot()).toEqual(link.toSnapshot());
    });

    it("returns undefined for an unknown token", async () => {
      await repository.add(madeLink());
      expect(await repository.get(randomShareToken())).toBeUndefined();
    });

    it("never replaces a stored link: the same token again throws and the first link stays", async () => {
      const link = madeLink("2026-11-07T09:00:00Z");
      await repository.add(link);
      const other = valueOf(ShoppingListLink.create(link.token, planItems(), at("2026-11-08T09:00:00Z")));
      await expect(repository.add(other)).rejects.toThrow();
      expect((await repository.get(link.token))?.createdAt.toIso()).toBe("2026-11-07T09:00:00.000Z");
    });

    it("keeps links apart by token", async () => {
      const a = madeLink("2026-11-07T09:00:00Z");
      const b = madeLink("2026-11-08T10:00:00Z");
      await repository.add(a);
      await repository.add(b);
      expect((await repository.get(a.token))?.createdAt.toIso()).toBe("2026-11-07T09:00:00.000Z");
      expect((await repository.get(b.token))?.createdAt.toIso()).toBe("2026-11-08T10:00:00.000Z");
    });
  });
}

/** A link made at `iso` while one recipe is on the plan. */
export function madeLink(iso = "2026-11-07T09:00:00Z"): ShoppingListLink {
  return valueOf(ShoppingListLink.create(randomShareToken(), planItems(), at(iso)));
}

function planItems() {
  const id = valueOf(RecipeId.create(randomUUID()));
  const recipe = valueOf(Recipe.create(id, { name: "Shakshuka", ingredients: ["6 eggs", "1 can tomatoes"], steps: ["Cook."] }));
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
