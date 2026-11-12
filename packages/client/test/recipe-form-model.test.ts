import { describe, expect, it } from "vitest";
import { RecipeContentInput } from "@recipebox/shared";
import {
  MAX_PHOTO_BYTES,
  contentInput,
  contentSnapshot,
  entryLines,
  formErrors,
  formFrom,
  formatTotalTime,
  obviousErrors,
  photoProblem,
  servingsCount,
  tagBeingTyped,
  tagItems,
  totalMinutes,
  withSuggestion,
} from "../src/recipes/recipe-form.js";

describe("REC-1 total time as hours:minutes or minutes", () => {
  it.each([
    ["", undefined],
    ["   ", undefined],
    ["1:30", 90],
    ["0:45", 45],
    [":45", 45],
    [":05", 5],
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
    [":5"],
    [":"],
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
    const form = { ...formFrom(undefined), name: "Toast", ingredients: "Bread", steps: "Toast it.", totalTime: "1:75" };
    expect(obviousErrors(form)).toEqual([
      {
        code: "totalTime.format",
        field: "totalTimeMinutes",
        message: "Enter the time as hours:minutes, like 1:30 or :45, or as minutes, like 45.",
      },
    ]);
    expect(obviousErrors({ ...form, totalTime: "1:30" })).toEqual([]);
  });
});

const STEW = {
  id: "r",
  name: "Stew",
  ingredients: ["Beef", "2 carrots"],
  prep: ["Dice the beef.", "Slice the carrots."],
  steps: ["Brown the beef.", "Simmer."],
  totalTimeMinutes: 45,
  tags: ["dinner", "slow"],
  hasPhoto: false,
};

describe("REC-1, REC-2, X-12 the content sent", () => {
  it("is exactly a RecipeContentInput, as typed, with no total time when it is blank", () => {
    const form = { ...formFrom(undefined), name: "  Pad Thai ", ingredients: "2 eggs\n  ", steps: "Fry.", tags: "dinner" };
    const input = contentInput(form);
    expect(input).toEqual({ name: "  Pad Thai ", ingredients: ["2 eggs", "  "], prep: [], steps: ["Fry."], tags: ["dinner"] });
    expect("totalTimeMinutes" in input).toBe(false);
    expect(RecipeContentInput.parse(input)).toEqual(input);
  });

  it("includes the total time in minutes", () => {
    expect(contentInput({ ...formFrom(undefined), totalTime: "1:05" }).totalTimeMinutes).toBe(65);
    expect(contentInput({ ...formFrom(undefined), totalTime: ":45" }).totalTimeMinutes).toBe(45);
  });

  it("starts an existing recipe's total time as hours:minutes", () => {
    expect(formFrom(STEW).totalTime).toBe("0:45");
    expect(formFrom({ ...STEW, totalTimeMinutes: undefined }).totalTime).toBe("");
  });
});

describe("REC-21 one entry per line", () => {
  it('sends "Boil water", two blank lines, "Add pasta" as lines, which the server saves as ["Boil water", "Add pasta"]', () => {
    // Blank lines are sent as they are, so entry i stays line i + 1; the server discards them (REC-2).
    expect(entryLines("Boil water\n\n\nAdd pasta")).toEqual(["Boil water", "", "", "Add pasta"]);
    expect(contentInput({ ...formFrom(undefined), steps: "Boil water\n\n\nAdd pasta" }).steps).toEqual([
      "Boil water",
      "",
      "",
      "Add pasta",
    ]);
  });

  it("splits on any kind of line break and keeps the text as typed, numbering included", () => {
    expect(entryLines("1. Chop\r\n2. Fry\rServe")).toEqual(["1. Chop", "2. Fry", "Serve"]);
    expect(entryLines("  a pinch of salt ")).toEqual(["  a pinch of salt "]);
    expect(entryLines("")).toEqual([]);
  });

  it("starts an existing recipe with its entries one per line, and sends them back unchanged", () => {
    const form = formFrom(STEW);
    expect(form.ingredients).toBe("Beef\n2 carrots");
    expect(form.prep).toBe("Dice the beef.\nSlice the carrots.");
    expect(form.steps).toBe("Brown the beef.\nSimmer.");
    const input = contentInput(form);
    expect(input.ingredients).toEqual(STEW.ingredients);
    expect(input.prep).toEqual(STEW.prep);
    expect(input.steps).toEqual(STEW.steps);
  });

  it("starts a recipe without prep with an empty Prep box", () => {
    expect(formFrom({ ...STEW, prep: [] }).prep).toBe("");
    // The server leaves prep out when there is none (REC-20).
    const { prep: _prep, ...withoutPrep } = STEW;
    expect(formFrom(withoutPrep).prep).toBe("");
  });

  it("shows line breaks inside an entry saved earlier as a space, so it stays one entry", () => {
    const form = formFrom({ ...STEW, steps: ["Whisk the eggs.\nThen fold in the flour.", "Bake\r\n\r\nfor 20 minutes.", "Cool.\r"] });
    expect(form.steps).toBe("Whisk the eggs. Then fold in the flour.\nBake for 20 minutes.\nCool. ");
    expect(contentInput(form).steps).toEqual(["Whisk the eggs. Then fold in the flour.", "Bake for 20 minutes.", "Cool. "]);
  });

  it("counts an edit to any box as a change", () => {
    const form = formFrom(STEW);
    expect(contentSnapshot(form)).toBe(contentSnapshot(formFrom(STEW)));
    for (const field of ["ingredients", "prep", "steps", "tags"] as const) {
      expect(contentSnapshot({ ...form, [field]: `${form[field]}x` }), field).not.toBe(contentSnapshot(form));
    }
  });

  it("asks for an ingredient and a step when their boxes have only blank lines, but not for prep", () => {
    const form = { ...formFrom(undefined), name: "Toast", ingredients: " \n\n", prep: "", steps: "\n" };
    expect(obviousErrors(form).map((e) => e.field)).toEqual(["ingredients", "steps"]);
    expect(obviousErrors({ ...form, ingredients: "\nBread", steps: "Toast it." })).toEqual([]);
  });
});

describe("REC-10, REC-11 tags typed as a comma-separated list", () => {
  it('sends "Dinner, quick,, " as "Dinner" and "quick"; the server lowercases them', () => {
    expect(tagItems("Dinner, quick,, ")).toEqual(["Dinner", "quick"]);
    expect(contentInput({ ...formFrom(undefined), tags: "Dinner, quick,, " }).tags).toEqual(["Dinner", "quick"]);
  });

  it("sends no tags for an empty or blank field", () => {
    expect(tagItems("")).toEqual([]);
    expect(tagItems(" , ,")).toEqual([]);
  });

  it("starts an existing recipe with its tags separated by commas", () => {
    expect(formFrom(STEW).tags).toBe("dinner, slow");
    expect(formFrom({ ...STEW, tags: [] }).tags).toBe("");
  });
});

describe("REC-12 the tag being typed", () => {
  it("is the text after the last comma", () => {
    expect(tagBeingTyped("dinner, qu")).toEqual({ before: "dinner,", current: " qu" });
    expect(tagBeingTyped("qu")).toEqual({ before: "", current: "qu" });
    expect(tagBeingTyped("dinner, ")).toEqual({ before: "dinner,", current: " " });
  });

  it("is replaced by a chosen suggestion, followed by a comma for the next tag", () => {
    expect(withSuggestion("dinner, qu", "quick")).toBe("dinner, quick, ");
    expect(withSuggestion("dinner,qu", "quick")).toBe("dinner, quick, ");
    expect(withSuggestion("", "quick")).toBe("quick, ");
    expect(withSuggestion("dinner, ", "quick")).toBe("dinner, quick, ");
  });
});

describe("REC-1, REC-21 server errors in the form's fields", () => {
  it("puts each error on the field it names, an entry's with its line and a tag's with the tag, and the rest in the summary", () => {
    const form = { ...formFrom(undefined), ingredients: "a\n\nb", prep: "Chop.", tags: "dinner, Not a tag!" };
    const errors = formErrors(
      [
        { code: "name.tooLong", field: "name", message: "Name must be at most 200 characters." },
        { code: "entry.tooLong", field: "ingredients[2]", message: "An entry must be at most 1000 characters." },
        { code: "entry.tooLong", field: "prep[0]", message: "An entry must be at most 1000 characters." },
        { code: "steps.required", field: "steps", message: "At least 1 step is required." },
        { code: "tag.invalid", field: "tags[1]", message: "A tag can only contain letters." },
        { code: "request.unknownField", field: "cookedAt", message: '"cookedAt" is not an accepted field.' },
        { code: "recipe.inTrash", message: "This recipe is in the trash." },
      ],
      form,
    );
    expect(Object.fromEntries(errors.fields)).toEqual({
      name: ["Name must be at most 200 characters."],
      ingredients: ["Line 3: An entry must be at most 1000 characters."],
      prep: ["Line 1: An entry must be at most 1000 characters."],
      steps: ["At least 1 step is required."],
      tags: ["“Not a tag!”: A tag can only contain letters."],
    });
    expect(errors.general).toEqual(['"cookedAt" is not an accepted field.', "This recipe is in the trash."]);
  });

  it("puts an error on a line or tag that isn't there on the field as a whole", () => {
    const errors = formErrors(
      [
        { code: "entry.tooLong", field: "steps[5]", message: "Too long." },
        { code: "tag.tooLong", field: "tags[3]", message: "Too long." },
      ],
      formFrom(undefined),
    );
    expect(errors.fields.get("steps")).toEqual(["Too long."]);
    expect(errors.fields.get("tags")).toEqual(["Too long."]);
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

describe("REC-24 servings", () => {
  const form = () => ({ ...formFrom(undefined), name: "Stew", ingredients: "Beef", steps: "Simmer." });

  it.each([
    ["4", 4],
    [" 12 ", 12],
    ["", undefined],
    ["   ", undefined],
    // Sent, so the server says why it is refused (REC-24 examples).
    ["0", 0],
    ["2.5", 2.5],
    ["101", 101],
    ["four", null],
    ["-4", null],
    ["4 people", null],
    ["1e1", null],
    ["0x4", null],
  ])("reads %j as %j", (typed, count) => {
    expect(servingsCount(typed)).toBe(count);
  });

  it("spec example: servings left empty sends none", () => {
    const input = contentInput(form());
    expect("servings" in input).toBe(false);
  });

  it("sends servings 4 as a number, in a valid RecipeContentInput", () => {
    const input = contentInput({ ...form(), servings: "4" });
    expect(input.servings).toBe(4);
    expect(RecipeContentInput.parse(input)).toEqual(input);
  });

  it("starts an existing recipe's servings as typed text, and blank when it has none", () => {
    expect(formFrom({ ...STEW, servings: 4 }).servings).toBe("4");
    expect(formFrom(STEW).servings).toBe("");
  });

  it("counts a change to servings as a change", () => {
    expect(contentSnapshot({ ...form(), servings: "4" })).not.toBe(contentSnapshot(form()));
  });

  it("refuses text that isn't a number in the browser, at the servings field", () => {
    expect(obviousErrors({ ...form(), servings: "four" })).toEqual([
      { code: "servings.format", field: "servings", message: "Enter the number of people, like 4." },
    ]);
    expect(obviousErrors({ ...form(), servings: "4" })).toEqual([]);
  });

  it("puts the server's servings error next to the servings field", () => {
    const error = { code: "servings.outOfRange", field: "servings", message: "Servings must be between 1 and 100." };
    expect(formErrors([error], form()).fields.get("servings")).toEqual(["Servings must be between 1 and 100."]);
  });
});
