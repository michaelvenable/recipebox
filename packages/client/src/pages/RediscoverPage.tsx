import { useQuery } from "@tanstack/react-query";
import type { RediscoverEntry } from "@recipebox/shared";
import { Link } from "react-router";
import { rediscoverKeys } from "../api/query-keys.js";
import { fetchRecommendations } from "../api/recipes.js";
import { cookedAgo, formatRecentDay, localDayKey } from "../recipes/dates.js";
import { Thumbnail } from "../recipes/RecipeCard.js";
import { useNow } from "../recipes/use-now.js";

/**
 * "Haven't made in a while" at /recommendations (COOK-6): every recipe, in the server's order (never cooked first by name,
 * then least recently cooked first), each linking to the recipe with its last cooking and how long ago that was. The labels are
 * worked out on the device and kept current while the page is open (X-12). Editor-only (X-1), behind EditorOnly in routes.tsx.
 */
export function RediscoverPage() {
  const recipes = useQuery({ queryKey: rediscoverKeys.all, queryFn: ({ signal }) => fetchRecommendations(signal) });
  const now = useNow();

  return (
    <div className="rediscover-page">
      <header className="list-page-header">
        <h1>Haven't made in a while</h1>
        {recipes.data !== undefined && recipes.data.length > 0 && <p className="muted">Least recently cooked first</p>}
      </header>
      <RediscoverContents entries={recipes.data} failed={recipes.isError} retry={() => void recipes.refetch()} now={now} />
    </div>
  );
}

interface RediscoverContentsProps {
  entries: RediscoverEntry[] | undefined;
  failed: boolean;
  retry: () => void;
  now: Date;
}

function RediscoverContents({ entries, failed, retry, now }: RediscoverContentsProps) {
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
  if (entries.length === 0) {
    return (
      <div className="card stack">
        <p>No recipes yet. Once there are some, the ones you haven't made in a while show up here.</p>
        <Link to="/recipes/new" className="button button-primary">
          Add your first recipe
        </Link>
      </div>
    );
  }
  const today = localDayKey(now);
  return (
    <ul className="entry-cards" aria-label="Haven't made in a while">
      {entries.map((entry) => (
        <RediscoverRow key={entry.id} entry={entry} now={now} today={today} />
      ))}
    </ul>
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
