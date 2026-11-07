import { atField, domainError, type DomainError } from "./errors.js";
import { Minutes } from "./minutes.js";
import { RecipeName } from "./recipe-name.js";
import { fail, ok, type Result } from "./result.js";
import { Tag } from "./tag.js";
import { TextEntry } from "./text-entry.js";

export const MAX_TAGS = 20;

export interface RecipeContentInput {
  name: string;
  ingredients: readonly string[];
  /** Optional (REC-20); missing means none, so older clients and stored documents keep working. */
  prep?: readonly string[] | undefined;
  steps: readonly string[];
  totalTimeMinutes?: number | undefined;
  tags?: readonly string[] | undefined;
}

/** The user-editable part of a recipe, validated as a unit (REC-1, REC-2, REC-3, REC-11, REC-20). */
export class RecipeContent {
  private constructor(
    private readonly recipeName: RecipeName,
    private readonly ingredientList: readonly TextEntry[],
    private readonly prepList: readonly TextEntry[],
    private readonly stepList: readonly TextEntry[],
    private readonly time: Minutes | undefined,
    private readonly tagList: readonly Tag[],
  ) {
    Object.freeze(this);
  }

  /** Collects every error rather than stopping at the first, so the user sees all invalid fields (REC-1). */
  static create(input: RecipeContentInput): Result<RecipeContent> {
    const errors: DomainError[] = [];

    const name = RecipeName.create(input.name);
    if (!name.ok) errors.push(...atField(name.errors, "name"));

    const ingredients = entries(input.ingredients, "ingredients", errors);
    if (!hasEntry(input.ingredients)) {
      errors.push(domainError("ingredients.required", "At least 1 ingredient is required.", "ingredients"));
    }

    // Same entry rules as steps, but prep is optional: no "at least 1" (REC-20, REC-2).
    const prep = entries(input.prep ?? [], "prep", errors);

    const steps = entries(input.steps, "steps", errors);
    if (!hasEntry(input.steps)) {
      errors.push(domainError("steps.required", "At least 1 step is required.", "steps"));
    }

    let time: Minutes | undefined;
    if (input.totalTimeMinutes !== undefined) {
      const minutes = Minutes.create(input.totalTimeMinutes);
      if (minutes.ok) time = minutes.value;
      else errors.push(...atField(minutes.errors, "totalTimeMinutes"));
    }

    const tags = new Map<string, Tag>(); // keyed by text: duplicates collapse into one (REC-11)
    (input.tags ?? []).forEach((raw, i) => {
      const tag = Tag.create(raw);
      if (tag.ok) tags.set(tag.value.value, tag.value);
      else errors.push(...atField(tag.errors, `tags[${i}]`));
    });
    if (tags.size > MAX_TAGS) {
      errors.push(domainError("tags.tooMany", `A recipe can have at most ${MAX_TAGS} tags.`, "tags"));
    }

    if (!name.ok || errors.length > 0) {
      return fail(errors);
    }
    const sortedTags = [...tags.values()].sort(Tag.compare);
    return ok(
      new RecipeContent(
        name.value,
        Object.freeze(ingredients),
        Object.freeze(prep),
        Object.freeze(steps),
        time,
        Object.freeze(sortedTags),
      ),
    );
  }

  get name(): RecipeName {
    return this.recipeName;
  }

  /** In the order entered (REC-3). */
  get ingredients(): readonly TextEntry[] {
    return this.ingredientList;
  }

  /** In the order entered; may be empty (REC-3, REC-20). */
  get prep(): readonly TextEntry[] {
    return this.prepList;
  }

  /** In the order entered (REC-3). */
  get steps(): readonly TextEntry[] {
    return this.stepList;
  }

  get totalTime(): Minutes | undefined {
    return this.time;
  }

  /** Unique and in alphabetical order (REC-11). */
  get tags(): readonly Tag[] {
    return this.tagList;
  }
}

/**
 * Trims each entry and discards blank ones, keeping order (REC-2, REC-3). An entry that is too long is reported with its
 * position in the input, e.g. "ingredients[2]", so the UI can highlight it (REC-1).
 */
function entries(raw: readonly string[], field: string, errors: DomainError[]): TextEntry[] {
  const result: TextEntry[] = [];
  raw.forEach((text, i) => {
    if (text.trim().length === 0) return; // discarded, not an error (REC-2)
    const entry = TextEntry.create(text);
    if (entry.ok) result.push(entry.value);
    else errors.push(...atField(entry.errors, `${field}[${i}]`));
  });
  return result;
}

/** Whether any entry is left after blank ones are discarded (REC-2): the "at least 1" rule. */
function hasEntry(raw: readonly string[]): boolean {
  return raw.some((text) => text.trim().length > 0);
}
