// The model's answer is untrusted input, like a request body (docs/architecture.md, "Recipe import"): it is parsed against the
// shape of the schema (reading-prompt.ts) and then never stored. Whether its content makes a valid recipe is the domain's
// (importedRecipe, IMP-7, IMP-8).
import { z } from "zod";
import type { ReadRecipe } from "@recipebox/domain";

/**
 * IMP-9: the dish picture: which photo it is on (`photo`, from 1 in the order given) and the box around it, as fractions of
 * that image's width and height, from its top-left corner. The photo number is untrusted too (dish-photo.ts).
 */
export interface DishPhotoBox {
  photo: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ReadingAnswer =
  | { found: false }
  | { found: true; recipe: ReadRecipe; dishPhoto: DishPhotoBox | undefined };

const answerShape = z.strictObject({
  found: z.boolean(),
  name: z.string(),
  ingredients: z.array(z.string()),
  prep: z.array(z.string()),
  steps: z.array(z.string()),
  totalTimeMinutes: z.number().int().nullable(),
  servings: z.number().int().nullable(),
  // Left out of the schema when no tag is in use (readingSchema). Which tags are kept is the domain's rule (IMP-8), so any
  // text is accepted here.
  tags: z.array(z.string()).optional(),
  dishPhoto: z
    // `photo` may be any number: one that names no photo, such as 1.5, means no photo (IMP-9, dish-photo.ts), not a broken
    // answer.
    .strictObject({ photo: z.number(), left: z.number(), top: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});

/**
 * Parses the model's raw answer. `detail` says why it doesn't fit, for the `service-error` log line (IMP-11), and never quotes
 * the answer: it may hold recipe text, which the log must not (IMP-11). So it names only JSON paths and Zod's issue codes.
 */
export function parseReadingAnswer(raw: string): { ok: true; value: ReadingAnswer } | { ok: false; detail: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // JSON.parse's message quotes part of the text.
    return { ok: false, detail: "The reading service's answer is not valid JSON." };
  }
  const parsed = answerShape.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(answer)"}: ${issue.code}`);
    return { ok: false, detail: `The reading service's answer doesn't have the expected shape (${issues.join("; ")}).` };
  }
  const answer = parsed.data;
  // IMP-11: "found: false" is a photo with no recipe, whatever else the answer holds.
  if (!answer.found) return { ok: true, value: { found: false } };
  const recipe: ReadRecipe = {
    name: answer.name,
    ingredients: answer.ingredients,
    prep: answer.prep,
    steps: answer.steps,
    tags: answer.tags ?? [],
  };
  if (answer.totalTimeMinutes !== null) recipe.totalTimeMinutes = answer.totalTimeMinutes;
  if (answer.servings !== null) recipe.servings = answer.servings; // IMP-6, REC-24: null when the page states none
  return { ok: true, value: { found: true, recipe, dishPhoto: answer.dishPhoto ?? undefined } };
}
