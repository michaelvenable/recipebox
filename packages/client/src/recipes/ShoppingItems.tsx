// The lines of a shopping list with their ticks, shared by the editor's shopping list (PLAN-8) and a sent one (PLAN-9).
import { useCallback, useState } from "react";
import type { ShoppingItem } from "@recipebox/shared";

/** "18 items from 4 recipes", or "1 item from 1 recipe". */
export function summary(items: readonly ShoppingItem[]): string {
  const recipes = new Set(items.map((item) => item.recipeId)).size;
  return `${plural(items.length, "item")} from ${plural(recipes, "recipe")}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface Ticks {
  ticks: ReadonlySet<string>;
  toggle: (key: string) => void;
}

interface TickState extends Ticks {
  /** Drops the ticks of lines no longer on the list (lineKeys), so a line that comes back later is unticked (PLAN-9). */
  keepOnly: (keys: readonly string[]) => void;
}

/**
 * PLAN-8, PLAN-9: ticks live only on the page that holds them, never saved or sent, so they go when the page is left. Held by the
 * page rather than in the list, so they survive the list being dropped and reloaded while the page stays open.
 */
export function useTicks(): TickState {
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(key: string) {
    setTicks((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const keepOnly = useCallback((keys: readonly string[]) => {
    setTicks((current) => {
      const kept = new Set([...current].filter((key) => keys.includes(key)));
      return kept.size === current.size ? current : kept;
    });
  }, []);

  return { ticks, toggle, keepOnly };
}

/**
 * Identifies a line by its recipe, its text and which of that recipe's identical lines it is, so a tick stays on its line when
 * the list reloads with lines added or removed around it.
 */
export function lineKeys(items: readonly ShoppingItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = JSON.stringify([item.recipeId, item.text]);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

interface ShoppingItemsProps extends Ticks {
  items: readonly ShoppingItem[];
}

/** The lines in the order given, each a checkbox like the recipe view's ingredients (REC-19), ticked by line key (lineKeys). */
export function ShoppingItems({ items, ticks, toggle }: ShoppingItemsProps) {
  const keys = lineKeys(items);

  return (
    <ul className="shopping-items" aria-label="Shopping list">
      {items.map((item, index) => {
        const key = keys[index] ?? String(index);
        const ticked = ticks.has(key);
        return (
          <li key={key}>
            <label className={ticked ? "shopping-item ticked" : "shopping-item"}>
              <input type="checkbox" checked={ticked} onChange={() => toggle(key)} />
              <span className="shopping-item-text">
                <span className="shopping-item-name">{item.text}</span>
                {/* So the checkbox is read as "6 eggs, Shakshuka" rather than run together. */}
                <span className="visually-hidden">,</span>{" "}
                <span className="shopping-item-recipe">{item.recipeName}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
