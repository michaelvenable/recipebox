import { describe, expect, it } from "vitest";
import { RecipeContentInput } from "@recipebox/shared";
import {
  MAX_PHOTO_BYTES,
  contentInput,
  entryField,
  formErrors,
  formFrom,
  formatTotalTime,
  newEntry,
  obviousErrors,
  photoProblem,
  tagField,
  totalMinutes,
} from "../src/recipes/recipe-form.js";

describe("REC-1 total time as hours:minutes or minutes", () => {
  it.each([
    ["", undefined],
    ["   ", undefined],
    ["1:30", 90],
    ["0:45", 45],
    ["2:00", 120],
    ["01:05", 65],
    ["0:00", 0],
    ["45", 45],
    ["90", 90],
    ["0", 0],
    [" 1:30 ", 90],
    ["\t45 ", 45],
    ["24:00", 1440],
    ["24:01", 1441],
    ["1500", 1500],
  ])("%j sends %j; the server checks the range (REC-1)", (typed, expected) => {
    expect(totalMinutes(typed)).toBe(expected);
  });

  it.each([
    ["-5"],
    ["-1:30"],
    ["abc"],
    ["half an hour"],
    ["1:75"],
    ["1:60"],
    ["1.5"],
    ["1,5"],
    ["1:5"],
    ["1:300"],
    [":30"],
    ["1:"],
    ["1:30:00"],
    ["1 : 30"],
    ["1 30"],
    ["1h30"],
    ["+45"],
    ["1e3"],
    ["٤٥"],
    ["9".repeat(400)],
  ])("refuses %j, so nothing is sent", (typed) => {
    expect(totalMinutes(typed)).toBeNull();
  });

  it.each([
    [undefined, ""],
    [45, "0:45"],
    [60, "1:00"],
    [90, "1:30"],
    [120, "2:00"],
    [65, "1:05"],
    [1440, "24:00"],
  ])("shows %j minutes as %j", (total, shown) => {
    expect(formatTotalTime(total)).toBe(shown);
  });

  it.each([[45], [60], [90], [125], [1440]])("reads %j minutes back as shown", (total) => {
    expect(totalMinutes(formatTotalTime(total))).toBe(total);
  });

  it("asks for hours:minutes or minutes when the time can't be read, on the total time field", () => {
    const form = { ...formFrom(undefined), name: "Toast", totalTime: "1:75" };
    form.ingredients = [newEntry("Bread")];
    form.steps = [newEntry("Toast it.")];
    expect(obviousErrors(form)).toEqual([
      {
        code: "totalTime.format",
        field: "totalTimeMinutes",
        message: "Enter the time as hours:minutes, like 1:30, or as minutes, like 45.",
      },
    ]);
    expect(obviousErrors({ ...form, totalTime: "1:30" })).toEqual([]);
  });
});

describe("REC-1, REC-2, X-12 the content sent", () => {
  it("is exactly a RecipeContentInput, as typed, with no total time when it is blank", () => {
    const form = { ...formFrom(undefined), name: "  Pad Thai ", tags: ["dinner"] };
    form.ingredients = [newEntry("2 eggs"), newEntry("  ")];
    const input = contentInput(form);
    expect(input).toEqual({ name: "  Pad Thai ", ingredients: ["2 eggs", "  "], steps: [""], tags: ["dinner"] });
    expect("totalTimeMinutes" in input).toBe(false);
    expect(RecipeContentInput.parse(input)).toEqual(input);
  });

  it("includes the total time in minutes", () => {
    expect(contentInput({ ...formFrom(undefined), totalTime: "1:05" }).totalTimeMinutes).toBe(65);
  });

  it("starts an existing recipe's total time as hours:minutes", () => {
    const recipe = { id: "r", name: "Stew", ingredients: ["Beef"], steps: ["Simmer."], totalTimeMinutes: 45, tags: [], hasPhoto: false };
    expect(formFrom(recipe).totalTime).toBe("0:45");
    expect(formFrom({ ...recipe, totalTimeMinutes: undefined }).totalTime).toBe("");
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
