# Meal plan — the "to make" list (PLAN)

## Goal

Keep a simple list of recipes the household intends to make soon. There are no dates, days or meal slots. The list is private:
only signed-in editors can see or change it (X-1, X-6), except for a shopping list an editor sends (PLAN-9). In the app, the
"to make" list is called "Plan".

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
- **PLAN-9. Send the shopping list.** From the shopping list, an editor can tap "Send". The app makes a link with a random code
  that can't be guessed and offers it through the device's share function, such as to send it in a text message. Where the
  device has no share function, the link is copied. Either way the app shows the link and the date it stops working.
  - Anyone who opens the link, signed in or not, sees the current shopping list (PLAN-8): the items, each with its recipe's
    name, and the date the link stops working. The link is live: changes to the "to make" list or its recipes appear the next
    time the page loads, or when the person comes back to it. When the "to make" list is empty, the page says there is
    nothing to shop for. They can tick items as in PLAN-8; ticks are never saved, and a tick stays on its item while that
    item is still on the list.
  - The shared list shows nothing else that is private (X-1), such as when recipes were added to the "to make" list.
  - A link works for 7 days after it was made, measured by the server's clock (X-12). After that, opening it, or coming back to
    a page that was already open, shows "This link has expired", the same page as for a link that never existed. Only the
    link's code and when it was made are stored, and they are permanently removed within one day after the link stops working.
  - Each Send makes a new link. Earlier links keep working until their 7 days are up; all of them show the same current list.

  Example: a link made 2026-11-07 at 09:00 works until 2026-11-14 at 09:00. Opened at 09:01 that day, it shows "This link has
  expired".

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
- Stopping a shopping list link before its 7 days are up (PLAN-9), changing the 7 days, or listing the links that were sent.
