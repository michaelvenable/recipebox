// The create and edit form's values, and turning them into a RecipeContentInput and the server's errors back into fields.
//
// The domain's rules (REC-1, REC-2, REC-11, X-13) are checked by the server. The form sends what was typed: each line of an
// entry box as one entry, untrimmed and blank lines included, so an error's position, such as "ingredients[2]", is line 3 of the
// box (REC-21). The only checks here are the obvious ones that the server would refuse anyway, so the editor hears about them
// without a round trip.
import type { ErrorItem, PublicRecipe, RecipeContentInput } from "@recipebox/shared";

/** The lists typed one entry per line (REC-21). */
export type EntryField = "ingredients" | "prep" | "steps";

export interface FormValues {
  name: string;
  /** Ingredients, prep and steps as typed, one entry per line (REC-21). */
  ingredients: string;
  prep: string;
  steps: string;
  /** Total time as typed: hours:minutes such as "1:30" or ":45", or minutes such as "45"; blank means no total time. */
  totalTime: string;
  /** Tags as typed, separated by commas, such as "dinner, quick" (REC-10). */
  tags: string;
}

/** The form for an existing recipe, its entries one per line and its tags separated by commas, or an empty form. */
export function formFrom(recipe: PublicRecipe | undefined): FormValues {
  if (recipe === undefined) return { name: "", ingredients: "", prep: "", steps: "", totalTime: "", tags: "" };
  return {
    name: recipe.name,
    ingredients: oneEntryPerLine(recipe.ingredients),
    // A recipe from before prep, or from a server that leaves out an empty list, has none (REC-20).
    prep: oneEntryPerLine(recipe.prep ?? []),
    steps: oneEntryPerLine(recipe.steps),
    totalTime: formatTotalTime(recipe.totalTimeMinutes),
    tags: recipe.tags.join(", "),
  };
}

/**
 * Entries one per line (REC-21). An entry saved before REC-21 may have line breaks of its own; each run of them is shown as a
 * space, so the entry stays one entry when the form is saved.
 */
function oneEntryPerLine(entries: readonly string[]): string {
  return entries.map((entry) => entry.replace(/(?:\r\n|\r|\n)+/g, " ")).join("\n");
}

/**
 * The entries typed in one box: each line is one entry (REC-21), and an empty box has none. Blank lines are kept, so entry i is
 * line i + 1 for the server's errors; the server trims entries and discards blank ones, so they never become entries (REC-2).
 */
export function entryLines(typed: string): string[] {
  return typed === "" ? [] : typed.split(/\r\n|\r|\n/);
}

/**
 * The tags typed in the tag field: a comma separates two tags, and empty items, as in "dinner,, quick", are ignored (REC-11).
 * Trimmed so a refused tag's message shows it as typed; lowercasing, merging and every other tag rule are the server's.
 */
export function tagItems(typed: string): string[] {
  return typed
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/** The tag field split at its last comma: the tags before it, and the text after it, which is the tag being typed (REC-12). */
export function tagBeingTyped(typed: string): { before: string; current: string } {
  const comma = typed.lastIndexOf(",");
  return { before: typed.slice(0, comma + 1), current: typed.slice(comma + 1) };
}

/** The tag field after choosing a suggestion: it replaces the tag being typed, and a comma follows for the next one (REC-12). */
export function withSuggestion(typed: string, tag: string): string {
  const { before } = tagBeingTyped(typed);
  return `${before}${before === "" ? "" : " "}${tag}, `;
}

/** A total time as the form shows it, hours:minutes: 90 as "1:30", 45 as "0:45", 120 as "2:00", and none as "". */
export function formatTotalTime(total: number | undefined): string {
  if (total === undefined) return "";
  const minutes = total % 60;
  return `${Math.floor(total / 60)}:${minutes < 10 ? "0" : ""}${minutes}`;
}

// Hours, a colon and two digits of minutes ("1:30", "0:45", or ":45" with no hours), or a number of minutes ("45"). Only ASCII
// digits: no sign, no decimal point. "1:5" is refused rather than guessed at, since it could mean 1:05 or 1:50.
const HOURS_MINUTES = /^([0-9]*):([0-5][0-9])$/;
const MINUTES = /^[0-9]+$/;

/**
 * The total time to send, in minutes: undefined when blank, or null when it isn't hours:minutes or a number of minutes. Whether
 * it is from 1 to 1440 is the server's to check (REC-1), so "0" and "25:00" are sent and refused there.
 */
export function totalMinutes(typed: string): number | undefined | null {
  const text = typed.trim();
  if (text === "") return undefined;
  let total: number;
  const hoursMinutes = HOURS_MINUTES.exec(text);
  if (hoursMinutes !== null) total = Number(hoursMinutes[1]) * 60 + Number(hoursMinutes[2]);
  else if (MINUTES.test(text)) total = Number(text);
  else return null;
  // So many digits that the number isn't exact any more: no use sending it.
  return Number.isSafeInteger(total) ? total : null;
}

/** The body of POST /recipes and PUT /recipes/{id}/content: the whole content, tags included (REC-5), never a time (X-12). */
export function contentInput(form: FormValues): RecipeContentInput {
  const input: RecipeContentInput = {
    name: form.name,
    ingredients: entryLines(form.ingredients),
    prep: entryLines(form.prep),
    steps: entryLines(form.steps),
    tags: tagItems(form.tags),
  };
  const minutes = totalMinutes(form.totalTime);
  if (typeof minutes === "number") input.totalTimeMinutes = minutes;
  return input;
}

/** The content as typed, to tell whether it has changed since it was loaded or saved. */
export function contentSnapshot(form: FormValues): string {
  return JSON.stringify([form.name, form.ingredients, form.prep, form.steps, form.totalTime, form.tags]);
}

/**
 * The obvious problems the server would refuse anyway (REC-1, REC-2): no name, no ingredient or step that isn't blank, and a
 * total time that can't be read as minutes. Paths and wording match the server's, so both are shown the same way.
 */
export function obviousErrors(form: FormValues): ErrorItem[] {
  const errors: ErrorItem[] = [];
  if (form.name.trim() === "") errors.push({ code: "name.required", field: "name", message: "Enter a name (up to 200 characters)." });
  if (form.ingredients.trim() === "") {
    errors.push({ code: "ingredients.required", field: "ingredients", message: "Add at least one ingredient. Blank lines are ignored." });
  }
  if (form.steps.trim() === "") {
    errors.push({ code: "steps.required", field: "steps", message: "Add at least one step. Blank lines are ignored." });
  }
  if (totalMinutes(form.totalTime) === null) {
    errors.push({
      code: "totalTime.format",
      field: "totalTimeMinutes",
      message: "Enter the time as hours:minutes, like 1:30 or :45, or as minutes, like 45.",
    });
  }
  return errors;
}

/** Where an error is shown: a field of the form, or only in the summary at the top. */
export interface FormErrors {
  /**
   * Messages by field: "name", "photo", "totalTimeMinutes", "ingredients", "prep", "steps" and "tags". An error about one entry
   * names its line ("Line 3: …", REC-21), and one about one tag names the tag.
   */
  fields: ReadonlyMap<string, readonly string[]>;
  /** Messages that belong to no field shown in the form, such as "This recipe is in the trash." (REC-17). */
  general: readonly string[];
}

export const NO_ERRORS: FormErrors = { fields: new Map(), general: [] };

const SIMPLE_FIELDS = new Set(["name", "photo", "totalTimeMinutes", "ingredients", "prep", "steps", "tags"]);

/**
 * The form field of a server error path such as "ingredients[2]" or "tags[0]", given the form as it was sent, and what to put
 * before the message to say which line or tag it is about.
 */
function formField(path: string | undefined, sent: FormValues): { field: string; about: string } | undefined {
  if (path === undefined) return undefined;
  if (SIMPLE_FIELDS.has(path)) return { field: path, about: "" };
  const match = /^(ingredients|prep|steps|tags)\[(\d+)\]$/.exec(path);
  if (match === null) return undefined;
  const [, list = "", position] = match;
  const index = Number(position);
  if (list === "tags") {
    const tag = tagItems(sent.tags)[index];
    return { field: "tags", about: tag === undefined ? "" : `“${tag}”: ` };
  }
  // The lines are sent as typed, blank ones included, so entry i is line i + 1 (entryLines).
  const lines = entryLines(sent[list as EntryField]);
  return { field: list, about: index < lines.length ? `Line ${index + 1}: ` : "" };
}

/** Sorts the server's (or the obvious) errors into the fields of the form that was sent. */
export function formErrors(errors: readonly ErrorItem[], sent: FormValues): FormErrors {
  const fields = new Map<string, string[]>();
  const general: string[] = [];
  for (const error of errors) {
    const place = formField(error.field, sent);
    if (place === undefined) {
      general.push(error.message);
      continue;
    }
    const message = `${place.about}${error.message}`;
    const messages = fields.get(place.field) ?? [];
    if (!messages.includes(message)) messages.push(message);
    fields.set(place.field, messages);
  }
  return { fields, general };
}

/** The types the photo field offers. iOS converts a HEIC photo from its library to JPEG for an input asking for these (REC-7). */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_ACCEPT = PHOTO_TYPES.join(",");
/** The server's limit (docs/api.md, PUT /recipes/{id}/photo). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** By the browser's type when it knows it; by the name only when it doesn't, since a JPEG may well be named .heic. */
function isHeic(file: File): boolean {
  return file.type !== "" ? /^image\/hei[cf]/.test(file.type) : /\.hei[cf]$/i.test(file.name);
}

/**
 * Why a picked file can't be uploaded, before sending 15 MB for nothing (REC-7), or undefined. The server checks the bytes
 * anyway; a file whose type the browser doesn't know (an empty `type`) is left to it, since it may well be a JPEG.
 */
export function photoProblem(file: File): string | undefined {
  if (isHeic(file)) return "HEIC photos can't be used. Choose a JPEG instead.";
  if (file.type !== "" && !(PHOTO_TYPES as readonly string[]).includes(file.type)) return "Choose a JPEG, PNG or WebP photo.";
  if (file.size > MAX_PHOTO_BYTES) return "The photo is larger than 15 MB. Choose a smaller one.";
  return undefined;
}
