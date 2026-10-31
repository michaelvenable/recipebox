import { Recipe, type RecipeId, type RecipeSnapshot } from "@recipebox/domain";
import type { RecipeRepository, RecipeVersion, VersionedRecipe } from "./recipe-repository.js";

/**
 * A `RecipeRepository` for fast tests. It keeps serialized snapshots rather than `Recipe` objects, so, as with the real
 * database, changing a loaded recipe without saving it leaves the stored one unchanged. Each save takes the next value of one
 * counter as the document's version, so a version is never reused, even after a remove, as with Cosmos DB's `_etag`.
 */
export class InMemoryRecipeRepository implements RecipeRepository {
  private readonly documents = new Map<string, { json: string; version: RecipeVersion }>();
  private saves = 0;

  async get(id: RecipeId): Promise<Recipe | undefined> {
    const document = this.documents.get(id.value);
    return document === undefined ? undefined : load(document.json);
  }

  async list(): Promise<Recipe[]> {
    // Reverse order of each recipe's first save. list() order is unspecified; not returning insertion order keeps tests from
    // depending on it by accident.
    return [...this.documents.values()].reverse().map((document) => load(document.json));
  }

  async save(recipe: Recipe): Promise<void> {
    const snapshot = recipe.toSnapshot();
    this.documents.set(snapshot.id, { json: JSON.stringify(snapshot), version: String(++this.saves) as RecipeVersion });
  }

  async remove(id: RecipeId): Promise<void> {
    this.documents.delete(id.value);
  }

  async getWithVersion(id: RecipeId): Promise<VersionedRecipe | undefined> {
    const document = this.documents.get(id.value);
    return document === undefined ? undefined : { recipe: load(document.json), version: document.version };
  }

  async removeIfUnchanged(id: RecipeId, version: RecipeVersion): Promise<boolean> {
    if (this.documents.get(id.value)?.version !== version) return false;
    this.documents.delete(id.value);
    return true;
  }
}

function load(document: string): Recipe {
  return Recipe.fromSnapshot(JSON.parse(document) as RecipeSnapshot);
}
