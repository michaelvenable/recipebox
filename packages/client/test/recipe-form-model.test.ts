import { describe, expect, it } from "vitest";
import { RecipeContentInput } from "@recipebox/shared";
import {
  MAX_PHOTO_BYTES,
  contentInput,
  entryField,
  formErrors,
  formFrom,
  moved,
  newEntry,
  photoProblem,
  splitMinutes,
  tagField,
  totalMinutes,
} from "../src/recipes/recipe-form.js";

describe("REC-1 total time as hours and minutes", () => {
  it.each([
    ["", "", undefined],
    ["", "45", 45],
    ["1", "", 60],
    ["1", "30", 90],
    [" 2 ", " 5 ", 125],
    ["1.5", "", 90],
    ["1.1", "", 66],
    ["0", "0", 0],
    ["", "2.5", 2.5],
    ["24", "1", 1441],
  ])("hours %j and minutes %j send %j; the server checks the range and whole minutes", (hours, minutes, expected) => {
    expect(totalMinutes(hours, minutes)).toBe(expected);
  });

  it.each([
    ["abc", ""],
    ["", "ten"],
    ["1", "1,5"],
    ["-1", "90"],
    ["", "-5"],
  ])("hours %j and minutes %j aren't numbers of zero or more, so nothing can be sent", (hours, minutes) => {
    expect(totalMinutes(hours, minutes)).toBeNull();
  });

  it.each([
    [undefined, "", ""],
    [45, "", "45"],
    [60, "1", ""],
    [90, "1", "30"],
    [1440, "24", ""],
  ])("shows %j minutes as hours %j and minutes %j", (total, hours, minutes) => {
    expect(splitMinutes(total)).toEqual({ hours, minutes });
  });
});

describe("REC-1, REC-2, X-12 the content sent", () => {
  it("is exactly a RecipeContentInput, as typed, with no total time when both fields are blank", () => {
    const form = { ...formFrom(undefined), name: "  Pad Thai ", tags: ["dinner"] };
    form.ingredients = [newEntry("2 eggs"), newEntry("  ")];
    const input = contentInput(form);
    expect(input).toEqual({ name: "  Pad Thai ", ingredients: ["2 eggs", "  "], steps: [""], tags: ["dinner"] });
    expect("totalTimeMinutes" in input).toBe(false);
    expect(RecipeContentInput.parse(input)).toEqual(input);
  });

  it("includes the total time in minutes", () => {
    expect(contentInput({ ...formFrom(undefined), hours: "1", minutes: "5" }).totalTimeMinutes).toBe(65);
  });
});

describe("REC-1 server errors in the form's fields", () => {
  it("puts each error on the field it names, rows by key and tags by text, and the rest in the summary", () => {
    const form = { ...formFrom(undefined), tags: ["dinner, quick"] };
    form.ingredients = [newEntry("a"), newEntry("b")];
    const second = form.ingredients[1]!;
    const errors = formErrors(
      [
        { code: "name.tooLong", field: "name", message: "Name must be at most 200 characters." },
        { code: "entry.tooLong", field: "ingredients[1]", message: "An entry must be at most 1000 characters." },
        { code: "steps.required", field: "steps", message: "At least 1 step is required." },
        { code: "tag.comma", field: "tags[0]", message: "A tag can't contain a comma." },
        { code: "request.unknownField", field: "cookedAt", message: '"cookedAt" is not an accepted field.' },
        { code: "recipe.inTrash", message: "This recipe is in the trash." },
      ],
      form,
    );
    expect([...errors.fields.keys()]).toEqual(["name", entryField("ingredients", second), "steps", tagField("dinner, quick")]);
    expect(errors.general).toEqual(['"cookedAt" is not an accepted field.', "This recipe is in the trash."]);
  });

  it("puts an error on a row that isn't there on the list as a whole", () => {
    const errors = formErrors([{ code: "entry.tooLong", field: "steps[5]", message: "Too long." }], formFrom(undefined));
    expect(errors.fields.get("steps")).toEqual(["Too long."]);
  });
});

describe("REC-3, REC-5 moving entries", () => {
  it("moves an entry up or down, keeping the others in order", () => {
    expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });
});

describe("REC-7 photo checks before uploading", () => {
  function file(name: string, type: string, size = 1000): File {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
  }

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.webp", "image/webp"],
    ["photo.jpg", ""],
    // The browser's type wins over the name: this is a JPEG, whatever it is called.
    ["IMG_0001.heic", "image/jpeg"],
  ])("accepts %s (%j), leaving the bytes to the server", (name, type) => {
    expect(photoProblem(file(name, type))).toBeUndefined();
  });

  it("accepts exactly 15 MB and refuses more", () => {
    expect(photoProblem(file("big.jpg", "image/jpeg", MAX_PHOTO_BYTES))).toBeUndefined();
    expect(photoProblem(file("big.jpg", "image/jpeg", MAX_PHOTO_BYTES + 1))).toBe("The photo is larger than 15 MB. Choose a smaller one.");
  });

  it.each([
    ["IMG_0001.HEIC", "image/heic"],
    ["IMG_0001.heic", ""],
    ["IMG_0001.heif", "image/heif"],
  ])("refuses HEIC (%s), saying to choose a JPEG", (name, type) => {
    expect(photoProblem(file(name, type))).toBe("HEIC photos can't be used. Choose a JPEG instead.");
  });

  it.each([
    ["notes.txt", "text/plain"],
    ["photo.gif", "image/gif"],
  ])("refuses %s", (name, type) => {
    expect(photoProblem(file(name, type))).toBe("Choose a JPEG, PNG or WebP photo.");
  });
});
