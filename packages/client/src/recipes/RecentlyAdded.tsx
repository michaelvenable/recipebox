import { Link } from "react-router";
import { formatMonthDay } from "./dates.js";
import type { AddedRecipe } from "./recently-added.js";
import { Thumbnail } from "./RecipeCard.js";

/**
 * The "Recently added" row above the recipe list (REC-22; docs/mockups/NewestStrip.dc.html): a card for each recipe with its
 * thumbnail or the placeholder, its name and the day it was added in the device's time zone (X-12), linking to the recipe
 * (REC-4). Scrolls sideways. Public, like the recipes (X-1).
 */
export function RecentlyAdded({ recipes }: { recipes: readonly AddedRecipe[] }) {
  return (
    <section className="recently-added" aria-labelledby="recently-added-heading">
      <h2 id="recently-added-heading">Recently added</h2>
      <ul className="recently-added-list" aria-labelledby="recently-added-heading">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <Link to={`/recipes/${encodeURIComponent(recipe.id)}`} className="recent-card">
              <Thumbnail recipe={recipe} />
              <span className="recent-card-name">{recipe.name}</span>
              <span className="recent-card-added">Added {formatMonthDay(recipe.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
