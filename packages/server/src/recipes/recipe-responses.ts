// Maps domain recipes to the shared response shapes (docs/api.md, "Shapes"). The only place responses are built, so the
// public/editor split (X-1) is decided here: the public builders read nothing private, and the editor builders add it.
import type {
  Recipe,
  ShoppingListLink,
  ShoppingItem as DomainShoppingItem,
} from "@recipebox/domain";
import type {
  EditorRecipe,
  EditorRecipeSummary,
  PublicRecipe,
  RecipeSummary,
  RediscoverEntry,
  SharedShoppingList,
  ShoppingItem,
  Tag,
  TagCount,
  ToMakeEntry,
  TrashEntry,
} from "@recipebox/shared";
import type { Caller } from "../http/caller.js";

export function isEditor(caller: Caller): boolean {
  return caller.signedIn && caller.isEditor;
}

/** A recipe in the list, as a visitor sees it (X-1). The added time is public (REC-22). */
export function toRecipeSummary(recipe: Recipe): RecipeSummary {
  const content = recipe.content;
  return {
    id: recipe.id.value,
    name: content.name.value,
    tags: content.tags.map((t) => t.value),
    totalTimeMinutes: content.totalTime?.value,
    hasPhoto: recipe.photo !== undefined,
    createdAt: recipe.createdAt?.toIso(),
  };
}

/** A recipe in the list, as an editor sees it (PLAN-7). */
export function toEditorRecipeSummary(recipe: Recipe): EditorRecipeSummary {
  return { ...toRecipeSummary(recipe), onToMakeList: recipe.isOnMakeList };
}

/** One recipe, as a visitor sees it (X-1). */
export function toPublicRecipe(recipe: Recipe): PublicRecipe {
  const content = recipe.content;
  return {
    id: recipe.id.value,
    name: content.name.value,
    ingredients: content.ingredients.map((e) => e.value),
    // Left out when there is none, like totalTimeMinutes, so clients from before prep (strict shapes) can still read it.
    prep: content.prep.length > 0 ? content.prep.map((e) => e.value) : undefined,
    steps: content.steps.map((e) => e.value),
    totalTimeMinutes: content.totalTime?.value,
    // Public content (REC-24); left out when not known, like totalTimeMinutes.
    servings: content.servings?.value,
    tags: content.tags.map((t) => t.value),
    hasPhoto: recipe.photo !== undefined,
  };
}

/** One recipe, as an editor sees it: adds to-make status, cooking history and notes (X-1, REC-25). */
export function toEditorRecipe(recipe: Recipe): EditorRecipe {
  const addedAt = recipe.addedToMakeListAt;
  const notes = recipe.notes;
  return {
    ...toPublicRecipe(recipe),
    toMake: addedAt === undefined ? undefined : { addedAt: addedAt.toIso() },
    cookedAt: recipe.cookedAt.map((at) => at.toIso()),
    lastCookedAt: recipe.lastCookedAt?.toIso(),
    timesCooked: recipe.timesCooked,
    // Oldest first, as the domain lists them. Left out when there are none, like prep, so clients from before notes (strict
    // shapes) can still read recipes without any.
    notes:
      notes.length === 0
        ? undefined
        : notes.map((n) => ({ id: n.id.value, text: n.text.value, addedAt: n.addedAt.toIso() })),
  };
}

/** Visitors get the public shape and editors the editor shape (X-1). */
export function toRecipeFor(caller: Caller, recipe: Recipe): PublicRecipe | EditorRecipe {
  return isEditor(caller) ? toEditorRecipe(recipe) : toPublicRecipe(recipe);
}

export function toTagCount(entry: { tag: { value: string }; count: number }): TagCount {
  return { tag: entry.tag.value, count: entry.count };
}

/** A recipe in the trash (REC-14). Only for recipes in the trash; editor-only (X-1). */
export function toTrashEntry(recipe: Recipe): TrashEntry {
  const deletedAt = recipe.deletedAt;
  const removalDueAt = recipe.removalDueAt();
  if (deletedAt === undefined || removalDueAt === undefined) {
    throw new Error(`Recipe ${recipe.id.value} is not in the trash`);
  }
  return { ...toRecipeSummary(recipe), deletedAt: deletedAt.toIso(), removalDueAt: removalDueAt.toIso() };
}

/** A tag offered while typing (REC-12). */
export function toTag(tag: { value: string }): Tag {
  return tag.value;
}

/** A recipe on the to-make list (PLAN-3). Only for recipes on the list; editor-only (X-1). */
export function toToMakeEntry(recipe: Recipe): ToMakeEntry {
  const addedAt = recipe.addedToMakeListAt;
  if (addedAt === undefined) throw new Error(`Recipe ${recipe.id.value} is not on the to-make list`);
  return { ...toRecipeSummary(recipe), addedAt: addedAt.toIso() };
}

/** A recipe in the "haven't made in a while" view (COOK-6); no lastCookedAt if never cooked. Editor-only (X-1). */
export function toRediscoverEntry(recipe: Recipe): RediscoverEntry {
  return { ...toRecipeSummary(recipe), lastCookedAt: recipe.lastCookedAt?.toIso() };
}

/**
 * One line of the shopping list (PLAN-8): the ingredient as entered, its recipe's id and name. For editors, and for anyone
 * with a shopping list link (PLAN-9); nothing in it is private (X-1).
 */
export function toShoppingItem(item: DomainShoppingItem): ShoppingItem {
  return { text: item.ingredient.value, recipeId: item.recipe.id.value, recipeName: item.recipe.content.name.value };
}

/**
 * A shopping list link's page (PLAN-9), for anyone with the link: the current shopping list (`shoppingList`, PLAN-8), each line
 * with its recipe's name, and when the link stops working. The one public view of the to-make list (X-1): no to-make dates,
 * no creation time, no code.
 */
export function toSharedShoppingList(items: readonly DomainShoppingItem[], link: ShoppingListLink): SharedShoppingList {
  return { items: items.map(toShoppingItem), expiresAt: link.expiresAt.toIso() };
}
