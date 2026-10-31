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
   status, cooking history) lives inside `Recipe`, so saving a recipe is a single atomic write.

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
| `TextEntry`  | One ingredient or step. Trimmed; 1–1,000 characters.                           | REC-1, REC-2               |
| `Minutes`    | Whole number, 1–1440.                                                          | REC-1                      |
| `PhotoRef`   | Blob name + content type. The domain never sees image bytes.                   | REC-7                      |
| `Tag`        | Trimmed and lowercased; 1–30 characters. Equal tags have equal text.           | REC-11                     |
| `Instant`    | A point in time (UTC). Passed in; the domain never reads the clock.            | X-12                       |

Notes:
- `RecipeName.compare(a, b)` sorts ignoring case and accents. `RecipeName.matches(term)` finds the trimmed term anywhere in the
  name, ignoring case and accents; an empty term matches everything.
- Character counts, sorting and matching all follow X-13: characters are counted as a person sees them (every emoji is one), and
  comparisons ignore case and accents using English rules. One shared helper implements this so every value object agrees:
  - All stored text (names, ingredients, steps, tags) is normalized to Unicode NFC, so text that looks the same is the same.
    Two "café" tags typed on different keyboards are one tag.
  - Search folds both the name and the term the same way sorting does: NFKD, accent marks removed, a small table for letters
    that don't decompose (ø→o, ł→l, đ→d, æ→ae, œ→oe, ß→ss), then lowercase. "smorrebrod" finds "Smørrebrød".
  - Tags that differ only in accents ("epice", "épicé") stay separate tags; only case is folded when a tag is stored.
- The domain has no calendar-date type. Everything it stores is an `Instant`; turning one into a local date or "3 months ago" is
  done on the device (X-12).

### RecipeContent

The user-editable part of a recipe, validated as a unit so all errors are collected together.

```ts
class RecipeContent {
  static create(input: RecipeContentInput): Result<RecipeContent>;
  // name, ingredients, steps, tags, totalTime?
}
```

Rules:
- Ingredient and step entries are trimmed and blank ones discarded before the "at least 1" check (REC-2).
- Order of ingredients and steps is preserved exactly (REC-3).
- Duplicate tags collapse into one; at most 20 tags (REC-11).

### Recipe (aggregate root)

```ts
class Recipe {
  static create(id: RecipeId, content: RecipeContentInput): Result<Recipe>;

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
  removeCookedEntry(at: Instant): Result<void>;                 // COOK-5
  get cookedAt(): readonly Instant[];  // newest first          // COOK-5
  get lastCookedAt(): Instant | undefined;                      // COOK-5, COOK-7
  get timesCooked(): number;                                    // COOK-5, COOK-7

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
| `removeCookedEntry`           | Removes one entry with exactly that time; none: does nothing. *(proposed)* | COOK-5         |
| `lastCookedAt`, `timesCooked` | Derived from `cookedAt`; never stored, so they cannot drift.               | COOK-7         |
| `setPhoto`, `removePhoto`     | Return the previous `PhotoRef` so its blob can be deleted.                 | REC-7          |
| `revise`                      | Replaces content, including tags. Never touches photo, plan or history.    | REC-5          |
| `attachTag`                   | Already attached: no-op, even at 20. Else fails if invalid or 20 attached. | REC-11         |
| `removeTag`                   | If the tag isn't attached, does nothing.                                   | REC-10         |
| `delete`                      | Clears to-make status. Already deleted: no-op.                             | REC-6, PLAN-6  |
| All changes except `restore`  | Fail with `recipe.inTrash` on a deleted recipe; nothing changes.           | REC-17         |
| `restore`                     | Fails with `trash.expired` if `at` is at or after `removalDueAt`.          | REC-16         |
| `restore`                     | Not deleted: does nothing.                                                 | REC-15         |

Deleting a recipe (REC-6) moves it to the trash by marking it deleted and recording when. It also takes the recipe off the to-make
list (PLAN-6); nothing else inside it is cleared. `restore` clears the deleted mark, and the content, photo, tags and history are
all still there (REC-15). Because the to-make status and history live inside the document, no other data can be left pointing at a
deleted recipe.

The 30-day retention period is a domain rule, so `removalDueAt` is computed here. Carrying out the removal is not: the
infrastructure removes the document and its photo once `removalDueAt` has passed (REC-16).

Every `Instant` passed to the domain is the server's current time, never a value from a request (X-12). In particular, a client
cannot restore an expired recipe by claiming an earlier time.

### Finding recipes

```ts
function findRecipes(recipes: readonly Recipe[], by: { name?: string; tags?: string[] }): Recipe[];  // REC-9, REC-13
function tagsInUse(recipes: readonly Recipe[]): { tag: Tag; count: number }[];                   // REC-13
function suggestTags(recipes: readonly Recipe[], forRecipe: Recipe, typed: string): Tag[];       // REC-12
function trashContents(recipes: readonly Recipe[]): Recipe[];                                     // REC-14
```

- `findRecipes`, `tagsInUse`, `suggestTags` and `orderForRediscovery` (below) skip deleted recipes (REC-6).
- `trashContents` returns only deleted recipes, most recently deleted first (REC-14).
- `findRecipes` keeps recipes whose name matches (`RecipeName.matches`) and that have every picked tag, sorted by
  `RecipeName.compare` (REC-8). No name and no tags returns every recipe.
- `tagsInUse` lists each tag on at least one recipe with its count, alphabetically. Tags on no recipe simply don't appear, so
  there is no tag list to keep in sync.
- `suggestTags` returns tags in use on other recipes that contain the typed text, ignoring case, alphabetically. Tags `forRecipe`
  already has are left out (REC-12).

### Rediscovery ordering

```ts
function orderForRediscovery(recipes: readonly Recipe[]): Recipe[];   // COOK-6
```

1. Never-cooked recipes first, sorted by `RecipeName.compare`.
2. Then by `lastCookedAt`, oldest first.
3. Ties (same last-cooked time) sorted by `RecipeName.compare`. *(proposed — the spec doesn't define ties)*

"3 months ago" text is presentation, calculated on the device (X-12), not in the domain.

## Snapshot (Cosmos document shape)

`toSnapshot()` produces a plain object that is stored directly as the Cosmos document. `fromSnapshot()` rebuilds a `Recipe` from
it.

```ts
interface RecipeSnapshot {
  id: string;
  name: string;
  ingredients: string[];
  steps: string[];
  totalTimeMinutes?: number;
  tags: string[];                 // lowercase, unique, alphabetical
  photo?: { blobName: string; contentType: string };
  toMake?: { addedAt: string };   // ISO 8601 timestamp
  cookedAt: string[];             // ISO 8601 timestamps, newest first; duplicates allowed
  deletedAt?: string;             // ISO 8601 timestamp; present only while in the trash
  schemaVersion: 1;
}
```

`fromSnapshot` re-validates through the same value objects and throws if the stored data is invalid. Bad data in the database is a
bug, not user input. `schemaVersion` lets future changes migrate old documents.

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
    recipe.ts
    finding.ts        # findRecipes, tagsInUse, suggestTags, trashContents
    rediscovery.ts
    index.ts          # public exports only
  test/
    *.test.ts         # describe blocks named by spec ID, e.g. describe("COOK-5 ...")
```
