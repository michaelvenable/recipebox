import { createHash } from "node:crypto";
import { type ImportId, RecipeId } from "@recipebox/domain";

// A fixed, randomly chosen namespace for imported recipes' ids. Changing it would give an import being processed again a new
// recipe id, so it never changes.
const NAMESPACE = "6f1b3c2e-8d4a-4f7e-9b25-0c9e1d7a4b53";

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/**
 * The id of the recipe an import makes (docs/domain-model.md, "Recipe import"): always the same for the same import, so a queue
 * message delivered twice can't add the recipe twice (docs/architecture.md, "Recipe import"). A name-based UUID (version 5,
 * RFC 9562) of the import id rather than the import id itself, so a public recipe id says nothing about an import (X-1).
 */
export function importedRecipeId(importId: ImportId): RecipeId {
  const hash = createHash("sha1").update(uuidBytes(NAMESPACE)).update(importId.value, "utf8").digest().subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  const id = RecipeId.create(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
  if (!id.ok) throw new Error("A name-based UUID was refused as a recipe id");
  return id.value;
}
