import { useState } from "react";
import { Link } from "react-router";
import { type ListedRecipe, isOnToMakeList, thumbnailUrl } from "../api/recipes.js";
import { recipeMeta } from "./format.js";
import { usePhotoVersion } from "./photo-version.js";

/**
 * A recipe's thumbnail, or a neutral placeholder block when it has no photo (REC-8). Also falls back to the placeholder if the
 * image fails to load, for instance because the photo was removed on another device since the list was loaded.
 */
export function Thumbnail({ recipe }: { recipe: Pick<ListedRecipe, "id" | "name" | "hasPhoto"> }) {
  const [failed, setFailed] = useState(false);
  const version = usePhotoVersion(recipe.id);
  if (!recipe.hasPhoto || failed) return <div className="thumb thumb-placeholder" aria-hidden="true" />;
  return (
    <img
      className="thumb"
      src={thumbnailUrl(recipe.id, version)}
      alt={`${recipe.name} photo`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** The "Want to make" mark (PLAN-7). Editors only (X-1). */
export function ToMakeBadge() {
  return (
    <span className="to-make-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3h12v18l-6-4-6 4z" />
      </svg>
      Want to make
    </span>
  );
}

/**
 * One recipe in the list, linking to it: thumbnail, name, total time and tags (REC-8), and for editors the to-make mark
 * (PLAN-7). A row on phones, a card in the grid on wider screens (styles.css).
 */
export function RecipeCard({ recipe, isEditor }: { recipe: ListedRecipe; isEditor: boolean }) {
  const meta = recipeMeta(recipe);
  // Both checks: the field comes only in the editor shape (X-1), and a list loaded before the session ended (X-9) shouldn't
  // keep showing private marks once the app knows it is a visitor.
  const onToMakeList = isEditor && isOnToMakeList(recipe);
  return (
    <li>
      <Link to={`/recipes/${encodeURIComponent(recipe.id)}`} className="recipe-card">
        <Thumbnail recipe={recipe} />
        <span className="recipe-card-text">
          <span className="recipe-card-name">{recipe.name}</span>
          {meta !== "" && <span className="recipe-card-meta">{meta}</span>}
        </span>
        {onToMakeList && <ToMakeBadge />}
      </Link>
    </li>
  );
}
