# Mockups

Copies of the "RecipeBox Screens" design canvas (https://claude.ai/artifact/Uso3gAdhN7YcuqdDHDAu6T), saved 2026-11-04 so agents
can read them. The canvas is the original; these files are reference only and are not served by the app.

Each `.dc.html` file is one artboard: plain HTML with inline styles, plus sample data in the `<script data-dc-script>` block at
the end. Phone artboards are 390 x 844, tablet 1024 x 768.

Decisions recorded on the canvas:
- Navigation: a top row inline on every page. Editors: Catalog, Plan, Recommendations, Trash, and an Account button at the
  right. Visitors: Catalog and Sign in. On phones the row scrolls sideways; no drawer, no More menu.
- Edit form: Cancel and Save replace the top row, so a stray tap can't lose unsaved changes.
- Screen awake: the screen stays on while a recipe is open. No note says so.
- Ticks: ingredients have checkboxes; tapping a prep or step number marks it done. Leaving the recipe clears them; there is no
  "Clear ticks".
- Delete: no confirmation; the recipe moves to the trash with an Undo message. Delete stays at the bottom of the recipe.
- Many tags: chips scroll sideways on phones. An "All tags" sheet is deferred until there are dozens of tags.
- Dark theme: follows the device setting, with no switch in the app.
- Visitor recipe view: the editor view without editor actions, the plan indicator and cooking history (X-1).

Decisions made while building the client, confirmed by the owner on 2026-11-04 (where they differ from the artboards, these win):
- Total time is one field, typed as hours:minutes (`1:30`) or minutes (`45`), not a minutes-only field.
- Ingredients and steps can't be reordered; there is no drag handle (REC-5).
- The delete message reads "‹name› moved to trash" (REC-6).
- "N months ago" rounds down to whole months, so a recipe cooked Aug 2 reads "2 months ago" on Oct 30.
- A signed-in person who isn't an editor sees Recipes and the Account button, not "Sign in".
- The Account page shows the ID as `provider:accountId`, the form an `EDITORS` entry takes.
- Photo changes in the form wait for Save, so Cancel discards them.
- Fonts are bundled with the app; nothing is loaded from Google.
- The installed app's splash screen is the accent green (#2E6A4F) with the icon, in light and dark mode. No custom startup
  images.
- Offline: the app shell opens without a connection and a "You're offline" banner explains that loading and saving need one.
  Nothing is stored for offline reading or editing (offline use stays out of scope).

Updated 2026-11-07 (owner request): every artboard was saved again from the canvas, redrawn to match the app.
- Names: Catalog, Plan, Recommendations; the visitor heading is "Recipe Box". The search box has no visible label and reads
  "Find a recipe".
- Recipe views: a numbered, tickable Prep section before Steps (REC-20); read-only tags (REC-10); "I cooked this today" is a
  secondary button. The edit form has one box each for ingredients, prep and steps (REC-21) and a comma-separated tags field.
- Known gaps: the tablet artboards still show the app name and an "Account" text button in the top row, and the edit form's
  photo buttons read "Replace" and "Remove" where the app says "Replace photo" and "Remove photo".
- The Plan artboard shows a "Shopping list" button.
- Shopping list: every ingredient of every recipe on the Plan, in one list sorted A–Z (X-13), each with its recipe's name.
  Ingredients are free text, so duplicates stay as typed. Ticks are never saved; leaving the page clears them.
- Send (decided, PLAN-9): the Shopping list has a Send button. It makes a link with a random, unguessable code
  and opens the phone's share sheet with it (the link is copied where there is no share sheet). Anyone with the link sees the
  current shopping list, live, without signing in, for 7 days (`SharedList.dc.html`); after that, and for unknown links, the
  page says the link has expired (`SharedListExpired.dc.html`). The panel after Send also has a Share button.
- Recommendations (COOK-9): the same tag chips as the Catalog, with counts, above the list. Picking tags keeps only recipes
  that have all of them, still least recently cooked first; when none match, "Show all recipes" clears the filter. The
  filter is separate from the Catalog's.

Added 2026-11-07 (owner request): importing a recipe from a photo (IMP, `docs/specs/import.md`).
- `ImportNewRecipe.dc.html`: the New recipe form with a "Have it on paper?" panel at the top and "Import from a photo".
- `ImportReading.dc.html`: back on the Catalog after the upload, with a message and a "Reading your photo…" card above the
  recipes.
- `ImportReady.dc.html`: the imported recipe in the list, with a "‹name› imported" message and Open. There is no step to check
  the recipe first, and no screen for a failed import: the card just goes away and the failure is logged.
