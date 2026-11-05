// The create and edit form's values, and turning them into a RecipeContentInput and the server's errors back into fields.
//
// The domain's rules (REC-1, REC-2, REC-11, X-13) are checked by the server. The form sends what was typed: entries untrimmed and
// blank ones included, so an error's position, such as "ingredients[2]", is the row the editor sees. The only checks here are the
// obvious ones that the server would refuse anyway, so the editor hears about them without a round trip.
import type { ErrorItem, PublicRecipe, RecipeContentInput } from "@recipebox/shared";

/**
 * An ingredient or step row. The key stays with the row when a row above it is removed, so its text field, focus and error stay
 * with it rather than with whatever row now has its position.
 */
export interface Entry {
  key: number;
  text: string;
}

export type EntryField = "ingredients" | "steps";

export interface FormValues {
  name: string;
  ingredients: Entry[];
  steps: Entry[];
  /** Total time as typed: hours:minutes such as "1:30", or minutes such as "45"; blank means no total time. */
  totalTime: string;
  tags: string[];
}

let lastKey = 0;

export function newEntry(text = ""): Entry {
  lastKey += 1;
  return { key: lastKey, text };
}

/** The form for an existing recipe, or an empty one with one ingredient row and one step row to type into. */
export function formFrom(recipe: PublicRecipe | undefined): FormValues {
  if (recipe === undefined) return { name: "", ingredients: [newEntry()], steps: [newEntry()], totalTime: "", tags: [] };
  return {
    name: recipe.name,
    ingredients: recipe.ingredients.map((text) => newEntry(text)),
    steps: recipe.steps.map((text) => newEntry(text)),
    totalTime: formatTotalTime(recipe.totalTimeMinutes),
    tags: [...recipe.tags],
  };
}

/** A total time as the form shows it, hours:minutes: 90 as "1:30", 45 as "0:45", 120 as "2:00", and none as "". */
export function formatTotalTime(total: number | undefined): string {
  if (total === undefined) return "";
  const minutes = total % 60;
  return `${Math.floor(total / 60)}:${minutes < 10 ? "0" : ""}${minutes}`;
}

// Hours, a colon and two digits of minutes ("1:30", "0:45"), or a number of minutes ("45"). Only ASCII digits: no sign, no
// decimal point. "1:5" is refused rather than guessed at, since it could mean 1:05 or 1:50.
const HOURS_MINUTES = /^([0-9]+):([0-5][0-9])$/;
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
    ingredients: form.ingredients.map((e) => e.text),
    steps: form.steps.map((e) => e.text),
    tags: [...form.tags],
  };
  const minutes = totalMinutes(form.totalTime);
  if (typeof minutes === "number") input.totalTimeMinutes = minutes;
  return input;
}

/** The content as typed, without row keys, to tell whether it has changed since it was loaded or saved. */
export function contentSnapshot(form: FormValues): string {
  return JSON.stringify([form.name, form.ingredients.map((e) => e.text), form.steps.map((e) => e.text), form.totalTime, form.tags]);
}

/**
 * The obvious problems the server would refuse anyway (REC-1, REC-2): no name, no ingredient or step that isn't blank, and a
 * total time that can't be read as minutes. Paths and wording match the server's, so both are shown the same way.
 */
export function obviousErrors(form: FormValues): ErrorItem[] {
  const errors: ErrorItem[] = [];
  if (form.name.trim() === "") errors.push({ code: "name.required", field: "name", message: "Enter a name (up to 200 characters)." });
  if (form.ingredients.every((e) => e.text.trim() === "")) {
    errors.push({ code: "ingredients.required", field: "ingredients", message: "Add at least one ingredient. Blank ones are ignored." });
  }
  if (form.steps.every((e) => e.text.trim() === "")) {
    errors.push({ code: "steps.required", field: "steps", message: "Add at least one step. Blank steps are ignored." });
  }
  if (totalMinutes(form.totalTime) === null) {
    errors.push({
      code: "totalTime.format",
      field: "totalTimeMinutes",
      message: "Enter the time as hours:minutes, like 1:30, or as minutes, like 45.",
    });
  }
  return errors;
}

/**
 * The form with `typed` added as a tag (REC-10). Trimmed so the chip shows what will be saved, and not added twice when the very
 * same text is there already; lowercasing, merging and every other tag rule are the server's on Save (REC-11).
 */
export function withTag(form: FormValues, typed: string): FormValues {
  const tag = typed.trim();
  return tag === "" || form.tags.includes(tag) ? form : { ...form, tags: [...form.tags, tag] };
}

/** Where an error is shown: a field of the form, or only in the summary at the top. */
export interface FormErrors {
  /**
   * Messages by field: "name", "photo", "totalTimeMinutes", "ingredients" and "steps" (the list as a whole), "ingredients#<key>"
   * and "steps#<key>" (one row, by its key, so the message stays with the row when one above it is removed), "tags", and "tag:<text>" (one tag).
   */
  fields: ReadonlyMap<string, readonly string[]>;
  /** Messages that belong to no field shown in the form, such as "This recipe is in the trash." (REC-17). */
  general: readonly string[];
}

export const NO_ERRORS: FormErrors = { fields: new Map(), general: [] };

export function entryField(field: EntryField, entry: Entry): string {
  return `${field}#${entry.key}`;
}

export function tagField(tag: string): string {
  return `tag:${tag}`;
}

const SIMPLE_FIELDS = new Set(["name", "photo", "totalTimeMinutes", "ingredients", "steps", "tags"]);

/** The form field of a server error path such as "ingredients[2]" or "tags[0]", given the form as it was sent. */
function formField(path: string | undefined, sent: FormValues): string | undefined {
  if (path === undefined) return undefined;
  if (SIMPLE_FIELDS.has(path)) return path;
  const match = /^(ingredients|steps|tags)\[(\d+)\]$/.exec(path);
  if (match === null) return undefined;
  const [, list, position] = match;
  const index = Number(position);
  if (list === "tags") {
    const tag = sent.tags[index];
    return tag === undefined ? "tags" : tagField(tag);
  }
  const field = list as EntryField;
  const entry = sent[field][index];
  return entry === undefined ? field : entryField(field, entry);
}

/** Sorts the server's (or the obvious) errors into the fields of the form that was sent. */
export function formErrors(errors: readonly ErrorItem[], sent: FormValues): FormErrors {
  const fields = new Map<string, string[]>();
  const general: string[] = [];
  for (const error of errors) {
    const field = formField(error.field, sent);
    if (field === undefined) {
      general.push(error.message);
      continue;
    }
    const messages = fields.get(field) ?? [];
    if (!messages.includes(error.message)) messages.push(error.message);
    fields.set(field, messages);
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
