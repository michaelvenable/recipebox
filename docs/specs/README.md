# RecipeBox — Specifications

RecipeBox stores a personal recipe collection and makes it easy to view recipes on a phone or tablet while cooking. It is designed
to be used by a single household. It allows for keeping a list of recipes waiting to be cook and discovering recipes that haven't
been cooked in a while.

## Spec files

| File                                     | Prefix | Covers                                                              |
| ---------------------------------------- | ------ | ------------------------------------------------------------------- |
| [recipes.md](recipes.md)                 | REC    | Create, view, edit, photo, search, tags, trash                      |
| [meal-plan.md](meal-plan.md)             | PLAN   | The "to make" list and its shopping list                            |
| [cooking-history.md](cooking-history.md) | COOK   | "I cooked this today", last-cooked dates, recommendations by tag    |

## How to read and write these specs

- Every requirement has a stable ID (`REC-3`). Reviews, tests and commits cite these IDs. Never renumber; retire an ID by marking
  it (withdrawn).
- Every requirement must be checkable: it should be possible to write a test, or describe a concrete scenario, that shows it is
  met or broken.
- Specs describe behavior, not implementation. Storage layout, framework choices and code structure live in
  `docs/architecture.md`.
- "Out of scope" sections are binding: reviewers must not flag missing features listed there.
- Items marked (proposed) are decisions the drafter made and the owner has not yet confirmed.

## Cross-cutting requirements

- **X-1. Recipes are public; the rest is private.** Anyone with the app's address can, without signing in, view recipes and their
  photos, search by name (REC-9) and filter by tag with counts (REC-13). The "to make" list and cooking history are visible only
  to signed-in editors. That includes the "to make" indicator (PLAN-7), last-cooked date and count (COOK-5) and the "haven't made
  in a while" view (COOK-6). The trash (REC-14) is private too, including the photos of recipes in it. The server never sends this
  data to a visitor; hiding it in the app is not enough on its own. The one exception is a shopping list an editor sends
  (PLAN-9): for 7 days, anyone with its link can see the current shopping list, and nothing else.
- **X-2.** All editors see and edit the same single collection. There is no per-user data.
- **X-3.** Every screen is usable on a phone (≥ 360 px wide) and a tablet, without horizontal scrolling. Desktop browsers are also
  supported.
- **X-4.** The app can be installed to a phone/tablet home screen (PWA).
- **X-5.** (withdrawn) Conflicting simultaneous edits were judged too unlikely to handle. If two saves to the same recipe overlap,
  the last save wins.
- **X-6. Changes require sign-in.** Every change requires a signed-in editor: creating, editing, deleting or restoring a recipe;
  attaching or removing tags; adding, replacing or removing a photo; adding to or removing from the "to make" list; marking a
  recipe cooked; deleting a history entry; sending a shopping list (PLAN-9). The server refuses any change that isn't from a
  signed-in editor, and nothing is changed. Hiding buttons in the app is not enough on its own.
- **X-7. Editors are listed in configuration.** Editors sign in with a Microsoft or Google account; the app offers both. An
  identity is an editor only if it is on the editor list in the app's configuration. The list can hold any number of identities,
  including one or none. Anyone else who signs in is treated as a visitor: they can view but not change.
- **X-8. Editing controls.** Visitors don't see editing controls; they see a "Sign in" option instead. After signing in, the
  editor returns to the page they were on.
- **X-9. Long sessions.** An editor who uses the app on a device at least once every 30 days stays signed in on that device. After
  30 days without use, they must sign in again.
- **X-10. Not in search engines.** The app asks search engines not to index it, so the collection doesn't appear in search
  results.
- **X-11. Account page.** Anyone who is signed in can open an Account page showing which provider they signed in with
  (Microsoft or Google), their permanent account ID with a button to copy it, and whether they are an editor. This is how a new
  editor finds the ID to add to the editor list (X-7). The page also lets them sign out. Someone who isn't signed in sees a "Sign
  in" option instead.
- **X-12. Time.** Every time the app stores comes from the server's clock: when a recipe was cooked (COOK-1), added to the "to
  make" list (PLAN-3) and deleted (REC-6), the 30-day trash deadline (REC-16), and when a shopping list link was made and stops
  working (PLAN-9). The app never sends a time to be stored or
  checked. Stored times are shown in the device's time zone. Relative labels such as "3 months ago" (COOK-6) and "10 days left"
  (REC-14) are calculated on the device, as is whether a recipe was cooked today (COOK-8). Short screen timers such as the Undo
  message (REC-6) also run on the device.
- **X-13. Text.** These rules apply wherever the specs count characters, sort text or match a search term:
  - Characters are counted as a person sees them. Every emoji counts as one character, including combined ones such as flags.
  - Sorting and matching ignore case and accents, using English rules. "Éclair" sorts among the E's, and searching "creme" finds
    "Crème brûlée".
- **X-14. Dark theme.** The app uses a light or dark theme to match the device's setting, and switches when the setting changes.
  There is no theme switch in the app.

## Out of scope (for now)

- Importing a recipe from a photo (planned; will get its own spec).
- Serving-size scaling, nutrition data. (The shopping list from the "to make" list is in scope: PLAN-8.)
- Sharing features such as share links for recipes or per-recipe privacy. Every recipe is viewable by anyone with the address
  (X-1). The only link that is sent is the shopping list's (PLAN-9).
- Managing editors in the app. The editor list is set in configuration (X-7).
- Detecting conflicting simultaneous edits (X-5, withdrawn).
- Offline use. The app requires a network connection.
- Meal planning by date or meal slot.
