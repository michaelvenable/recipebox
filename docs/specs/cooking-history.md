# Cooking history (COOK)

## Goal

Record when recipes were actually made, so the household can see how recently and how often each one was cooked, and rediscover
ones that haven't been made in a while. Cooking history is private: only signed-in editors can see or change it (X-1, X-6).

## Requirements

- **COOK-1. Mark as cooked.** From a recipe, an editor can record "we made this". The time recorded is the server's current time
  (X-12); it can't be changed. Editors are expected to mark a recipe when they cook it.
- **COOK-2.** (withdrawn) "Today" no longer comes from the device; cooking times come from the server (X-12).
- **COOK-3.** (withdrawn) Future dates can't occur, because the server records the time.
- **COOK-4.** (withdrawn) Duplicate entries are allowed. Marking a recipe cooked twice records two entries; a mistaken one can be
  deleted (COOK-5).
- **COOK-5. History on the recipe.** A recipe shows the date it was last cooked ("Never cooked" if none) and how many times it has
  been cooked. An editor can see the full list of entries, newest first, each shown as a date in the device's time zone, and
  delete any single entry (to correct mistakes).
- **COOK-6. "Haven't made in a while" view.** An editor can see all recipes ordered by when they were last cooked, least recent
  first, each showing the last-cooked date and how long ago that was ("3 months ago"). Recipes never cooked appear before all
  others, sorted by name.
- **COOK-7. History drives the view.** Deleting a history entry (COOK-5) immediately updates the recipe's last-cooked date, count
  and its position in the COOK-6 view.
- **COOK-8. Cooked-today button.** If a recipe was last cooked earlier on the device's current day, its "We made this" button
  reads "Cooked today ✓" and can't be tapped again until the next day. This prevents most accidental duplicates; the server still
  accepts them (COOK-4).

## Examples

| Situation                                                    | Result                                          |
| ------------------------------------------------------------ | ----------------------------------------------- |
| Mark cooked at 6 pm                                          | Button reads "Cooked today ✓" until midnight    |
| Two devices mark the same recipe cooked at the same moment   | Two entries; one can be deleted (COOK-5)        |
| Entries 2026-09-01 and 2026-10-15; delete 2026-10-15         | Last cooked becomes 2026-09-01; count becomes 1 |
| Recipes: A (never), B (last 2026-01-10), C (last 2026-08-02) | View order: A, B, C                             |

## Out of scope

- Recording a cooking for an earlier date (backdating), or changing when an entry was recorded.
- Recording who cooked, ratings, or notes per cooking.
- Statistics or charts beyond last-cooked date and count.
