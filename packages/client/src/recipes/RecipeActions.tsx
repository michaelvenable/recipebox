import { useEffect, useId, useRef, useState } from "react";
import type { EditorRecipe } from "@recipebox/shared";
import { formatDate, formatRecentDay, isOnLocalDay } from "./dates.js";
import { focusIsUnclaimed } from "./focus.js";
import { useLocalDay } from "./use-local-day.js";

interface RecipeActionsProps {
  recipe: EditorRecipe;
  /** A change to this recipe is being saved; the buttons wait for it, so a double tap can't record two cookings. */
  busy: boolean;
  /** Why the last cooking or to-make change failed, or undefined. */
  error: string | undefined;
  /** Each change calls `done` once it is saved. */
  markCooked: (done: () => void) => void;
  addToPlan: (done: () => void) => void;
  removeFromPlan: (done: () => void) => void;
}

type FocusTarget = "cook" | "addToPlan" | "removeFromPlan";

/**
 * The editor's actions on a recipe (X-8): "I cooked this today" (COOK-1, COOK-8), the to-make list (PLAN-1, PLAN-4) and the
 * cooking history (COOK-5). Editors only; the server sends none of this to visitors (X-1).
 */
export function RecipeActions({ recipe, busy, error, markCooked, addToPlan, removeFromPlan }: RecipeActionsProps) {
  // Whether it was cooked today is decided on the device, in its time zone, and rechecked when the day changes (X-12, COOK-8).
  const today = useLocalDay();
  const cookedToday = recipe.lastCookedAt !== undefined && isOnLocalDay(recipe.lastCookedAt, today);

  // A saved change replaces the button that was pressed. Focus moves to the control that takes its place once the saved recipe
  // is shown and the buttons no longer wait (a disabled button can't take focus), rather than falling to the page. Not if the
  // editor has moved focus elsewhere meanwhile (focusIsUnclaimed).
  const cookButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const [focus, setFocus] = useState<{ target: FocusTarget; before: EditorRecipe; pressed: Element }>();
  useEffect(() => {
    if (focus === undefined || recipe === focus.before || busy) return;
    const button = { cook: cookButton, addToPlan: removeButton, removeFromPlan: addButton }[focus.target].current;
    setFocus(undefined);
    if (focusIsUnclaimed(focus.pressed)) button?.focus();
  }, [focus, recipe, busy]);

  function act(target: FocusTarget, change: (done: () => void) => void, pressed: Element) {
    const before = recipe;
    change(() => setFocus({ target, before, pressed }));
  }

  return (
    <section className="card recipe-actions" aria-label="Cooking">
      {cookedToday ? (
        // Not `disabled`: a disabled button can't hold focus, and would hide the state from keyboard and screen reader users.
        <button key="cooked" ref={cookButton} type="button" className="button cooked-today" aria-disabled="true">
          Cooked today ✓
        </button>
      ) : (
        <button
          key="cook"
          ref={cookButton}
          type="button"
          className="button"
          disabled={busy}
          onClick={(event) => act("cook", markCooked, event.currentTarget)}
        >
          I cooked this today
        </button>
      )}
      {recipe.toMake !== undefined ? (
        <div className="on-plan">
          <span>On your meal plan ✓</span>
          <button
            ref={removeButton}
            type="button"
            className="link-button on-plan-remove"
            disabled={busy}
            onClick={(event) => act("removeFromPlan", removeFromPlan, event.currentTarget)}
          >
            Remove
          </button>
        </div>
      ) : (
        <button ref={addButton} type="button" className="button" disabled={busy} onClick={(event) => act("addToPlan", addToPlan, event.currentTarget)}>
          I want to cook this
        </button>
      )}
      {error !== undefined && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <CookingHistory recipe={recipe} today={today} />
    </section>
  );
}

function timesCooked(count: number): string {
  return count === 1 ? "cooked once" : `cooked ${count} times`;
}

/** "Last cooked Aug 2 · cooked 6 times · History", with History showing every entry, newest first (COOK-5). No deleting. */
function CookingHistory({ recipe, today }: { recipe: EditorRecipe; today: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (recipe.lastCookedAt === undefined) return <p className="cook-summary">Never cooked</p>;
  return (
    <>
      <p className="cook-summary">
        Last cooked {formatRecentDay(recipe.lastCookedAt, today)} · {timesCooked(recipe.timesCooked)} ·{" "}
        <button type="button" className="link-button history-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          History
        </button>
      </p>
      {open && (
        // The server's order: newest first.
        <ol id={listId} className="cook-history" aria-label="Cooking history">
          {recipe.cookedAt.map((at, index) => (
            <li key={`${at}-${index}`}>
              <time dateTime={at}>{formatDate(at)}</time>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
