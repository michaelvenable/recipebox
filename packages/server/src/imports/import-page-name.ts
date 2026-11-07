import type { ImportId } from "@recipebox/domain";

/**
 * Where an import's page photo is stored in the photo container: `imports/{importId}.jpg` (docs/architecture.md, "Recipe
 * import"). Outside `photos/`, so it is never a recipe image: the photo routes serve only a recipe's own `PhotoRef`, and the
 * trash cleanup's orphan sweep never touches it (IMP-12).
 */
export function importPageName(importId: ImportId): string {
  return `imports/${importId.value}.jpg`;
}
