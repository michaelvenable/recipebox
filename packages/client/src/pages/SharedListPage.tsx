import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/client.js";
import { sharedListKeys } from "../api/query-keys.js";
import { fetchSharedList } from "../api/shopping-lists.js";
import { formatWeekdayDate } from "../recipes/dates.js";
import { ShoppingItems, summary, useTicks } from "../recipes/ShoppingItems.js";

/**
 * A sent shopping list at /list/{token} (PLAN-9, docs/mockups/SharedList.dc.html), for anyone with the link, signed in or not:
 * the list as it was when sent, with the date the link stops working. Ticks are this page's own and never saved (PLAN-8).
 */
export function SharedListPage() {
  const { token = "" } = useParams();
  // Keyed by token, so another link opened in the same tab starts with its own ticks.
  return <SharedList key={token} token={token} />;
}

function SharedList({ token }: { token: string }) {
  const list = useQuery({
    queryKey: sharedListKeys.detail(token),
    queryFn: ({ signal }) => fetchSharedList(token, signal),
    // A sent list never changes; once loaded it stays on screen, ticks and all, even if the link expires meanwhile.
    staleTime: Infinity,
  });
  const { ticks, toggle } = useTicks();

  if (list.data !== undefined) {
    const { items, expiresAt } = list.data;
    return (
      <div className="shopping-page">
        <header className="list-page-header">
          <h1>Shopping list</h1>
          <p className="muted">{summary(items)}</p>
          <p className="muted shared-list-until">This link works until {formatWeekdayDate(expiresAt)}.</p>
        </header>
        <ShoppingItems items={items} ticks={ticks} toggle={toggle} />
      </div>
    );
  }
  // PLAN-9: the server answers 404 alike for an expired link and one that never existed.
  if (list.error instanceof ApiError && list.error.status === 404) return <LinkExpired />;
  if (list.isError) {
    return (
      <div className="card stack" role="alert">
        <p>Couldn't load the shopping list. Check the connection and try again.</p>
        <button type="button" className="button" onClick={() => void list.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return <p role="status">Loading the shopping list…</p>;
}

/** PLAN-9 (docs/mockups/SharedListExpired.dc.html): the same page for an expired link and one that never existed. */
function LinkExpired() {
  return (
    <div className="empty-state">
      <div className="empty-state-icon empty-state-icon-quiet" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h1>This link has expired</h1>
      <p className="muted">Shopping list links work for 7 days. Ask for a new one.</p>
      <Link to="/" className="button button-primary">
        Browse recipes
      </Link>
    </div>
  );
}
