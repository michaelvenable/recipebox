# API

The HTTP API served at `https://api.recipes.mikevenable.net`. Behavior is defined in `docs/specs/`; this document only maps it to
endpoints. Request and response shapes are Zod schemas in `packages/shared`, named below in `code`.

Status: drafted by Claude from the specs and architecture, awaiting the owner's review. *(proposed)*

## Conventions

- JSON in and out. Every change is `POST`, `PUT` or `DELETE` with `Content-Type: application/json` (an empty `{}` body when there
  is nothing to send); anything else is refused with 415. `GET` never changes anything. (CSRF, docs/architecture.md)
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
- `GET /recipes/{id}/photo` and `GET /recipes/{id}/thumbnail` — the images (REC-7). 404 if there is no photo or the recipe is in
  the trash.
- `GET /me` — the Account page (X-11). Returns `Me`: whether signed in, provider, account ID, and whether an editor.

## Editor endpoints

Recipes:
- `POST /recipes` — create (REC-1). Body `RecipeContentInput`. Returns 201 with `EditorRecipe`.
- `PUT /recipes/{id}/content` — edit (REC-5). Body `RecipeContentInput`. Returns `EditorRecipe`.
- `PUT /recipes/{id}/photo` — add or replace the photo (REC-7). Body: the image (`multipart/form-data`, the one exception to the
  JSON rule, still refused from other origins by CORS). Returns `EditorRecipe`.
- `DELETE /recipes/{id}/photo` — remove the photo (REC-7). Returns `EditorRecipe`.
- `DELETE /recipes/{id}` — move to the trash (REC-6). Returns 204.

Tags:
- `POST /recipes/{id}/tags` — attach a tag (REC-10, REC-11). Body `TagRequest`. Returns `EditorRecipe`.
- `DELETE /recipes/{id}/tags` — remove a tag (REC-10). Body `TagRequest`. Returns `EditorRecipe`.
- The tag travels in the body, not the address, because browsers rewrite tags such as "." or ".." in an address.
- `GET /tag-suggestions?typed=&recipeId=` — suggestions while typing (REC-12). `recipeId` is omitted for a new recipe. Returns
  `Tag[]`.

"To make" list:
- `GET /to-make` — the list (PLAN-3). Returns `ToMakeEntry[]`.
- `PUT /recipes/{id}/to-make` — add (PLAN-1, PLAN-2). Returns `EditorRecipe`.
- `DELETE /recipes/{id}/to-make` — remove (PLAN-4). Returns `EditorRecipe`.

Cooking history:
- `POST /recipes/{id}/cookings` — "I cooked this today" (COOK-1, PLAN-5). The server records its own time. Returns `EditorRecipe`.
- `DELETE /recipes/{id}/cookings/{at}` — delete one entry (COOK-5); `at` is the entry's stored time, URL-encoded. Returns
  `EditorRecipe`. An `at` that isn't in the stored form gets 404 `cooking.notFound`; a well-formed time with no matching entry
  changes nothing.
- `GET /rediscover` — "Haven't made in a while" (COOK-6). Returns `RediscoverEntry[]`.

Trash:
- `GET /trash` — the trash (REC-14). Returns `TrashEntry[]`, each with `deletedAt` and `removalDueAt`.
- `POST /trash/{id}/restore` — restore (REC-15, REC-16). Returns `EditorRecipe`; 409 with `trash.expired` after 30 days. Restoring
  a recipe that isn't in the trash changes nothing and returns it.

## Shapes

- `RecipeContentInput`: `name`, `ingredients[]`, `steps[]`, `totalTimeMinutes?`, `tags[]?`.
- `RecipeSummary`: `id`, `name`, `tags[]`, `totalTimeMinutes?`, `hasPhoto`.
- `EditorRecipeSummary`: `RecipeSummary` plus `onToMakeList`.
- `PublicRecipe`: `id`, `name`, `ingredients[]`, `steps[]`, `totalTimeMinutes?`, `tags[]`, `hasPhoto`.
- `EditorRecipe`: `PublicRecipe` plus `toMake?` (`addedAt`), `cookedAt[]` (newest first), `lastCookedAt?`, `timesCooked`.
- `TagCount`: `tag`, `count`. `Tag`: a string.
- `TagRequest`: `{ tag }`, the tag text as typed.
- `ToMakeEntry`: `RecipeSummary` plus `addedAt`.
- `RediscoverEntry`: `RecipeSummary` plus `lastCookedAt?`.
- `TrashEntry`: `RecipeSummary` plus `deletedAt`, `removalDueAt`.
- `Me`: `signedIn`, `provider?` (`aad` or `google`), `accountId?`, `isEditor`.
- `ErrorResponse`: `errors[]` of `{ code, field?, message }`.
- `EmptyRequest`: `{}`, the body of a change that needs no input (delete, restore, add to the list, mark cooked).

Public shapes never include `toMake`, `cookedAt`, `lastCookedAt`, `timesCooked`, `deletedAt` or `onToMakeList` (X-1). Tests check
this for every public endpoint.
