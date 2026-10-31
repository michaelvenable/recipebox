import { Recipe, type RecipeId, type RecipeSnapshot } from "@recipebox/domain";
import type { RecipeRepository } from "./recipe-repository.js";

/**
 * A `RecipeRepository` for fast tests. It keeps serialized snapshots rather than `Recipe` objects, so, as with the real
 * database, changing a loaded recipe without saving it leaves the stored one unchanged.
 */
export class InMemoryRecipeRepository implements RecipeRepository {
  private readonly documents = new Map<string, string>();

  async get(id: RecipeId): Promise<Recipe | undefined> {
    const document = this.documents.get(id.value);
    return document === undefined ? undefined : load(document);
  }

  async list(): Promise<Recipe[]> {
    // Reverse order of each recipe's first save. list() order is unspecified; not returning insertion order keeps tests from
    // depending on it by accident.
    return [...this.documents.values()].reverse().map(load);
  }

  async save(recipe: Recipe): Promise<void> {
    const snapshot = recipe.toSnapshot();
    this.documents.set(snapshot.id, JSON.stringify(snapshot));
  }

  async remove(id: RecipeId): Promise<void> {
    this.documents.delete(id.value);
  }
}

function load(document: string): Recipe {
  return Recipe.fromSnapshot(JSON.parse(document) as RecipeSnapshot);
}
