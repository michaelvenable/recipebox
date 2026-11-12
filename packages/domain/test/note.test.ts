import { describe, expect, it } from "vitest";
import {
  findRecipes,
  Instant,
  MAX_NOTES,
  NoteId,
  NoteText,
  Recipe,
  RecipeId,
  type RecipeContentInput,
  type RecipeSnapshot,
} from "../src/index.js";
import { errorKeys, valueOf } from "./helpers.js";

const ID = "3f2a1c9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const padThai: RecipeContentInput = {
  name: "Pad Thai",
  ingredients: ["200 g rice noodles", "2 eggs"],
  steps: ["Soak the noodles.", "Fry everything."],
};

const at = (iso: string) => valueOf(Instant.fromIso(iso));
const recipe = (content: Partial<RecipeContentInput> = {}) =>
  valueOf(Recipe.create(valueOf(RecipeId.create(ID)), { ...padThai, ...content }, at("2026-08-01T10:00:00.000Z")));
/** Note ids 00000000-0000-4000-8000-000000000001, …002, … */
const noteId = (n: number) => valueOf(NoteId.create(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`));
const texts = (r: Recipe) => r.notes.map((n) => n.text.value);

/** A recipe with `count` notes, one a day from 2026-09-01. */
function withNotes(count: number): Recipe {
  const r = recipe();
  for (let i = 1; i <= count; i++) valueOf(r.addNote(noteId(i), `note ${i}`, valueOf(Instant.fromEpochMillis(Date.UTC(2026, 8, i)))));
  return r;
}

describe("REC-25 note text", () => {
  it('spec example: note "  use more butter " added Nov 11 is saved as "use more butter", dated Nov 11', () => {
    const r = recipe();
    const note = valueOf(r.addNote(noteId(1), "  use more butter ", at("2026-11-11T19:30:00.000Z")));
    expect(note.text.value).toBe("use more butter");
    expect(note.addedAt.toIso()).toBe("2026-11-11T19:30:00.000Z");
    expect(r.toSnapshot().notes).toEqual([
      { id: noteId(1).value, text: "use more butter", addedAt: "2026-11-11T19:30:00.000Z" },
    ]);
  });

  it.each([
    ["only spaces", "     ", "note.required"],
    ["empty", "", "note.required"],
    ["only line breaks and tabs", "\n\t \r\n", "note.required"],
    ["1,001 characters", "x".repeat(1001), "note.tooLong"],
  ])("spec example: a note of %s is rejected, and nothing changes", (_name, text, code) => {
    const r = withNotes(1);
    const before = r.toSnapshot();
    expect(errorKeys(r.addNote(noteId(2), text, at("2026-11-11T10:00:00Z")))).toEqual([{ code, field: "text" }]);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("accepts 1 and 1,000 characters after trimming, counting characters as a person sees them (X-13)", () => {
    expect(valueOf(NoteText.create("x")).value).toBe("x");
    expect(valueOf(NoteText.create(` ${"x".repeat(1000)}  `)).value).toBe("x".repeat(1000));
    expect(valueOf(NoteText.create("👨‍👩‍👧".repeat(1000))).value).toHaveLength("👨‍👩‍👧".length * 1000);
  });

  it("keeps several lines, trimming only the ends", () => {
    expect(valueOf(NoteText.create("\n  use more butter\n\nless salt  \n")).value).toBe("use more butter\n\nless salt");
  });
});

describe("REC-25 notes are timed by the server", () => {
  it("records the time it is given, which the server takes from its clock (X-12)", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "less salt", at("2026-11-02T08:00:00Z")));
    expect(r.notes[0]?.addedAt.toIso()).toBe("2026-11-02T08:00:00.000Z");
    expect(r.notes[0]?.id.value).toBe(noteId(1).value);
  });

  it("returns the note it added", () => {
    const note = valueOf(recipe().addNote(noteId(7), "less salt", at("2026-11-02T08:00:00Z")));
    expect(note.id.value).toBe(noteId(7).value);
  });
});

describe("REC-25 notes listed newest first", () => {
  it("spec example: notes added Nov 2, then Nov 9, are listed Nov 9, then Nov 2", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "first", at("2026-11-02T08:00:00Z")));
    valueOf(r.addNote(noteId(2), "second", at("2026-11-09T08:00:00Z")));
    expect(r.notes.map((n) => n.addedAt.toIso())).toEqual(["2026-11-09T08:00:00.000Z", "2026-11-02T08:00:00.000Z"]);
    expect(texts(r)).toEqual(["second", "first"]);
  });

  it("keeps newest first if the server's clock steps back", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "late", at("2026-11-09T08:00:00Z")));
    valueOf(r.addNote(noteId(2), "early", at("2026-11-02T08:00:00Z")));
    expect(texts(r)).toEqual(["late", "early"]);
  });

  it("lists the note just added first when two have the same time", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "first", at("2026-11-02T08:00:00Z")));
    valueOf(r.addNote(noteId(2), "second", at("2026-11-02T08:00:00Z")));
    expect(texts(r)).toEqual(["second", "first"]);
  });

  it("a recipe without notes has none", () => {
    expect(recipe().notes).toEqual([]);
  });

  it("is a copy: changing the list doesn't change the recipe", () => {
    const r = withNotes(2);
    expect(() => (r.notes as unknown[]).pop()).toThrow();
    expect(r.notes).toHaveLength(2);
  });
});

describe("REC-25 at most 50 notes", () => {
  it("accepts a 50th note", () => {
    const r = withNotes(49);
    valueOf(r.addNote(noteId(50), "fiftieth", at("2026-11-11T10:00:00Z")));
    expect(r.notes).toHaveLength(MAX_NOTES);
  });

  it("spec example: a 51st note added to a recipe is rejected, and nothing changes", () => {
    const r = withNotes(50);
    const before = r.toSnapshot();
    expect(errorKeys(r.addNote(noteId(51), "one more", at("2026-11-11T10:00:00Z")))).toEqual([
      { code: "notes.tooMany", field: undefined },
    ]);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("accepts a note again once one of the 50 is deleted", () => {
    const r = withNotes(50);
    valueOf(r.deleteNote(noteId(3).value));
    valueOf(r.addNote(noteId(51), "one more", at("2026-11-11T10:00:00Z")));
    expect(r.notes).toHaveLength(50);
  });
});

describe("REC-25 delete a note", () => {
  it("removes only that note", () => {
    const r = withNotes(3);
    valueOf(r.deleteNote(noteId(2).value));
    expect(texts(r)).toEqual(["note 3", "note 1"]);
  });

  it("reads the id in either case", () => {
    const r = withNotes(1);
    valueOf(r.deleteNote(noteId(1).value.toUpperCase()));
    expect(r.notes).toEqual([]);
  });

  it.each([
    ["a note the recipe doesn't have", "00000000-0000-4000-8000-000000000099"],
    ["one already deleted", "00000000-0000-4000-8000-000000000001"],
    ["a malformed id", "not-a-uuid"],
  ])("fails with note.notFound for %s, and nothing changes", (_name, id) => {
    const r = withNotes(2);
    if (id === noteId(1).value) valueOf(r.deleteNote(id));
    const before = r.toSnapshot();
    expect(errorKeys(r.deleteNote(id))).toEqual([{ code: "note.notFound", field: undefined }]);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("deleting the last note leaves none, and the snapshot without notes", () => {
    const r = withNotes(1);
    valueOf(r.deleteNote(noteId(1).value));
    expect(r.notes).toEqual([]);
    expect("notes" in r.toSnapshot()).toBe(false);
  });
});

describe("REC-25 notes aren't recipe content (REC-5)", () => {
  it("spec example: recipe edited to add an ingredient; its notes are unchanged", () => {
    const r = withNotes(2);
    const before = r.toSnapshot().notes;
    valueOf(r.revise({ ...padThai, ingredients: [...padThai.ingredients, "1 lime"] }));
    expect(r.content.ingredients.map((e) => e.value)).toContain("1 lime");
    expect(r.toSnapshot().notes).toEqual(before);
  });

  it("an invalid edit leaves them unchanged too", () => {
    const r = withNotes(2);
    const before = r.toSnapshot();
    expect(r.revise({ ...padThai, name: " " }).ok).toBe(false);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("search doesn't look in them (REC-9)", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "use more butter", at("2026-11-11T10:00:00Z")));
    expect(findRecipes([r], { name: "butter" })).toEqual([]);
  });
});

describe("REC-25 notes and the trash (REC-15, REC-17)", () => {
  it('spec example: "Pad Thai" with 2 notes deleted, then restored: back with its 2 notes', () => {
    const r = withNotes(2);
    const before = r.toSnapshot().notes;
    r.delete(at("2026-11-10T09:00:00Z"));
    expect(r.notes).toHaveLength(2);
    valueOf(r.restore(at("2026-11-11T09:00:00Z")));
    expect(r.content.name.value).toBe("Pad Thai");
    expect(r.toSnapshot().notes).toEqual(before);
  });

  it("keeps notes through a stored round trip while in the trash", () => {
    const r = withNotes(2);
    r.delete(at("2026-11-10T09:00:00Z"));
    const stored = Recipe.fromSnapshot(r.toSnapshot());
    valueOf(stored.restore(at("2026-11-11T09:00:00Z")));
    expect(texts(stored)).toEqual(["note 2", "note 1"]);
  });

  it("refuses adding a note while in the trash with recipe.inTrash, even an invalid one, and nothing changes", () => {
    const r = withNotes(1);
    r.delete(at("2026-11-10T09:00:00Z"));
    const before = r.toSnapshot();
    for (const text of ["less salt", "  ", "x".repeat(1001)]) {
      expect(errorKeys(r.addNote(noteId(2), text, at("2026-11-11T10:00:00Z")))).toEqual([
        { code: "recipe.inTrash", field: undefined },
      ]);
    }
    expect(r.toSnapshot()).toEqual(before);
  });

  it("refuses deleting a note while in the trash with recipe.inTrash, even an unknown one, and nothing changes", () => {
    const r = withNotes(1);
    r.delete(at("2026-11-10T09:00:00Z"));
    const before = r.toSnapshot();
    for (const id of [noteId(1).value, noteId(9).value, "not-a-uuid"]) {
      expect(errorKeys(r.deleteNote(id))).toEqual([{ code: "recipe.inTrash", field: undefined }]);
    }
    expect(r.toSnapshot()).toEqual(before);
  });
});

describe("REC-25 note ids", () => {
  it("are UUIDs, stored in lowercase", () => {
    expect(valueOf(NoteId.create("3F2A1C9E-5B7D-4E8F-9A0B-1C2D3E4F5A6B")).value).toBe("3f2a1c9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b");
    for (const raw of ["", "not-a-uuid", "3f2a1c9e5b7d4e8f9a0b1c2d3e4f5a6b"]) {
      expect(NoteId.create(raw).ok).toBe(false);
    }
  });

  it("a duplicate id from the server's id source is a bug, so it throws", () => {
    const r = withNotes(1);
    expect(() => r.addNote(noteId(1), "again", at("2026-11-11T10:00:00Z"))).toThrow();
  });
});

describe("REC-25 notes snapshot", () => {
  it("stores notes newest first, and round-trips them", () => {
    const r = recipe();
    valueOf(r.addNote(noteId(1), "less salt", at("2026-11-02T08:00:00Z")));
    valueOf(r.addNote(noteId(2), "line one\nline two", at("2026-11-09T08:00:00Z")));
    const snapshot = r.toSnapshot();
    expect(snapshot.notes).toEqual([
      { id: noteId(2).value, text: "line one\nline two", addedAt: "2026-11-09T08:00:00.000Z" },
      { id: noteId(1).value, text: "less salt", addedAt: "2026-11-02T08:00:00.000Z" },
    ]);
    expect(Recipe.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("omits notes when there are none, and reads a document stored before notes existed as having none", () => {
    const stored = recipe().toSnapshot();
    expect("notes" in stored).toBe(false);
    expect(Recipe.fromSnapshot(stored).notes).toEqual([]);
    expect(Recipe.fromSnapshot({ ...stored, notes: [] }).notes).toEqual([]);
  });

  it("is a copy: changing the snapshot doesn't change the recipe", () => {
    const r = withNotes(2);
    const snapshot = r.toSnapshot();
    snapshot.notes?.pop();
    expect(r.notes).toHaveLength(2);
  });

  describe("fromSnapshot throws on invalid stored notes", () => {
    const valid = (): RecipeSnapshot => withNotes(3).toSnapshot();
    const first = (s: RecipeSnapshot) => {
      const note = s.notes?.[0];
      if (note === undefined) throw new Error("no notes");
      return note;
    };
    const cases: [string, (s: RecipeSnapshot) => void][] = [
      ["an invalid note id", (s) => (first(s).id = "not-a-uuid")],
      ["an uppercase note id", (s) => (first(s).id = "ABCDEF00-0000-4000-8000-000000000001")],
      ["two notes with the same id", (s) => (first(s).id = s.notes![1]!.id)],
      ["a blank note", (s) => (first(s).text = "  ")],
      ["an untrimmed note", (s) => (first(s).text = " less salt")],
      ["a note of 1,001 characters", (s) => (first(s).text = "x".repeat(1001))],
      ["an invalid added time", (s) => (first(s).addedAt = "yesterday")],
      ["a non-canonical added time", (s) => (first(s).addedAt = "2026-09-03T00:00:00Z")],
      ["notes oldest first", (s) => s.notes?.reverse()],
      [
        "51 notes",
        (s) =>
          (s.notes = Array.from({ length: 51 }, (_, i) => ({
            id: noteId(i + 1).value,
            text: "x",
            addedAt: "2026-09-01T00:00:00.000Z",
          }))),
      ],
    ];

    it("accepts the unmodified snapshot", () => {
      expect(() => Recipe.fromSnapshot(valid())).not.toThrow();
    });

    it.each(cases)("%s", (_, corrupt) => {
      const s = valid();
      corrupt(s);
      expect(() => Recipe.fromSnapshot(s)).toThrow(/Invalid stored recipe/);
    });
  });
});
