# Recipes (REC)

## Goal

Store recipes with a name, ingredients, steps, an optional photo and a few optional details, and find them quickly by name or by
tag.

## Recipe contents

| Field       | Required | Rules                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------- |
| Name        | Yes      | 1–200 characters after trimming whitespace                                 |
| Ingredients | Yes      | Ordered list of free-text entries, at least 1, each up to 1,000 characters |
| Steps       | Yes      | Ordered list of free-text entries, at least 1, each up to 1,000 characters |
| Photo       | No       | One image (see REC-7)                                                      |
| Total time  | No       | Whole minutes, 1–1440, covering preparation and cooking                    |
| Tags        | No       | Zero or more short labels (see REC-10 to REC-13)                           |

## Requirements

- **REC-1. Create.** A user can create a recipe. It is saved only if every field passes the rules above; otherwise nothing is
  saved and the user sees which fields are invalid and why.
- **REC-2. Entry cleanup.** Leading/trailing whitespace is trimmed from the name and from every ingredient and step. Ingredient
  and step entries that are empty after trimming are discarded before the "at least 1" rule is checked.
- **REC-3. Order is preserved.** Ingredients and steps are always displayed in the order the user entered them.
- **REC-4. View.** A user can open a recipe and see all of its contents. Steps are numbered starting at 1. Opening a recipe that
  does not exist shows a "not found" message, not an error page. Visitors see the same page without editing controls or private
  information (X-1, X-8).
- **REC-5. Edit.** A user can change any field of an existing recipe, including adding and removing ingredients and steps. The
  same rules as REC-1 and REC-2 apply. Entries can't be reordered: steps are written in order, and the order of ingredients
  matters little.
- **REC-6. Delete to trash.** An editor can delete a recipe without being asked to confirm. The recipe moves to the trash (REC-14)
  and disappears at once from everywhere else: the list, search results, tag filters and counts, the "to make" list and the
  "haven't made in a while" view. Opening it shows "not found" (REC-4).
  - Right after deleting, a "‹name› moved to trash" message with an Undo option is shown for at least 10 seconds. Deleting
    another recipe meanwhile replaces the message; the first can still be restored from the trash. Undo restores the
    recipe exactly as restoring from the trash does (REC-15).
- **REC-7. Photo.** A user can add, replace or remove a recipe's photo.
  - Accepted: JPEG, PNG and WebP, up to 15 MB. HEIC is not accepted: an iPhone converts a photo picked from its library to JPEG
    when the upload asks only for these types. A HEIC file chosen another way (such as from Files, or copied to a computer) is
    rejected with a message saying to choose a JPEG.
  - Anything else is rejected with a message; the recipe is unchanged.
  - Replacing or removing a photo deletes the previous image from storage.
  - Photos display correctly oriented (respect camera rotation metadata).
- **REC-8. List.** A user can see all recipes, sorted by name, ignoring case and accents (X-13), each showing its name and a photo
  thumbnail (or a placeholder when there is no photo).
- **REC-9. Search by name.** A user can type a search term to filter the list.
  - Matching ignores case and accents (X-13) and finds the term anywhere in the name.
  - Leading/trailing whitespace in the term is ignored.
  - An empty term shows all recipes.
  - Results keep the REC-8 sort order.
  - When nothing matches, the user sees "No recipes match" with the term.
- **REC-10. Tags.** An editor can attach one or more tags to a recipe and remove any of them, both while creating or editing the
  recipe and directly from the recipe view. Tags are free-form labels such as "dinner", "vegetarian" or "quick"; a new tag is
  created simply by typing it.
- **REC-11. Tag rules.**
  - A tag is trimmed and lowercased, then must be 1–30 characters (X-13).
  - A tag can't contain a comma, so "dinner, quick" typed as one tag is refused with a message rather than becoming one odd tag.
  - Tags are stored and shown in lowercase, so "Dinner" and "dinner" are the same tag.
  - A recipe never has the same tag twice; attaching a tag it already has changes nothing and shows no error, even when the recipe
    already has 20 tags.
  - A recipe has at most 20 tags.
  - A recipe's tags are shown in alphabetical order (X-13).
- **REC-12. Tag suggestions.** While typing a tag, the editor is offered tags already used on other recipes that contain the typed
  text, ignoring case and accents (X-13), so the collection doesn't drift into near-duplicates like "dessert" and "desserts". Tags
  the recipe already has are not offered. Before anything is typed, all tags in use on other recipes are offered, the way an empty
  search shows every recipe.
- **REC-13. Filter by tags.** On the recipe list, a user can pick one or more tags to filter by.
  - The user picks from every tag currently in use, shown in alphabetical order (X-13) with the number of recipes that have each
    one.
  - With several tags picked, only recipes that have all of them are shown.
  - The tag filter and name search (REC-9) can be used together; a recipe must match both.
  - Results keep the REC-8 sort order. Clearing all picked tags shows the unfiltered list.
  - A tag that is removed from its last recipe no longer appears in the list of tags. There is no separate list of tags to manage.
  - Filtering by tags is public, like the recipes themselves (X-1).
- **REC-14. Trash.** An editor can open the trash to see deleted recipes, most recently deleted first, each showing its name,
  thumbnail, the date it was deleted and how many days remain before it is permanently removed. An empty trash shows a short
  message saying so. The trash is private, like the "to make" list (X-1).
- **REC-15. Restore.** An editor can restore a recipe from the trash at any time during its 30 days there. It returns with its
  content, photo, tags and cooking history unchanged. It is not on the "to make" list, because deleting took it off (PLAN-6).
- **REC-16. Permanent removal.** Once a recipe has been in the trash for 30 days, it can no longer be restored, even if it hasn't
  been removed yet. It is permanently removed, together with its photo and cooking history, within one day after that. The 30 days
  are measured by the server's clock, never by a time the app sends.
- **REC-17. Trashed recipes can't be changed.** Any change to a recipe in the trash, other than restoring it, is refused and
  nothing changes. The editor is told the recipe is in the trash. (This can happen when another device still shows the recipe
  after it was deleted.) The exception is deleting it again: that changes nothing and shows no error.
- **REC-18. Screen stays on.** While a recipe is open, the device's screen doesn't turn off on its own, on devices and browsers
  that allow it. It may turn off again once the recipe is closed.
- **REC-19. Tick off while cooking.** Anyone viewing a recipe can tick off ingredients and steps as they go, and untick them.
  Ticks are never saved, on the device or the server; they are cleared when the person leaves the recipe.

## Examples

| Situation                                                                    | Result                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Name `"  Pad Thai "`                                                         | Saved as `"Pad Thai"`                       |
| Ingredients `["2 eggs", "  ", ""]`                                           | Saved as `["2 eggs"]`                       |
| Ingredients `["   "]`                                                        | Rejected: at least 1 ingredient required    |
| Total time `0` or `2.5`                                                      | Rejected                                    |
| Search `"chick"` with recipes "Chicken Tikka", "Chickpea Curry", "Beef Stew" | Chicken Tikka, Chickpea Curry               |
| Search `"TIKKA "`                                                            | Chicken Tikka                               |
| Search `"creme"` with a recipe "Crème Brûlée"                                | Crème Brûlée                                |
| Recipes "Zucchini Bread", "Éclair", "apple pie"                              | Listed as apple pie, Éclair, Zucchini Bread |
| Tags "zucchini", "épicé", "apple" on one recipe                              | Shown as apple, épicé, zucchini             |
| An ingredient of 1,001 characters                                            | Rejected                                    |
| Delete "Pad Thai" (on the to-make list), then restore it                     | Restored, but not on the "to make" list     |
| Recipe deleted 2026-10-01; today is 2026-10-21                               | Trash shows 10 days left                    |
| Upload a 20 MB JPEG                                                          | Rejected: too large; existing photo kept    |
| Attach tag `" Quick "` to a recipe tagged "quick"                            | No change; one tag "quick"                  |
| Recipes: A [dinner, quick], B [dinner], C [quick]; filter dinner + quick     | A                                           |
| Same recipes; filter "dinner" and search "b"                                 | B                                           |
| Remove "quick" from A and C                                                  | "quick" no longer offered as a filter       |
| Attach "quick" to a recipe that has 20 tags including "quick"                | No change, no error                         |
| Restore a recipe deleted 30 days and 2 hours ago, not yet removed            | Refused: can no longer be restored          |

## Out of scope

- Typo-tolerant ("fuzzy") search, or searching ingredients or steps.
- Ratings and favorites.
- Renaming or merging a tag across all recipes in one step, tag colors, and tags within tags.
- Multiple photos per recipe.
- Structured ingredients (separate quantity / unit / name fields).
- Recipe version history.
- Permanently deleting a recipe before its 30 days in the trash are up ("Delete forever", "Empty trash").
- Changing the 30-day trash period. It is fixed.
