import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { RediscoverEntry } from "@recipebox/shared";
import { Link } from "react-router";
import { rediscoverKeys, tagKeys } from "../api/query-keys.js";
import { fetchRecommendations, fetchTags } from "../api/recipes.js";
import { cookedAgo, formatRecentDay, localDayKey } from "../recipes/dates.js";
import { describeResults } from "../recipes/format.js";
import { useTagFilter } from "../recipes/list-filter.js";
import { Thumbnail } from "../recipes/RecipeCard.js";
import { TagChips } from "../recipes/TagChips.js";
import { useNow } from "../recipes/use-now.js";

/**
 * "Haven't made in a while", called "Recommendations" in the app, at /recommendations (COOK-6): every recipe, in the server's order (never cooked first by name,
 * then least recently cooked first), each linking to the recipe with its last cooking and how long ago that was. The labels are
 * worked out on the device and kept current while the page is open (X-12). Editor-only (X-1), behind EditorOnly in routes.tsx.
 *
 * COOK-9: the same tag chips as the recipe list, with their own picked tags in this page's address (`?tags=`); the server
 * filters, keeping its order.
 */
export function RediscoverPage() {
  const filter = useTagFilter();
  const recipes = useQuery({
    queryKey: rediscoverKeys.list(filter.tags),
    queryFn: ({ signal }) => fetchRecommendations(filter.tags, signal),
    // While another filter loads, keep showing the previous results rather than flashing a loading message, as the recipe list does.
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: tagKeys.all, queryFn: ({ signal }) => fetchTags(signal) });
  const now = useNow();

  return (
    <div className="rediscover-page">
      <header className="list-page-header">
        <h1>Recommendations</h1>
      </header>
      <TagChips
        tags={tags.data}
        failed={tags.isError}
        retry={() => void tags.refetch()}
        picked={filter.tags}
        toggle={filter.toggleTag}
      />
      <RediscoverContents
        entries={recipes.data}
        isUpdating={recipes.isPlaceholderData}
        failed={recipes.isError}
        retry={() => void recipes.refetch()}
        picked={filter.tags}
        showAll={filter.clear}
        now={now}
      />
    </div>
  );
}

interface RediscoverContentsProps {
  entries: RediscoverEntry[] | undefined;
  /** Showing the previous filter's results while the picked tags' load. */
  isUpdating: boolean;
  failed: boolean;
  retry: () => void;
  picked: readonly string[];
  showAll: () => void;
  now: Date;
}

function RediscoverContents({ entries: loaded, isUpdating, failed, retry, picked, showAll, now }: RediscoverContentsProps) {
  const filtering = picked.length > 0;
  // As on the recipe list: while every recipe loads again (all tags unpicked), an empty previous result would claim "No recipes
  // yet." about a collection it wasn't loaded for, so show loading instead.
  const entries = isUpdating && !filtering && loaded?.length === 0 ? undefined : loaded;
  if (entries === undefined) {
    if (failed) {
      return (
        <div className="card stack" role="alert">
          <p>Couldn't load the recipes. Check the connection and try again.</p>
          <button type="button" className="button" onClick={retry}>
            Try again
          </button>
        </div>
      );
    }
    return <p role="status">Loading recipes…</p>;
  }
  if (entries.length === 0 && !filtering) {
    return (
      <div className="card stack">
        <p>No recipes yet. Once there are some, the ones you haven't made in a while show up here.</p>
        <Link to="/recipes/new" className="button button-primary">
          Add your first recipe
        </Link>
      </div>
    );
  }
  // COOK-9: say so when nothing has all the picked tags; while another filter loads, say nothing rather than describe the old one.
  const noneMatch = filtering && !isUpdating && entries.length === 0;
  const today = localDayKey(now);
  return (
    <>
      {/* A live region, there before its message, so screen readers hear that a filter found nothing. */}
      <p role="status" className="results-summary">
        {noneMatch && (
          <>
            {describeResults(0, { name: "", tags: picked })}{" "}
            <button type="button" className="link-button" onClick={showAll}>
              Show all recipes
            </button>
          </>
        )}
      </p>
      {entries.length > 0 && (
        <ul className="entry-cards" aria-label="Recommendations" aria-busy={isUpdating}>
          {entries.map((entry) => (
            <RediscoverRow key={entry.id} entry={entry} now={now} today={today} />
          ))}
        </ul>
      )}
    </>
  );
}

/** How the "ago" label looks: never cooked stands out, months or more reads strong, days muted (docs/mockups/Rediscover.dc.html). */
function agoTone(entry: RediscoverEntry, ago: string): string {
  if (entry.lastCookedAt === undefined) return "ago-new";
  return /month|year/.test(ago) ? "ago-old" : "ago-recent";
}

function RediscoverRow({ entry, now, today }: { entry: RediscoverEntry; now: Date; today: string }) {
  const ago = cookedAgo(entry.lastCookedAt, now);
  return (
    <li>
      <Link to={`/recipes/${encodeURIComponent(entry.id)}`} className="entry-card entry-card-link rediscover-entry">
        <Thumbnail recipe={entry} />
        <span className="recipe-card-text">
          <span className="recipe-card-name">{entry.name}</span>
          <span className="recipe-card-meta">
            {entry.lastCookedAt === undefined ? "Never cooked" : `Last cooked ${formatRecentDay(entry.lastCookedAt, today)}`}
          </span>
        </span>
        <span className={`cooked-ago ${agoTone(entry, ago)}`}>{ago}</span>
      </Link>
    </li>
  );
}
