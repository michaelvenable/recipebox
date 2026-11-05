# Mockups

Copies of the "RecipeBox Screens" design canvas (https://claude.ai/artifact/Uso3gAdhN7YcuqdDHDAu6T), saved 2026-11-04 so agents
can read them. The canvas is the original; these files are reference only and are not served by the app.

Each `.dc.html` file is one artboard: plain HTML with inline styles, plus sample data in the `<script data-dc-script>` block at
the end. Phone artboards are 390 x 844, tablet 1024 x 768.

Decisions recorded on the canvas:
- Navigation: a top row inline on every page. Editors: Recipes, Want to make, Rediscover, Trash, and an Account button at the
  right. Visitors: Recipes and Sign in. On phones the row scrolls sideways; no drawer, no More menu.
- Edit form: Cancel and Save replace the top row, so a stray tap can't lose unsaved changes.
- Screen awake: the screen stays on while a recipe is open, with a small note saying so.
- Ticks: ingredients have checkboxes; tapping a step's number marks it done; "Clear ticks" resets both.
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
