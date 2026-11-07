# Meal plan — the "to make" list (PLAN)

## Goal

Keep a simple list of recipes the household intends to make soon. There are no dates, days or meal slots. The list is private:
only signed-in editors can see or change it (X-1, X-6). In the app, the "to make" list is called "Plan".

## Requirements

- **PLAN-1. Add.** From a recipe, an editor can tap "I want to cook this" to add it to the "to make" list. While it is on the
  list, the button shows that instead, and offers to remove it (PLAN-4).
- **PLAN-2. No duplicates.** A recipe appears on the list at most once. Adding a recipe that is already on the list leaves the
  list unchanged and does not show an error.
- **PLAN-3. View.** A user can see the list, ordered by when each recipe was added (oldest first), each showing name, thumbnail
  and the date it was added (X-12). An empty list shows a short message saying so.
- **PLAN-4. Remove.** A user can remove a recipe from the list without affecting the recipe itself or its cooking history.
- **PLAN-5. Cooked recipes leave the list.** When a recipe on the list is marked as cooked (COOK-1), it is removed from the list.
- **PLAN-6. Deleted recipes leave the list.** When a recipe is deleted (REC-6), it is taken off the list. Restoring it from the
  trash (REC-15) does not put it back; an editor can add it again (PLAN-1).
- **PLAN-7. Indicator.** Wherever a recipe is shown (list, search results, recipe view), it is visibly marked if it is on the "to
  make" list.
- **PLAN-8. Shopping list.** From the list, an editor can open a shopping list: every ingredient of every recipe on the "to
  make" list, in one list sorted alphabetically (X-13), each showing the name of its recipe. Ingredients are free text, so they
  are shown as entered and never combined: the same ingredient in two recipes appears twice, ordered by recipe name. Prep entries
  and steps are not included. The editor can tick items off and untick them. Ticks are never saved, on the device or the server;
  they are cleared when the editor leaves the shopping list. When the "to make" list is empty, there is no shopping list to
  open. The shopping list is private, like the "to make" list (X-1).

  Example: "Shakshuka" has `["6 eggs", "1 can tomatoes"]` and "Chili" has `["1 can tomatoes", "500 g beef mince"]`. The shopping
  list shows "1 can tomatoes" (Chili), "1 can tomatoes" (Shakshuka), "500 g beef mince" (Chili), "6 eggs" (Shakshuka).

## Examples

| Situation                          | Result                                  |
| ---------------------------------- | --------------------------------------- |
| Add "Pad Thai" twice               | Appears once                            |
| "Pad Thai" on list, mark it cooked | Removed from list; cooked date recorded |
| Remove "Pad Thai" from list        | Recipe and its history unchanged        |

## Out of scope

- Scheduling recipes on dates, days of the week, or meal slots.
- Manually reordering the list.
- Combining ingredients on the shopping list (PLAN-8), such as adding "2 eggs" and "3 eggs" together.
- Sending or sharing the shopping list.
