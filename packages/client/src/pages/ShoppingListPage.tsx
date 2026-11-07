import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShoppingItem } from "@recipebox/shared";
import { Link } from "react-router";
import { shoppingListKeys } from "../api/query-keys.js";
import { fetchShoppingList } from "../api/recipes.js";

/**
 * The shopping list at /plan/shopping (PLAN-8, docs/mockups/ShoppingList.dc.html): every ingredient of every recipe on the
 * to-make list, in the server's order (the domain sorts it, X-13), each with its recipe's name. Editor-only (X-1), behind
 * EditorOnly in routes.tsx. Sending the list is out of scope.
 */
export function ShoppingListPage() {
  const list = useQuery({ queryKey: shoppingListKeys.all, queryFn: ({ signal }) => fetchShoppingList(signal) });
  const items = list.data;
  // PLAN-8: ticks live only on this page, never saved or sent, so they go when the editor leaves it. Held here rather than in
  // the list, so they survive the list being dropped and reloaded while the page stays open (recipe-changes.ts).
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(key: string) {
    setTicks((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <div className="shopping-page">
      <header className="list-page-header">
        <Link to="/plan" className="back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Plan
        </Link>
        <h1>Shopping list</h1>
        {items !== undefined && items.length > 0 && <p className="muted">{summary(items)}</p>}
      </header>
      {items === undefined ? (
        list.isError ? (
          <div className="card stack" role="alert">
            <p>Couldn't load the shopping list. Check the connection and try again.</p>
            <button type="button" className="button" onClick={() => void list.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <p role="status">Loading the shopping list…</p>
        )
      ) : items.length === 0 ? (
        <NothingToShopFor />
      ) : (
        <ShoppingItems items={items} ticks={ticks} toggle={toggle} />
      )}
    </div>
  );
}

/** "18 items from 4 recipes", or "1 item from 1 recipe". */
export function summary(items: readonly ShoppingItem[]): string {
  const recipes = new Set(items.map((item) => item.recipeId)).size;
  return `${plural(items.length, "item")} from ${plural(recipes, "recipe")}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** PLAN-8: with nothing on the to-make list there is no shopping list. */
function NothingToShopFor() {
  return (
    <div className="empty-state">
      <h2>Nothing to shop for</h2>
      <p className="muted">The plan is empty, so there's no shopping list.</p>
      <Link to="/" className="button button-primary">
        Browse recipes
      </Link>
    </div>
  );
}

/**
 * Identifies a line by its recipe, its text and which of that recipe's identical lines it is, so a tick stays on its line when
 * the list reloads with lines added or removed around it.
 */
function lineKeys(items: readonly ShoppingItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = JSON.stringify([item.recipeId, item.text]);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

interface ShoppingItemsProps {
  items: readonly ShoppingItem[];
  ticks: ReadonlySet<string>;
  toggle: (key: string) => void;
}

/** The lines, each a checkbox like the recipe view's ingredients (REC-19), ticked by line key (lineKeys). */
function ShoppingItems({ items, ticks, toggle }: ShoppingItemsProps) {
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
