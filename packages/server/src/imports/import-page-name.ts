import type { ImportId } from "@recipebox/domain";

/** IMP-1, IMP-2, IMP-3: an import is 1 to 4 photos of one recipe, such as the front and back of a card. */
export const MAX_IMPORT_PHOTOS = 4;

/**
 * Where an import's page photos are stored in the photo container: `imports/{importId}/{n}.jpg`, n from 1 in the order they
 * were added (docs/architecture.md, "Recipe import"). Outside `photos/`, so they are never recipe images: the photo routes serve
 * only a recipe's own `PhotoRef`, and the trash cleanup's orphan sweep never touches them (IMP-12).
 */
export function importPageName(importId: ImportId, n: number): string {
  return `${importPagesPrefix(importId)}${n}.jpg`;
}

/** The prefix every page photo of an import is stored under, `imports/{importId}/`, for listing and deleting them all. */
export function importPagesPrefix(importId: ImportId): string {
  return `imports/${importId.value}/`;
}

/**
 * The page photos among `names`, in the order they were added: those named `imports/{importId}/{n}.jpg`, by n. Any other name
 * under the prefix isn't a page photo the API stored, and is left out.
 */
export function importPagesInOrder(importId: ImportId, names: readonly string[]): string[] {
  const prefix = importPagesPrefix(importId);
  const pages: { name: string; n: number }[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const match = /^([1-9][0-9]*)\.jpg$/.exec(name.slice(prefix.length));
    if (match !== null) pages.push({ name, n: Number(match[1]) });
  }
  return pages.sort((a, b) => a.n - b.n).map((page) => page.name);
}
