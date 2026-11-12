# API

The HTTP API served at `https://api.recipes.mikevenable.net`. Behavior is defined in `docs/specs/`; this document only maps it to
endpoints. Request and response shapes are Zod schemas in `packages/shared`, named below in `code`.

## Conventions

- JSON in and out. Every change is `POST`, `PUT` or `DELETE` with `Content-Type: application/json` (an empty `{}` body when there
  is nothing to send); anything else is refused with 415. `GET` never changes anything. (CSRF, docs/architecture.md)
- Uploads are the exception: `PUT /recipes/{id}/photo` and `POST /imports` send `multipart/form-data`, and must also carry the
  header `X-Requested-By: recipebox`. Without it they get 403 `request.headerMissing`, before the body is read.
- Times are ISO 8601 strings in UTC as written by the server, e.g. `2026-10-30T22:15:03.120Z` (X-12). Requests never carry a time.
- Recipe ids are lowercase UUIDs. A malformed id is treated as not found.
- Every shape is strict: a request or response with a field the shape doesn't list is rejected (400 for requests), so a misspelled
  field fails visibly and a private field can't slip into a public response.
- Callers are visitors, signed-in non-editors (treated as visitors), or editors (X-6, X-7).

Errors:

| Status | When                                                   | Body                         |
| ------ | ------------------------------------------------------ | ---------------------------- |
| 400    | Request fails validation or a domain rule (e.g. REC-1) | `ErrorResponse` (all errors) |
| 401    | Editor endpoint called without signing in              | `ErrorResponse`              |
| 403    | Editor endpoint called by a signed-in non-editor       | `ErrorResponse`              |
| 403    | An upload sent without `X-Requested-By`                | `ErrorResponse`              |
| 404    | Recipe doesn't exist, or is in the trash (see below)   | `ErrorResponse`              |
| 409    | Change refused by the recipe's state (see below)       | `ErrorResponse`              |
| 415    | A change sent without a JSON body                      | `ErrorResponse`              |

Recipes in the trash: reading one gets 404, the same as an unknown id. Visitors and non-editors who try to change one get 401 or
403 before the recipe is looked up, so they can't tell it apart from an unknown id either. An editor who tries to change one gets
409 `recipe.inTrash`, so the app can say it is in the trash (REC-17). Restoring after 30 days gets 409 `trash.expired` (REC-16).

`ErrorResponse` is `{ errors: ErrorItem[] }`; each `ErrorItem` is a domain error's `code`, `field` and `message`.

## Public endpoints (anyone)

Visitors get the public shapes. Editors calling the same endpoints get the editor shapes, which add private fields (X-1).

- `GET /recipes?name=&tags=` — the recipe list with search and tag filter (REC-8, REC-9, REC-13). `tags` is comma-separated.
  Returns `RecipeSummary[]` (visitor) or `EditorRecipeSummary[]` (editor, adds `onToMakeList`).
- `GET /tags` — tags in use with counts (REC-13). Returns `TagCount[]`.
- `GET /recipes/{id}` — one recipe (REC-4). Returns `PublicRecipe` or `EditorRecipe` (adds to-make status and cooking history).
  404 if it is in the trash.
- `GET /recipes/{id}/photo` and `GET /recipes/{id}/thumbnail` — the images (REC-7). 404 if there is no photo. If the recipe is in
  the trash: 404 for visitors and non-editors, but editors get the images, so the trash can show thumbnails (REC-14, X-1).
- `GET /me` — the Account page (X-11). Returns `Me`: whether signed in, provider, account ID, and whether an editor.
- `GET /signed-in?to={path}` — where sign-in returns to before going back to the app (X-8; docs/architecture.md, "Sign-in").
  Answers 302 to the client's origin plus `to`. A `to` that isn't a path in the app (missing, not starting with a single `/`,
  or naming another site once parsed) goes to the client's home page instead, so the route can't send anyone to another site.
  Changes nothing.
- `GET /shopping-lists/{token}` — a shopping list link (PLAN-9), for anyone with the link and the same for everyone. Returns
  `SharedShoppingList`: the current shopping list, built on every request with `shoppingList` from the stored recipes, as for
  `GET /plan/shopping-list`. While the link works (`isAvailable` by the server's clock, X-12): 200, with `items` empty when the
  plan is. An expired, unknown or malformed token all get the same 404 `sharedList.notFound`, so trying codes reveals nothing.
  Sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; the request log shows the path as
  `/shopping-lists/[redacted]`, since the code is the key.

## Editor endpoints

Recipes:
- `POST /recipes` — create (REC-1). Body `RecipeContentInput`. Returns 201 with `EditorRecipe`.
- `PUT /recipes/{id}/content` — edit (REC-5). Body `RecipeContentInput`. Returns `EditorRecipe`.
- `PUT /recipes/{id}/photo` — add or replace the photo (REC-7). Body: the image (`multipart/form-data` with `X-Requested-By`, an
  upload; see Conventions). Returns `EditorRecipe`. Exactly one file part, under any field name. JPEG,
  PNG or WebP up to 15 MB, detected from the file's bytes. Errors (400): `photo.required`, `photo.tooLarge`,
  `photo.unsupportedType`, `photo.unreadable`. 503 `photo.busy` when too many uploads are waiting to be processed; try again.
  Location and other metadata are removed before storing.
- `DELETE /recipes/{id}/photo` — remove the photo (REC-7). Returns `EditorRecipe`.
- `DELETE /recipes/{id}` — move to the trash (REC-6). Returns 204.

Tags:
- `POST /recipes/{id}/tags` — attach a tag (REC-10, REC-11). Body `TagRequest`. Returns `EditorRecipe`.
- `DELETE /recipes/{id}/tags` — remove a tag (REC-10). Body `TagRequest`. Returns `EditorRecipe`.
- The tag travels in the body, not the address, because browsers rewrite tags such as "." or ".." in an address.
- `GET /tag-suggestions?typed=&recipeId=` — suggestions while typing (REC-12). `recipeId` is omitted for a new recipe. Returns
  `Tag[]`.

"To make" list:
- `GET /plan` — the list (PLAN-3). Returns `ToMakeEntry[]`.
- `POST /recipes/{id}/add-to-plan` — add (PLAN-1, PLAN-2). Returns `EditorRecipe`.
- `POST /recipes/{id}/remove-from-plan` — remove (PLAN-4). Returns `EditorRecipe`.
- `GET /plan/shopping-list` — the shopping list (PLAN-8): every ingredient of every recipe on the list, sorted by the domain
  (`shoppingList`). Read-only; ticks are the client's and never sent. Returns `ShoppingItem[]`.
- `POST /plan/shopping-list/shares` — send the shopping list as a link (PLAN-9). Body `EmptyRequest`: the server picks a random
  code (128 bits, base64url) and takes the time from its clock (X-12), and stores only those; nothing of the list and nothing
  sent by the client is stored. Returns 201 with `ShoppingListLink`. 409 `shoppingList.empty` when the plan is empty at that
  moment. Each call makes a new link; every link shows the same current list until its own 7 days are up.

Cooking history:
- `POST /recipes/{id}/cookings` — "I cooked this today" (COOK-1, PLAN-5). The server records its own time. Returns `EditorRecipe`.
- `GET /recommendations?tags=` — "Haven't made in a while" (COOK-6), filtered by tags (COOK-9). `tags` is read as on
  `GET /recipes`: comma-separated, only recipes with every one, still in the COOK-6 order. Returns `RediscoverEntry[]`.

Import from a photo:
- `POST /imports` — start an import of one recipe from 1 to 4 photos (IMP-1 to IMP-4). Body: the photos as
  `multipart/form-data` with `X-Requested-By`, one file part per photo, in the order added; field names don't matter. Before
  the files, an optional text part named `rotations` gives how far to turn each photo clockwise (IMP-1), as JSON: one of 0, 90,
  180 or 270 per photo, in the same order, such as `[0,180]`. Without it, no photo is turned. A `rotations` part that isn't
  such a list, or whose length doesn't match the number of photos: 400 `photo.rotations`. Any other part is refused. Each
  photo gets the same checks and `photo.*` errors as `PUT /recipes/{id}/photo` (IMP-2), with `field` `photos[i]` (from 0)
  naming the photo. No file part: 400 `photo.required`. More than 4: 400 `photo.tooMany`, before any photo is processed. The
  server makes the import ID and takes the start time from its clock (X-12), stores the photos turned as asked and without
  their metadata, and queues the import.
  Returns 202 with `ImportStatus` (`status` `reading`). Other imports in progress don't matter (IMP-3). If the import can't be
  queued, nothing is left in progress and the answer is 500 (docs/architecture.md, "Recipe import").
- `GET /imports` — the imports of the last day, newest first (IMP-5, IMP-10). Returns `ImportStatus[]`, empty when there are
  none. An import still `reading` after its 10 minutes is reported as `failed` (IMP-11). Read by the Catalog every few seconds
  while an import is in progress.

Trash:
- `GET /trash` — the trash (REC-14). Returns `TrashEntry[]`, each with `deletedAt` and `removalDueAt`.
- `POST /trash/{id}/restore` — restore (REC-15, REC-16). Returns `EditorRecipe`; 409 with `trash.expired` after 30 days. Restoring
  a recipe that isn't in the trash changes nothing and returns it.

## Shapes

- `RecipeContentInput`: `name`, `ingredients[]`, `prep[]?`, `steps[]`, `totalTimeMinutes?`, `servings?`, `tags[]?`. A missing
  `prep` means none (REC-20), so clients from before prep keep working; a missing `servings` means none (REC-24).
- `RecipeSummary`: `id`, `name`, `tags[]`, `totalTimeMinutes?`, `hasPhoto`, `createdAt?`. `createdAt` is when the recipe was added
  (REC-22), public like the recipe (X-1); recipes stored before it was recorded have none. The client picks the "Recently
  added" row from the unfiltered list (X-12). Not `addedAt`, which `ToMakeEntry` uses for the to-make list.
- `EditorRecipeSummary`: `RecipeSummary` plus `onToMakeList`.
- `PublicRecipe`: `id`, `name`, `ingredients[]`, `prep[]?`, `steps[]`, `totalTimeMinutes?`, `servings?`, `tags[]`, `hasPhoto`.
  `prep` and `servings` are left out when the recipe has none (REC-20, REC-24), so older clients, which refuse unknown fields,
  can still read the recipe.
- `EditorRecipe`: `PublicRecipe` plus `toMake?` (`addedAt`), `cookedAt[]` (newest first), `lastCookedAt?`, `timesCooked`.
- `TagCount`: `tag`, `count`. `Tag`: a string.
- `ShoppingItem`: `text` (the ingredient as entered), `recipeId`, `recipeName`.
- `ShoppingListLink`: `token`, `path` (`/list/{token}`, the client's page for it), `expiresAt`.
- `SharedShoppingList`: `items[]` (`ShoppingItem`, the current list), `expiresAt`. No to-make dates, creation time or token.
- `TagRequest`: `{ tag }`, the tag text as typed.
- `ToMakeEntry`: `RecipeSummary` plus `addedAt`.
- `RediscoverEntry`: `RecipeSummary` plus `lastCookedAt?`.
- `TrashEntry`: `RecipeSummary` plus `deletedAt`, `removalDueAt`.
- `ImportStatus`: `importId`, `status` (`reading`, `done` or `failed`), and when `done`, `recipeId` and `recipeName`. No start
  time, failure reason or photo; the reason is only in the server log (IMP-11).
- `Me`: `signedIn`, `provider?` (`aad` or `google`), `accountId?`, `isEditor`.
- `ErrorResponse`: `errors[]` of `{ code, field?, message }`.
- `EmptyRequest`: `{}`, the body of a change that needs no input (delete, restore, add to the list, mark cooked).

Public shapes never include `toMake`, `cookedAt`, `lastCookedAt`, `timesCooked`, `deletedAt` or `onToMakeList` (X-1). Tests check
this for every public endpoint. The only time in a public recipe shape is a listed recipe's `createdAt` (REC-22).
