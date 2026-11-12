# Recipes (REC)

## Goal

Store recipes with a name, ingredients, steps, an optional photo and a few optional details, and find them quickly by name or by
tag.

## Recipe contents

| Field       | Required | Rules                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------- |
| Name        | Yes      | 1–200 characters after trimming whitespace                                 |
| Ingredients | Yes      | Ordered list of free-text entries, at least 1, each up to 1,000 characters |
| Prep        | No       | Ordered list of free-text entries, optional, each up to 1,000 characters   |
| Steps       | Yes      | Ordered list of free-text entries, at least 1, each up to 1,000 characters |
| Photo       | No       | One image (see REC-7)                                                      |
| Total time  | No       | Whole minutes, 1–1440, covering preparation and cooking                    |
| Servings    | No       | Whole number, 1–100: how many people the recipe serves (REC-24)            |
| Tags        | No       | Zero or more short labels (see REC-10 to REC-13)                           |

## Requirements

- **REC-1. Create.** A user can create a recipe. It is saved only if every field passes the rules above; otherwise nothing is
  saved and the user sees which fields are invalid and why.
- **REC-2. Entry cleanup.** Leading/trailing whitespace is trimmed from the name and from every ingredient, prep entry and step.
  Entries that are empty after trimming are discarded before the "at least 1" rule is checked.
- **REC-3. Order is preserved.** Ingredients, prep entries and steps are always displayed in the order the user entered them.
- **REC-4. View.** A user can open a recipe and see all of its contents. Prep entries and steps are numbered starting at 1.
  Opening a recipe that does not exist shows a "not found" message, not an error page. Visitors see the same page without
  editing controls or private information (X-1, X-8).
- **REC-5. Edit.** A user can change any field of an existing recipe, including adding and removing ingredients and steps. The
  same rules as REC-1 and REC-2 apply. Entries can't be reordered: steps are written in order, and the order of ingredients
  matters little.
- **REC-6. Delete to trash.** An editor can delete a recipe without being asked to confirm. The recipe moves to the trash (REC-14)
  and disappears at once from everywhere else: the list, the "Recently added" row (REC-22), search results, tag filters and
  counts, the "to make" list and the "haven't made in a while" view. Opening it shows "not found" (REC-4).
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
- **REC-10. Tags.** An editor can attach one or more tags to a recipe and remove any of them while creating or editing the recipe.
  In the form, tags are typed as one comma-separated list, such as "dinner, quick". The recipe view shows the tags but can't
  change them. Tags are free-form labels such as "dinner", "vegetarian" or "quick"; a new tag is
  created simply by typing it.
- **REC-11. Tag rules.**
  - A tag is trimmed and lowercased, then must be 1–30 characters (X-13).
  - A tag can't contain a comma. In the form a comma separates two tags, so "dinner, quick" becomes "dinner" and "quick". Empty
    items, as in "dinner,, quick", are ignored.
  - Tags are stored and shown in lowercase, so "Dinner" and "dinner" are the same tag.
  - A recipe never has the same tag twice; attaching a tag it already has changes nothing and shows no error, even when the recipe
    already has 20 tags.
  - A recipe has at most 20 tags.
  - A recipe's tags are shown in alphabetical order (X-13).
- **REC-12. Tag suggestions.** While typing a tag (the text after the last comma), the editor is offered tags already used on
  other recipes that contain the typed text, ignoring case and accents (X-13), so the collection doesn't drift into
  near-duplicates like "dessert" and "desserts". Tags the recipe already has are not offered. Before anything is typed, all tags
  in use on other recipes are offered, the way an empty search shows every recipe.
- **REC-13. Filter by tags.** On the recipe list, a user can pick one or more tags to filter by.
  - The user picks from every tag currently in use, shown by name only in alphabetical order (X-13), without the number of
    recipes that have it (owner decision, 2026-11-11).
  - With several tags picked, only recipes that have all of them are shown.
  - The tag filter and name search (REC-9) can be used together; a recipe must match both.
  - Results keep the REC-8 sort order. Clearing all picked tags shows the unfiltered list.
  - When tags are picked and no search term is typed, the list shows no summary of the results, unless nothing matches: then it
    says so ("No recipes tagged dinner and quick").
  - A tag that is removed from its last recipe no longer appears in the list of tags. There is no separate list of tags to manage.
  - Filtering by tags is public, like the recipes themselves (X-1).
- **REC-14. Trash.** An editor can open the trash to see deleted recipes, most recently deleted first, each showing its name,
  thumbnail, the date it was deleted and how many days remain before it is permanently removed. An empty trash shows a short
  message saying so. The trash is private, like the "to make" list (X-1).
- **REC-15. Restore.** An editor can restore a recipe from the trash at any time during its 30 days there. It returns with its
  content, photo, tags, cooking history and notes unchanged. It is not on the "to make" list, because deleting took it off
  (PLAN-6).
- **REC-16. Permanent removal.** Once a recipe has been in the trash for 30 days, it can no longer be restored, even if it hasn't
  been removed yet. It is permanently removed, together with its photo, cooking history and notes, within one day after that.
  The 30 days are measured by the server's clock, never by a time the app sends. Backups are not covered: copies of the recipe
  and its photo in backups can remain until those backups expire, at most 7 days later (docs/architecture.md, "Backups").
- **REC-17. Trashed recipes can't be changed.** Any change to a recipe in the trash, other than restoring it, is refused and
  nothing changes. The editor is told the recipe is in the trash. (This can happen when another device still shows the recipe
  after it was deleted.) The exception is deleting it again: that changes nothing and shows no error.
- **REC-18. Screen stays on.** While a recipe is open, the device's screen doesn't turn off on its own, on devices and browsers
  that allow it. It may turn off again once the recipe is closed.
- **REC-19. Tick off while cooking.** Anyone viewing a recipe can tick off ingredients, prep entries and steps as they go, and
  untick them.
  Ticks are never saved, on the device or the server; they are cleared when the person leaves the recipe.
- **REC-20. Prep.** A recipe can list prep: things to do before cooking, such as chopping vegetables. The recipe view shows them
  in a "Prep" section before the steps. A recipe with no prep entries shows no Prep section.
- **REC-21. One entry per line.** In the create and edit form, ingredients, prep and steps are each typed in one text box, one
  entry per line. One or more line breaks start the next entry, so blank lines are ignored. Numbering isn't needed; the text is
  kept as typed. Editing a recipe shows its entries one per line; a line break inside an entry saved earlier is shown as a space,
  so the entry stays one entry. How a recipe is viewed doesn't change.
- **REC-22. Recently added.** Above the recipe list (REC-8), a "Recently added" row shows the recipes added in the last 30
  days, newest first, at most 8. Each shows its photo thumbnail (or the placeholder), its name and the date it was added
  ("Added Nov 8"). Opening one opens the recipe (REC-4). A recipe in the row is also in the list below it.
  - A recipe's added time is when it was created (REC-1) or, for an imported recipe, when it was added to the collection
    (IMP-10), by the server's clock (X-12). It never changes: editing a recipe or its photo leaves it as it was, and a recipe
    restored from the trash (REC-15) keeps it.
  - Recipes added at the same time are ordered by name (X-13).
  - Recipes created before the added time was recorded have none. They never appear in the row.
  - Recipes in the trash don't appear (REC-6).
  - "The last 30 days" is calendar days on the device (X-12): today and the 30 days before it, by the date the recipe was added
    in the device's time zone. On Nov 8, a recipe added any time on Oct 9 is shown and one added on Oct 8 isn't.
  - When no recipe was added in the last 30 days, the row isn't shown.
  - While a search term is typed (REC-9) or tags are picked (REC-13), the row isn't shown; only the list is.
  - The row and the added dates are public, like the recipes themselves (X-1).
- **REC-23. Waking the server.** The server sleeps when nobody has used the app for a while, and the first request after that
  can take several seconds (docs/architecture.md, "Decisions": scale to zero). While the recipe list (REC-8) is loading, it
  says "Loading recipes…". If the list hasn't arrived after 5 seconds, the message becomes "Loading recipes… (waking up the
  server)", until the list arrives or loading fails. The 5 seconds are counted on the device (X-12) from when this load
  started; loading again with "Try again" starts the count again. Visitors and editors see the same message.
- **REC-24. Servings.** A recipe can say how many people it serves, as a whole number from 1 to 100, entered in the create and
  edit form and left empty if not known. The recipe view shows it next to the total time, as "Serves 4"; a recipe without it shows
  nothing there. The recipe list doesn't show it. Amounts are never scaled to a different number of servings (out of scope, see
  docs/specs/README.md). (Owner decision, 2026-11-11.)
- **REC-25. Notes.** An editor can add notes to a recipe, such as feedback after cooking it ("use more butter"), to fold into the
  recipe later. Notes are private: only editors see them (X-1). (Owner decisions, 2026-11-11.)
  - A note is free text of 1 to 1,000 characters after trimming whitespace, and may have several lines. A recipe has at most 50.
  - Each note records when it was added, by the server's clock (X-12). Who added it isn't recorded.
  - The recipe view lists the recipe's notes, newest first, each with its text and the date it was added in the device's time
    zone. A recipe without notes shows only the option to add one.
  - An editor can delete a note without being asked to confirm. Notes can't be edited: to change one, delete it and add another.
  - Notes stay with the recipe when it goes to the trash and when it is restored (REC-15), and are removed with it (REC-16).
    While it is in the trash they can't be added or deleted (REC-17).
  - The recipe list doesn't show notes, and search doesn't look in them. They are not part of the recipe's contents, so the
    create and edit form doesn't show them and editing the recipe leaves them unchanged.
- **REC-26. Time clock.** Wherever a recipe's total time is shown, a small clock face shows it as a picture. One full turn is
  one hour. The face fills clockwise from 12 o'clock, like a pie, by the share of the hour the time covers. Each hour after the
  first fills a further lap on top of the last one, in a darker shade of the app's accent color: the second lap darker than the
  first, the third darker still. From the fourth lap on, the darkest shade is used. A recipe without a total time shows no
  clock. (Owner decisions, 2026-11-11.)
  - Recipe view: the clock is next to the time, which keeps its current wording ("1 h 15 min").
  - Recipe list cards: the clock takes the place of the time text. The tags stay as they are.
  - Screen readers read the time in words, the same as the text ("1 h 15 min"), not the picture.

## Examples

| Situation                                                                    | Result                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Name `"  Pad Thai "`                                                         | Saved as `"Pad Thai"`                       |
| Ingredients `["2 eggs", "  ", ""]`                                           | Saved as `["2 eggs"]`                       |
| Ingredients `["   "]`                                                        | Rejected: at least 1 ingredient required    |
| Total time `0` or `2.5`                                                      | Rejected                                    |
| Steps typed as "Boil water", two blank lines, "Add pasta"                    | Saved as `["Boil water", "Add pasta"]`      |
| No prep entries                                                              | No Prep section on the recipe view          |
| Tags typed as `"Dinner, quick,, "`                                           | Tags "dinner" and "quick"                   |
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
| Today is Nov 8; A added Nov 8, B Nov 5, C Oct 1, D before added times        | Recently added: A, B                        |
| Today is Nov 8; A added Oct 9 at 11:30 pm, B Oct 8 at 9 am                   | Recently added: A                           |
| 10 recipes added this week                                                   | Recently added shows the newest 8           |
| "Pad Thai" added Oct 20, edited Nov 7                                        | Still "Added Oct 20", in the same place     |
| "Pad Thai" added Nov 1, deleted, restored Nov 6                              | Back in Recently added as "Added Nov 1"     |
| Search "chick" typed                                                         | No Recently added row                       |
| No recipe added in the last 30 days                                          | No Recently added row                       |
| The recipe list arrives after 3 seconds                                      | Only "Loading recipes…" was shown           |
| The recipe list arrives after 12 seconds                                     | "(waking up the server)" added at 5 seconds |
| Servings `0`, `2.5` or `101`                                                 | Rejected                                    |
| Servings left empty                                                          | Saved with no servings; nothing shown       |
| Servings `4`                                                                 | Recipe view shows "Serves 4"                |
| Note `"  use more butter "` added Nov 11                                     | Saved as "use more butter", dated Nov 11    |
| Note of only spaces, or of 1,001 characters                                  | Rejected                                    |
| Notes added Nov 2, then Nov 9                                                | Listed Nov 9, then Nov 2                    |
| A visitor opens a recipe that has notes                                      | No notes, and nothing saying there are any  |
| A 51st note added to a recipe                                                | Rejected                                    |
| "Pad Thai" with 2 notes deleted, then restored                               | Back with its 2 notes                       |
| Recipe edited to add an ingredient                                           | Its notes are unchanged                     |
| Total time 15 min                                                            | Clock a quarter filled, first shade         |
| Total time 1 h                                                               | Clock full, first shade                     |
| Total time 1 h 15 min                                                        | Full first shade; a quarter in the second   |
| Total time 2 h 30 min                                                        | Full second shade; half in the third        |
| Total time 6 h                                                               | Clock full, darkest shade                   |
| No total time                                                                | No clock                                    |

## Out of scope

- Typo-tolerant ("fuzzy") search, or searching ingredients or steps.
- Ratings and favorites.
- Renaming or merging a tag across all recipes in one step, tag colors, and tags within tags.
- Multiple photos per recipe.
- Structured ingredients (separate quantity / unit / name fields).
- Recipe version history.
- Permanently deleting a recipe before its 30 days in the trash are up ("Delete forever", "Empty trash").
- Changing the 30-day trash period. It is fixed.
