import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Recipe, RecipeId, type Result } from "@recipebox/domain";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import { recipeRepositoryContract } from "./recipe-repository-contract.js";

recipeRepositoryContract("InMemoryRecipeRepository", async () => new InMemoryRecipeRepository());

describe("InMemoryRecipeRepository list order", () => {
  it("lists recipes in reverse insertion order, so tests can't come to rely on insertion order", async () => {
    const repository = new InMemoryRecipeRepository();
    const names = ["First", "Second", "Third"];
    for (const name of names) await repository.save(newRecipe(name));

    const listed = await repository.list();

    expect(listed.map((r) => r.content.name.value)).toEqual(["Third", "Second", "First"]);
  });
});

function newRecipe(name: string): Recipe {
  const id = valueOf(RecipeId.create(randomUUID()));
  return valueOf(Recipe.create(id, { name, ingredients: ["Eggs"], steps: ["Cook."], tags: [] }));
}

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}
