// Note endpoints (docs/api.md) against the in-memory repository, using the REC-25 rows of the examples table in
// docs/specs/recipes.md. The rules themselves are tested in packages/domain; these tests show each endpoint applies them, and
// that notes never reach a visitor (X-1).
import { describe, expect, it } from "vitest";
import { EditorRecipe, EditorRecipeSummary, PublicRecipe, RecipeSummary } from "@recipebox/shared";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  expectErrors,
  get,
  recipeApp,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";
/** The first id the test app gives a note (sequentialNoteIds). */
const FIRST_NOTE_ID = "11111111-0000-4000-8000-000000000001";

type App = Awaited<ReturnType<typeof recipeApp>>["app"];

async function addNote(app: App, id: string, text: string): Promise<EditorRecipe> {
  const res = await change(app, "POST", `/recipes/${id}/notes`, { text });
  expect(res.statusCode, res.body).toBe(200);
  return EditorRecipe.parse(res.json());
}

async function editorView(app: App, id: string): Promise<EditorRecipe> {
  const res = await get(app, `/recipes/${id}`, AS_EDITOR);
  expect(res.statusCode, res.body).toBe(200);
  return EditorRecipe.parse(res.json());
}

/** `count` notes, one a day from 2026-09-01, for seeding. */
function notes(count: number): { text: string; at: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `note ${i + 1}`,
    at: new Date(Date.UTC(2026, 8, i + 1, 19)).toISOString(),
  }));
}

describe("REC-25 add a note", () => {
  it('spec example: note "  use more butter " added Nov 11 is saved as "use more butter", dated Nov 11', async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-11-11T19:30:00.000Z");

    const saved = await addNote(app, recipe.id.value, "  use more butter ");

    expect(saved.notes).toEqual([{ id: FIRST_NOTE_ID, text: "use more butter", addedAt: "2026-11-11T19:30:00.000Z" }]);
    expect((await repository.get(recipe.id))?.toSnapshot().notes).toEqual([
      { id: FIRST_NOTE_ID, text: "use more butter", addedAt: "2026-11-11T19:30:00.000Z" },
    ]);
  });

  it("keeps several lines", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const saved = await addNote(app, recipe.id.value, "use more butter\nless salt\n");
    expect(saved.notes?.[0]?.text).toBe("use more butter\nless salt");
  });

  it.each([
    ["only spaces", "     ", "note.required"],
    ["1,001 characters", "x".repeat(1001), "note.tooLong"],
  ])("spec example: a note of %s is rejected with 400, and nothing changes", async (_name, text, code) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1) });
    const before = await storedSnapshots(repository);

    const body = expectErrors(await change(app, "POST", `/recipes/${recipe.id.value}/notes`, { text }), 400, [code]);

    expect(body.errors[0]?.field).toBe("text");
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("spec example: a 51st note added to a recipe is rejected with 400, and nothing changes", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(50) });
    const before = await storedSnapshots(repository);

    expectErrors(await change(app, "POST", `/recipes/${recipe.id.value}/notes`, { text: "one more" }), 400, ["notes.tooMany"]);

    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it.each([
    ["no text", {}, "request.invalid"],
    ["text that isn't a string", { text: 3 }, "request.invalid"],
    ["another field", { text: "less salt", note: "less salt" }, "request.unknownField"],
  ])("refuses a body with %s with 400, and changes nothing", async (_name, payload, code) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const before = await storedSnapshots(repository);
    const res = await change(app, "POST", `/recipes/${recipe.id.value}/notes`, payload);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors.map((e: { code: string }) => e.code)).toContain(code);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", "not-a-uuid"],
  ])("answers a recipe with %s with 404", async (_name, id) => {
    const { app, repository } = await recipeApp();
    expectErrors(await change(app, "POST", `/recipes/${id}/notes`, { text: "less salt" }), 404, ["recipe.notFound"]);
    expect(await repository.list()).toEqual([]);
  });
});

describe("REC-25 notes listed newest first", () => {
  it("spec example: notes added Nov 2, then Nov 9, are listed Nov 9, then Nov 2", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-11-02T18:00:00.000Z");
    await addNote(app, recipe.id.value, "first");
    clock.set("2026-11-09T18:00:00.000Z");
    await addNote(app, recipe.id.value, "second");

    expect((await editorView(app, recipe.id.value)).notes).toEqual([
      { id: "11111111-0000-4000-8000-000000000002", text: "second", addedAt: "2026-11-09T18:00:00.000Z" },
      { id: FIRST_NOTE_ID, text: "first", addedAt: "2026-11-02T18:00:00.000Z" },
    ]);
  });

  it("an editor's recipe without notes has no notes field, so older clients can still read it", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const res = await get(app, `/recipes/${recipe.id.value}`, AS_EDITOR);
    expect(res.body).not.toContain('"notes"');
  });
});

describe("REC-25 delete a note", () => {
  it("deletes the note at once and answers with the recipe", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(2) });
    const [newest, oldest] = recipe.notes;

    const res = await change(app, "DELETE", `/recipes/${recipe.id.value}/notes/${newest?.id.value}`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).notes?.map((n) => n.id)).toEqual([oldest?.id.value]);
    expect((await repository.get(recipe.id))?.notes.map((n) => n.text.value)).toEqual(["note 1"]);
  });

  it("deleting the last note leaves the recipe without notes", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1) });
    const res = await change(app, "DELETE", `/recipes/${recipe.id.value}/notes/${recipe.notes[0]?.id.value}`);
    expect(EditorRecipe.parse(res.json()).notes).toBeUndefined();
    expect((await repository.get(recipe.id))?.toSnapshot()).not.toHaveProperty("notes");
  });

  it.each([
    ["a note the recipe doesn't have", "11111111-0000-4000-8000-000000000099"],
    ["a malformed note id", "not-a-uuid"],
  ])("answers %s with 404 note.notFound, and changes nothing", async (_name, noteId) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1) });
    const before = await storedSnapshots(repository);
    expectErrors(await change(app, "DELETE", `/recipes/${recipe.id.value}/notes/${noteId}`), 404, ["note.notFound"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("answers deleting a note again, as from another device, with 404 note.notFound", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1) });
    const url = `/recipes/${recipe.id.value}/notes/${recipe.notes[0]?.id.value}`;
    expect((await change(app, "DELETE", url)).statusCode).toBe(200);
    expectErrors(await change(app, "DELETE", url), 404, ["note.notFound"]);
  });

  it("answers a note of another recipe with 404 note.notFound, and leaves that note", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const other = await seed(repository, content("Curry"), { notes: notes(1) });
    const res = await change(app, "DELETE", `/recipes/${recipe.id.value}/notes/${other.notes[0]?.id.value}`);
    expectErrors(res, 404, ["note.notFound"]);
    expect((await repository.get(other.id))?.notes).toHaveLength(1);
  });

  it("answers an unknown recipe with 404 recipe.notFound", async () => {
    const { app } = await recipeApp();
    expectErrors(await change(app, "DELETE", `/recipes/${UNKNOWN_ID}/notes/${FIRST_NOTE_ID}`), 404, ["recipe.notFound"]);
  });
});

describe("REC-25 notes are private (X-1)", () => {
  for (const [who, as] of [
    ["a visitor", AS_VISITOR],
    ["a signed-in non-editor", AS_NON_EDITOR],
  ] as const) {
    it(`spec example: ${who} opens a recipe that has notes: no notes, and nothing saying there are any`, async () => {
      const { app, repository, clock } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai"));
      const url = `/recipes/${recipe.id.value}`;
      const withoutNotes = await get(app, url, as);
      clock.set("2026-11-11T19:30:00.000Z");
      await addNote(app, recipe.id.value, "use more butter");
      await addNote(app, recipe.id.value, "less salt");

      const res = await get(app, url, as);

      expect(res.statusCode, res.body).toBe(200);
      PublicRecipe.parse(res.json());
      // The same answer as before the notes were added: not their text, time, id, count or any field about them.
      expect(res.body).toBe(withoutNotes.body);
      for (const leak of ['"notes"', "butter", "salt", "2026-11-11", FIRST_NOTE_ID]) expect(res.body).not.toContain(leak);
    });

    it(`gives ${who} the recipe list without notes`, async () => {
      const { app, repository } = await recipeApp();
      await seed(repository, content("Pad Thai"), { notes: [{ text: "use more butter", at: "2026-11-11T19:30:00.000Z" }] });
      const res = await get(app, "/recipes", as);
      RecipeSummary.array().parse(res.json());
      for (const leak of ['"notes"', "butter", "2026-11-11"]) expect(res.body).not.toContain(leak);
    });
  }

  it.each([
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const)("refuses %s adding or deleting a note, revealing nothing, and changes nothing", async (_who, as, status, code) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: [{ text: "use more butter", at: "2026-11-11T19:30:00.000Z" }] });
    const before = await storedSnapshots(repository);
    const id = recipe.id.value;
    for (const res of [
      await change(app, "POST", `/recipes/${id}/notes`, { text: "less salt" }, as),
      await change(app, "DELETE", `/recipes/${id}/notes/${recipe.notes[0]?.id.value}`, {}, as),
    ]) {
      expectErrors(res, status, [code]);
      expect(res.body).not.toContain("butter");
    }
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});

describe("REC-25 notes aren't recipe content", () => {
  it("spec example: recipe edited to add an ingredient; its notes are unchanged", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(2) });
    const before = (await editorView(app, recipe.id.value)).notes;

    const res = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, content("Pad Thai", { ingredients: ["1 thing", "1 lime"] }));

    expect(res.statusCode, res.body).toBe(200);
    const edited = EditorRecipe.parse(res.json());
    expect(edited.ingredients).toEqual(["1 thing", "1 lime"]);
    expect(edited.notes).toEqual(before);
    expect((await editorView(app, recipe.id.value)).notes).toEqual(before);
  });

  it("refuses notes sent with the recipe's content (REC-5), and changes nothing", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1) });
    const before = await storedSnapshots(repository);
    const notesField = [{ id: FIRST_NOTE_ID, text: "planted", addedAt: "2020-01-01T00:00:00.000Z" }];
    const res = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, { ...content("Pad Thai"), notes: notesField });
    expectErrors(res, 400, ["request.unknownField"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("the editor's recipe list doesn't show notes, and search doesn't look in them", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Pad Thai"), { notes: [{ text: "use more butter", at: "2026-11-11T19:30:00.000Z" }] });
    const list = await get(app, "/recipes", AS_EDITOR);
    EditorRecipeSummary.array().parse(list.json());
    expect(list.body).not.toContain("butter");
    const search = await get(app, "/recipes?name=butter", AS_EDITOR);
    expect(EditorRecipeSummary.array().parse(search.json())).toEqual([]);
  });
});

describe("REC-25 notes and the trash (REC-15, REC-17)", () => {
  it('spec example: "Pad Thai" with 2 notes deleted, then restored: back with its 2 notes', async () => {
    const { app, repository } = await recipeApp("2026-11-11T09:00:00.000Z");
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(2) });
    const before = (await editorView(app, recipe.id.value)).notes;
    expect(before).toHaveLength(2);

    expect((await change(app, "DELETE", `/recipes/${recipe.id.value}`)).statusCode).toBe(204);
    const res = await change(app, "POST", `/trash/${recipe.id.value}/restore`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).notes).toEqual(before);
  });

  it("refuses an editor adding or deleting a note on a recipe in the trash with 409 recipe.inTrash, and changes nothing", async () => {
    const { app, repository } = await recipeApp("2026-11-11T09:00:00.000Z");
    const recipe = await seed(repository, content("Pad Thai"), { notes: notes(1), deletedAt: "2026-11-10T09:00:00.000Z" });
    const before = await storedSnapshots(repository);
    const id = recipe.id.value;

    for (const res of [
      await change(app, "POST", `/recipes/${id}/notes`, { text: "less salt" }),
      await change(app, "POST", `/recipes/${id}/notes`, { text: "   " }),
      await change(app, "DELETE", `/recipes/${id}/notes/${recipe.notes[0]?.id.value}`),
      await change(app, "DELETE", `/recipes/${id}/notes/not-a-uuid`),
    ]) {
      expectErrors(res, 409, ["recipe.inTrash"]);
    }
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});

describe("X-12 a note's time comes from the server's clock", () => {
  it("stores the injected clock's time as the note's added time", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-03T04:05:06.007Z");

    await addNote(app, recipe.id.value, "less salt");

    expect((await repository.get(recipe.id))?.toSnapshot().notes?.[0]?.addedAt).toBe("2026-10-03T04:05:06.007Z");
  });
});
