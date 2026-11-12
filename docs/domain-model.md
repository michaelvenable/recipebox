# Domain Model

The domain model is where RecipeBox's business rules live. It is a pure TypeScript package (`packages/domain`) with **no
dependencies**: no database, no HTTP, no clock, no file system. It can be read top to bottom and tested in isolation.

Rules cite spec IDs from `docs/specs/`. If a rule here has no spec ID, either the spec has a gap or the rule doesn't belong here.

## Design principles

1. **The domain is the only way to change a recipe.** Fields are private; all changes go through methods that enforce the rules.
   Code outside the domain cannot construct an invalid `Recipe`.
2. **Value objects are immutable and always valid.** A `RecipeName` that exists is already trimmed and 1–200 characters.
   Validation happens once, at construction.
3. **The domain never reads the clock.** Anything that depends on the current time receives it as an `Instant` argument, taken
   from the server's clock (X-12). This keeps tests deterministic.
4. **Expected failures are values, not exceptions.** Validation and rule violations return a `Result`. Exceptions are reserved for
   programmer errors (bugs), never for bad user input.
5. **All validation errors are reported at once.** REC-1 requires telling the user which fields are invalid, so content validation
   collects every error rather than stopping at the first.
6. **One recipe = one aggregate = one Cosmos document.** Everything that must stay consistent together (content, photo, to-make
   status, cooking history, notes) lives inside `Recipe`, so saving a recipe is a single atomic write.

## Building blocks

### Result and errors

```ts
type Result<T> = { ok: true; value: T } | { ok: false; errors: DomainError[] };

interface DomainError {
  code: string;      // stable, machine-readable, e.g. "name.tooLong"
  field?: string;    // e.g. "ingredients[2]" for UI highlighting
  message: string;   // human-readable default
}
```

### Value objects

| Class        | Rules                                                                          | Spec                       |
| ------------ | ------------------------------------------------------------------------------ | -------------------------- |
| `RecipeId`   | UUID, stored in lowercase; created outside the domain so tests can control it. | —                          |
| `RecipeName` | Trimmed; 1–200 characters. Sorting and search: see notes.                      | REC-1, REC-2, REC-8, REC-9 |
| `TextEntry`  | One ingredient, prep entry or step. Trimmed; 1–1,000 characters.               | REC-1, REC-2, REC-20       |
| `Minutes`    | Whole number, 1–1440.                                                          | REC-1                      |
| `PhotoRef`   | Blob name + content type. The domain never sees image bytes.                   | REC-7                      |
| `Tag`        | Trimmed and lowercased; 1–30 characters. Equal tags have equal text.           | REC-11                     |
| `Instant`    | A point in time (UTC). Passed in; the domain never reads the clock.            | X-12                       |
| `ShareToken` | A link code: base64url, 22–64 characters (128+ bits). Made by the server.      | PLAN-9                     |
| `NoteId`     | UUID, stored in lowercase; created outside the domain, like `RecipeId`.        | REC-25                     |
| `NoteText`   | A note's text. Trimmed; 1–1,000 characters; may have several lines.            | REC-25                     |

Notes:
- `RecipeName.compare(a, b)` sorts ignoring case and accents. `RecipeName.matches(term)` finds the trimmed term anywhere in the
  name, ignoring case and accents; an empty term matches everything.
- Character counts, sorting and matching all follow X-13: characters are counted as a person sees them (every emoji is one), and
  comparisons ignore case and accents using English rules. One shared helper implements this so every value object agrees:
  - All stored text (names, ingredients, prep, steps, tags, notes) is normalized to Unicode NFC, so text that looks the same is
    the same. Two "café" tags typed on different keyboards are one tag.
  - Search folds both the name and the term the same way sorting does: NFKD, accent marks removed, a small table for letters that
    don't decompose (ø→o, ł→l, đ→d, æ→ae, œ→oe, ß→ss), then lowercase. "smorrebrod" finds "Smørrebrød".
  - Tags that differ only in accents ("epice", "épicé") stay separate tags; only case is folded when a tag is stored.
- The domain has no calendar-date type. Everything it stores is an `Instant`; turning one into a local date or "3 months ago" is
  done on the device (X-12).

### RecipeContent

The user-editable part of a recipe, validated as a unit so all errors are collected together.

```ts
class RecipeContent {
  static create(input: RecipeContentInput): Result<RecipeContent>;
  // name, ingredients, prep, steps, tags, totalTime?, servings?
}
```

Rules:
- Ingredient, prep and step entries are trimmed and blank ones discarded before the "at least 1" check (REC-2).
- Prep is optional: zero entries is valid, and a missing `prep` in the input means none (REC-20).
- Order of ingredients, prep and steps is preserved exactly (REC-3).
- Duplicate tags collapse into one; at most 20 tags (REC-11).

### Recipe (aggregate root)

```ts
class Recipe {
  static create(id: RecipeId, content: RecipeContentInput, at: Instant): Result<Recipe>;  // REC-1, REC-22
  get createdAt(): Instant | undefined;  // the added time      // REC-22

  // Content
  revise(content: RecipeContentInput): Result<void>;            // REC-5
  setPhoto(photo: PhotoRef): Result<{ replaced?: PhotoRef }>;   // REC-7
  removePhoto(): Result<{ removed?: PhotoRef }>;                // REC-7

  // Deletion
  delete(at: Instant): void;                                    // REC-6
  restore(at: Instant): Result<void>;                           // REC-15, REC-16
  get isDeleted(): boolean;                                     // REC-6
  get deletedAt(): Instant | undefined;                         // REC-14
  removalDueAt(): Instant | undefined;  // deletedAt + 30 days  // REC-14, REC-16

  // Tags
  attachTag(tag: string): Result<void>;                         // REC-10, REC-11
  removeTag(tag: string): Result<void>;                         // REC-10
  get tags(): readonly Tag[];  // alphabetical                  // REC-11

  // To-make list
  addToMakeList(at: Instant): Result<void>;                     // PLAN-1, PLAN-2
  removeFromMakeList(): Result<void>;                           // PLAN-4
  get isOnMakeList(): boolean;                                  // PLAN-7
  get addedToMakeListAt(): Instant | undefined;                 // PLAN-3

  // Cooking history
  markCooked(at: Instant): Result<void>;                        // COOK-1; PLAN-5
  get cookedAt(): readonly Instant[];  // newest first          // COOK-5
  get lastCookedAt(): Instant | undefined;                      // COOK-5
  get timesCooked(): number;                                    // COOK-5

  // Notes
  addNote(id: NoteId, text: string, at: Instant): Result<Note>; // REC-25
  deleteNote(id: string): Result<void>;                         // REC-25
  get notes(): readonly Note[];  // oldest first                // REC-25

  // Persistence
  toSnapshot(): RecipeSnapshot;
  static fromSnapshot(s: RecipeSnapshot): Recipe;
}
```

Behavior rules:

| Method                        | Rule                                                                       | Spec           |
| ----------------------------- | -------------------------------------------------------------------------- | -------------- |
| `addToMakeList`               | If already on the list, does nothing (keeps the original added time).      | PLAN-2         |
| `removeFromMakeList`          | If not on the list, does nothing.                                          | PLAN-4         |
| `markCooked`                  | Always adds an entry, even if one exists for the same time.                | COOK-1, COOK-4 |
| `markCooked`                  | Removes the recipe from the to-make list.                                  | PLAN-5         |
| `lastCookedAt`, `timesCooked` | Derived from `cookedAt`; never stored, so they cannot drift.               | COOK-5         |
| `setPhoto`, `removePhoto`     | Return the previous `PhotoRef` so its blob can be deleted.                 | REC-7          |
| `revise`                      | Replaces content and tags. Never touches photo, plan, history or notes.    | REC-5, REC-25  |
| `attachTag`                   | Already attached: no-op, even at 20. Else fails if invalid or 20 attached. | REC-11         |
| `removeTag`                   | If the tag isn't attached, or isn't a valid tag, does nothing.             | REC-10         |
| `delete`                      | Clears to-make status. Already deleted: no-op.                             | REC-6, PLAN-6  |
| All changes except `restore`  | Fail with `recipe.inTrash` on a deleted recipe; nothing changes.           | REC-17         |
| `restore`                     | Fails with `trash.expired` if `at` is at or after `removalDueAt`.          | REC-16         |
| `restore`                     | Not deleted: does nothing.                                                 | REC-15         |
| `create`                      | `at` becomes `createdAt`, the added time. No method ever changes it.       | REC-22         |
| `addNote`                     | Fails if the text is invalid or the recipe already has 50 notes.           | REC-25         |
| `deleteNote`                  | Fails with `note.notFound` if the recipe has no note with that id.         | REC-25         |

Deleting a recipe (REC-6) moves it to the trash by marking it deleted and recording when. It also takes the recipe off the to-make
list (PLAN-6); nothing else inside it is cleared. `restore` clears the deleted mark, and the content, photo, tags, history and
notes are all still there (REC-15). Because the to-make status, history and notes live inside the document, no other data can be
left pointing at a deleted recipe, and removing the document removes them with it (REC-16).

Notes (REC-25) are private, like the history (X-1). Each `Note` is immutable: an id, its `NoteText` and `addedAt`, the
server's time (X-12); who added it isn't recorded. `notes` lists them oldest first, and notes with the same time in the order
they were added. Inside the recipe and in the snapshot they are kept the other way round, newest first, the order notes were
stored in before the owner chose oldest first (2026-11-11), so documents already stored load and save unchanged and `notes`
just reverses the list. `addNote` inserts by time rather than assuming the new one is the newest, as `markCooked` does; in the
kept, newest-first list a note with the same time as another goes before it. It fails with
`note.required` or `note.tooLong` (field `text`), or `notes.tooMany` at 50. Its id is made by the server, like a
`RecipeId`; an id the recipe already has is a bug and throws. `deleteNote` takes the id as sent, so a malformed one is simply
not found. Notes can't be edited. They aren't content: `revise`, `findRecipes` and the recipe list never look at them.

A recipe's added time (REC-22) is the `at` given to `create`: when it was created (REC-1), or when an import added it
(IMP-10). It is stored as `createdAt`, not `addedAt`, which on the to-make list (PLAN-3) means something else. Editing,
photo changes, deleting and restoring all keep it. Recipes stored before it was recorded have none, and none is made up
for them, so they never show as recently added. Which recipes count as recently added is not decided here: the device
counts today and the 30 calendar days before it, by local date (X-12), from the added times in the recipe list.

The 30-day retention period is a domain rule, so `removalDueAt` is computed here. Carrying out the removal is not: the
infrastructure removes the document and its photo once `removalDueAt` has passed (REC-16).

Every `Instant` passed to the domain is the server's current time, never a value from a request (X-12). In particular, a client
cannot restore an expired recipe by claiming an earlier time.

### Finding recipes

```ts
function findRecipes(recipes: readonly Recipe[], by: { name?: string; tags?: string[] }): Recipe[];  // REC-9, REC-13
function tagsInUse(recipes: readonly Recipe[]): { tag: Tag; count: number }[];                   // REC-13
function suggestTags(recipes: readonly Recipe[], forRecipe: Recipe | undefined, typed: string): Tag[];  // REC-12
function trashContents(recipes: readonly Recipe[]): Recipe[];                                     // REC-14
function toMakeList(recipes: readonly Recipe[]): Recipe[];                                        // PLAN-3
function shoppingList(recipes: readonly Recipe[]): { ingredient: TextEntry; recipe: Recipe }[];   // PLAN-8
```

- `findRecipes`, `tagsInUse`, `suggestTags` and `orderForRediscovery` (below) skip deleted recipes (REC-6).
- `trashContents` returns only deleted recipes, most recently deleted first (REC-14).
- `toMakeList` returns non-deleted recipes on the to-make list, oldest added first; ties sorted by name (PLAN-3).
- `shoppingList` returns every ingredient of every recipe in `toMakeList`, never combined, sorted by text ignoring case and
  accents (X-13); texts equal under X-13 (even if they differ in case or accents) by `RecipeName.compare`, then by recipe ID
  so the order is stable. Prep and steps are left out (PLAN-8).
- `findRecipes` keeps recipes whose name matches (`RecipeName.matches`) and that have every picked tag, sorted by
  `RecipeName.compare` (REC-8). No name and no tags returns every recipe.
- `tagsInUse` lists each tag on at least one recipe with its count, alphabetically. Tags on no recipe simply don't appear, so
  there is no tag list to keep in sync.
- `suggestTags` returns tags in use on other recipes that contain the typed text, ignoring case, alphabetically. Tags `forRecipe`
  already has are left out (REC-12). With `forRecipe` undefined (a recipe not yet created), only the typed text matters.

### Shopping list link

```ts
class ShoppingListLink {
  static create(token: ShareToken, items: readonly ShoppingItem[], at: Instant): Result<ShoppingListLink>;  // PLAN-9
  get token(): ShareToken;
  get createdAt(): Instant;
  get expiresAt(): Instant;            // createdAt + 7 days
  isAvailable(now: Instant): boolean;  // now < expiresAt
  toSnapshot(): ShoppingListLinkSnapshot;
  static fromSnapshot(s: ShoppingListLinkSnapshot): ShoppingListLink;
}
```

- A link is live: it holds no lines. Whoever opens it gets the current `shoppingList` (PLAN-8), built when the link is opened,
  so changes to the plan or its recipes show up, and nothing private is in it (X-1).
- `create` takes the shopping list at that moment only to refuse an empty one with `shoppingList.empty`: there is nothing to
  send. It keeps none of it.
- The 7 days are a domain rule (`LINK_DAYS`). `isAvailable` is true while `now` is before `expiresAt` and false at or
  after it; `now` is the server's clock (X-12). Example: made 2026-11-07 09:00, available at 2026-11-14 08:59, not at 09:00.
- The domain has no randomness: the token is made by the server from a secure random source and passed in, like `RecipeId`.
- `expiresAt` is derived from `createdAt`, never stored. Removing the link after it expires is the infrastructure's job
  (docs/architecture.md, "Sent shopping lists").

### Recipe import

```ts
class RecipeImport {
  static start(id: ImportId, at: Instant): RecipeImport;          // IMP-1; status "reading"
  get id(): ImportId;
  get startedAt(): Instant;
  statusAt(now: Instant): "reading" | "done" | "failed";          // "reading" past its deadline reads as "failed" (IMP-11)
  isInProgress(now: Instant): boolean;                            // IMP-5: statusAt(now) === "reading"
  succeed(recipe: Recipe, at: Instant): Result<void>;             // IMP-10; keeps the recipe's id and name
  fail(): void;                                                   // IMP-11
  get recipeId(): RecipeId | undefined;
  get recipeName(): RecipeName | undefined;
  toSnapshot(): RecipeImportSnapshot;
  static fromSnapshot(s: RecipeImportSnapshot): RecipeImport;
}

interface ReadRecipe {            // what was read from the photos, after the server has checked its shape
  name: string;
  ingredients: string[];
  prep: string[];
  steps: string[];
  totalTimeMinutes?: number;
  servings?: number;
  tags: string[];
}

function importedRecipe(id: RecipeId, read: ReadRecipe, tagsInUse: readonly Tag[], at: Instant): Result<Recipe>;  // IMP-7, IMP-8
```

- The 10 minutes are a domain rule (`IMPORT_MINUTES`), counted from `startedAt` by the server's clock (X-12). An import is in
  progress while its status is "reading" and `now` is before `startedAt` + 10 minutes. Example: started 09:00:00, in progress
  at 09:09:59, not at 09:10:00.
- `succeed` and `fail` apply only to an import in progress. `succeed` fails with `import.timedOut` if `at` is at or after the
  deadline, so a recipe read too late is not added. A finished import doesn't change again: `fail` on one does nothing, and
  `succeed` fails with `import.finished`.
- `importedRecipe` builds the recipe with `Recipe.create`, so every content rule applies (REC-1, REC-2, REC-11) and its errors
  come back unchanged (IMP-7). `at` is the server's time when the recipe is added to the collection (IMP-10), and becomes
  its added time (REC-22). Before that, it keeps only tags that are already in use: each read tag is read like tag input
  (REC-11), one not in `tagsInUse` or invalid is dropped, duplicates are dropped, and only the first 5 are kept, in the order
  read (IMP-8). Dropped tags are never an error.
- `ImportId` is a UUID made by the server, like `RecipeId`. The recipe's id is also made by the server, from the import's id,
  so the same import always makes the same recipe id.
- Each import is its own `RecipeImport`; any number can be in progress at once (IMP-3), so the domain has no rule across
  imports.
- The failure reason (IMP-11) is not stored; it is logged by the server. The page photos, the AI service and the dish picture
  are not in the domain.

### Rediscovery ordering

```ts
function orderForRediscovery(recipes: readonly Recipe[], by?: { tags?: string[] }): Recipe[];   // COOK-6, COOK-9
```

1. Never-cooked recipes first, sorted by `RecipeName.compare`.
2. Then by `lastCookedAt`, oldest first.
3. Ties (same last-cooked time) sorted by `RecipeName.compare`.

With `by.tags`, only recipes that have every picked tag are kept, in the same order (COOK-9). The rule is `findRecipes`'s
(REC-13), shared through `hasAllTags` in finding.ts: picked tags are read like tag input, and a picked text that isn't a valid
tag matches no recipe.

"3 months ago" text is presentation, calculated on the device (X-12), not in the domain.

## Snapshot (Cosmos document shape)

`toSnapshot()` produces a plain object that is stored directly as the Cosmos document. `fromSnapshot()` rebuilds a `Recipe` from
it.

```ts
interface RecipeSnapshot {
  id: string;
  name: string;
  ingredients: string[];
  prep?: string[];                // omitted when there is none; documents from before REC-20 have none
  steps: string[];
  totalTimeMinutes?: number;
  servings?: number;              // omitted when there is none; documents from before REC-24 have none
  tags: string[];                 // lowercase, unique, alphabetical
  photo?: { blobName: string; contentType: string };
  toMake?: { addedAt: string };   // ISO 8601 timestamp
  cookedAt: string[];             // ISO 8601 timestamps, newest first; duplicates allowed
  deletedAt?: string;             // ISO 8601 timestamp; present only while in the trash
  createdAt?: string;             // ISO 8601 timestamp, the added time (REC-22); documents from before REC-22 have none
  notes?: { id: string; text: string; addedAt: string }[];  // REC-25, newest first (listed oldest first); omitted when none
  schemaVersion: 1;
}
```

`fromSnapshot` re-validates through the same value objects and throws if the stored data is invalid. Bad data in the database is a
bug, not user input. `schemaVersion` lets future changes migrate old documents.

### Shopping list link snapshot

Stored as its own Cosmos document, in the `shopping-lists` container. PLAN-9: only the link's code and when it was made.

```ts
interface ShoppingListLinkSnapshot {
  id: string;                     // the token
  createdAt: string;              // ISO 8601 timestamp
}
```

`fromSnapshot` re-validates in the same way as for a recipe and throws on invalid data, including any other field, without the
token in the message. There is no `schemaVersion`: nothing else is to be stored, and a later change can tell old documents
by their fields.

### Recipe import snapshot

Stored as its own Cosmos document per import, in the `imports` container. Removing old ones is the infrastructure's job
(docs/architecture.md, "Recipe import").

```ts
interface RecipeImportSnapshot {
  id: string;                     // the import id
  startedAt: string;              // ISO 8601 timestamp
  status: "reading" | "done" | "failed";
  recipeId?: string;              // only when done
  recipeName?: string;            // only when done
}
```

`fromSnapshot` re-validates and throws on invalid data, as for a recipe. The stored status is "reading" until the import ends;
an expired one is read through `statusAt(now)`.

## Boundaries: what is NOT in the domain

| Concern                            | Where it lives                       | Why                                    |
| ---------------------------------- | ------------------------------------ | -------------------------------------- |
| HTTP request shape (Zod)           | `packages/shared`                    | Validates shape only, at the API edge. |
| Photo type and size limits (REC-7) | Server, upload handler               | Bytes never enter the domain.          |
| Image orientation (REC-7)          | Server, image processing             | Infrastructure concern.                |
| Sign-in, editor rule (X-6, X-7)    | Server, auth middleware              | Not a recipe rule.                     |
| Current time (X-12)                | Server clock, passed in as `Instant` | Never taken from a request.            |
| Local dates, "3 months ago" (X-12) | Client                               | Only the device knows its time zone.   |

## Known risk to watch

**Search semantics can diverge.** `RecipeName.matches` defines search (REC-9). If the server instead searches in Cosmos
(`CONTAINS(c.name, @term, true)`), the two may disagree on edge cases (Unicode case folding, accents). Either search in memory
using `matches`, which is fine for a personal collection, or add tests proving the Cosmos query agrees with `matches`.

## Package layout

```
packages/domain/
  src/
    result.ts
    errors.ts
    instant.ts
    recipe-name.ts
    text-entry.ts
    minutes.ts
    photo-ref.ts
    tag.ts
    recipe-content.ts
    note.ts           # NoteId, NoteText, Note (REC-25)
    recipe.ts
    finding.ts        # findRecipes, tagsInUse, suggestTags, trashContents
    rediscovery.ts
    shopping-list-link.ts  # ShareToken, ShoppingListLink (PLAN-9)
    recipe-import.ts  # ImportId, RecipeImport, importedRecipe (IMP)
    index.ts          # public exports only
  test/
    *.test.ts         # describe blocks named by spec ID, e.g. describe("COOK-5 ...")
```
