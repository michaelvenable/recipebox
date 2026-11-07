import { RecipeImport, type RecipeImportSnapshot } from "@recipebox/domain";
import type { ImportRepository } from "./import-repository.js";

/**
 * An `ImportRepository` for fast tests. It keeps serialized snapshots, as the real database does. Nothing is ever removed:
 * the one-day time to live is the database's, checked by the Cosmos DB integration tests.
 */
export class InMemoryImportRepository implements ImportRepository {
  private readonly documents = new Map<string, string>();

  async add(recipeImport: RecipeImport): Promise<void> {
    const snapshot = recipeImport.toSnapshot();
    if (this.documents.has(snapshot.id)) throw new Error("An import with this id is already stored");
    this.documents.set(snapshot.id, JSON.stringify(snapshot));
  }

  async save(recipeImport: RecipeImport): Promise<void> {
    const snapshot = recipeImport.toSnapshot();
    this.documents.set(snapshot.id, JSON.stringify(snapshot));
  }

  async list(): Promise<RecipeImport[]> {
    return [...this.documents.values()].map((json) => RecipeImport.fromSnapshot(JSON.parse(json) as RecipeImportSnapshot));
  }

  /** Every stored document, for tests that check what was stored. */
  documentsStored(): Record<string, unknown>[] {
    return [...this.documents.values()].map((json) => JSON.parse(json) as Record<string, unknown>);
  }
}
