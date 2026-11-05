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
