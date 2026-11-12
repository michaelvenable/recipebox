# Cooking history (COOK)

## Goal

Record when recipes were actually made, so the household can see how recently and how often each one was cooked, and rediscover
ones that haven't been made in a while. Cooking history is private: only signed-in editors can see or change it (X-1, X-6).

## Requirements

- **COOK-1. Mark as cooked.** From a recipe, an editor can tap "I cooked this today" to record a cooking. The time recorded is the
  server's current time (X-12); it can't be changed. Editors are expected to mark a recipe when they cook it.
- **COOK-2.** (withdrawn) "Today" no longer comes from the device; cooking times come from the server (X-12).
- **COOK-3.** (withdrawn) Future dates can't occur, because the server records the time.
- **COOK-4.** (withdrawn) Duplicate entries are allowed. Marking a recipe cooked twice records two entries.
- **COOK-5. History on the recipe.** A recipe shows the date it was last cooked ("Never cooked" if none). Every cooking is still
  recorded (COOK-1), but the app shows neither how many times a recipe has been cooked nor the list of entries (owner decision,
  2026-11-11). Entries can't be deleted or changed.
- **COOK-6. "Haven't made in a while" view.** In the app, this view is called "Recommendations". An editor can see all recipes
  ordered by when they were last cooked, least recent first, each showing the last-cooked date and how long ago that was ("3
  months ago"). Recipes never cooked appear before all others, sorted by name.
- **COOK-7.** (withdrawn) History entries can't be deleted (COOK-5), so there is nothing to update.
- **COOK-8. Cooked-today button.** If a recipe was last cooked earlier on the device's current day, its "I cooked this today"
  button reads "Cooked today ✓" and can't be tapped again until the next day. This prevents most accidental duplicates; the server
  still accepts them (COOK-4).
- **COOK-9. Filter recommendations by tags.** On the "haven't made in a while" view (COOK-6), an editor can pick one or more
  tags to filter by, such as "breakfast", to look only at those recipes.
  - The tags offered and their order are the same as on the recipe list (REC-13): every tag in use, by name only, in
    alphabetical order (X-13).
  - With several tags picked, only recipes that have all of them are shown, still in the COOK-6 order. Clearing all picked tags
    shows every recipe again.
  - When no recipe has all the picked tags, the view says so ("No recipes tagged breakfast and quick").
  - The filter on this view is separate from the one on the recipe list: picking a tag on one doesn't pick it on the other.

## Examples

| Situation                                                    | Result                                          |
| ------------------------------------------------------------ | ----------------------------------------------- |
| Mark cooked at 6 pm                                          | Button reads "Cooked today ✓" until midnight    |
| Two devices each mark the recipe cooked, one after the other | Two entries                                     |
| Recipes: A (never), B (last 2026-01-10), C (last 2026-08-02) | View order: A, B, C                             |
| Same recipes; only A and C tagged "breakfast"; filter it     | View order: A, C                                |

## Out of scope

- Recording a cooking for an earlier date (backdating), or changing or deleting an entry.
- Recording who cooked, ratings, or notes per cooking. (Notes on a recipe, not tied to a cooking, are REC-25.)
- Statistics or charts beyond last-cooked date and count.
