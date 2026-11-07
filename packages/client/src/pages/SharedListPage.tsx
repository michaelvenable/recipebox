import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/client.js";
import { sharedListKeys } from "../api/query-keys.js";
import { fetchSharedList } from "../api/shopping-lists.js";
import { formatWeekdayDate } from "../recipes/dates.js";
import { ShoppingItems, lineKeys, summary, useTicks } from "../recipes/ShoppingItems.js";

/**
 * A shopping list link at /list/{token} (PLAN-9, docs/mockups/SharedList.dc.html), for anyone with the link, signed in or not:
 * the current shopping list, with the date the link stops working. The link is live, so the list is loaded again when the
 * page loads and when the person comes back to it. Ticks are this page's own and never saved (PLAN-8); a tick stays on its
 * line while that line is on the list.
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
    // PLAN-9: changes to the plan appear when the person comes back to the page (window focus or the tab becoming visible).
    // Explicit, so a later change to the app's defaults can't switch it off.
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const { ticks, toggle, keepOnly } = useTicks();
  const items = list.data?.items;

  // A tick goes with its line: if the line leaves the list and comes back later, it comes back unticked.
  useEffect(() => {
    if (items !== undefined) keepOnly(lineKeys(items));
  }, [items, keepOnly]);

  // PLAN-9: the server answers 404 alike for an expired link and one that never existed. Checked before the list, so a page
  // left open past the 7 days shows the expired page when the person comes back, instead of the list it had.
  const expired = list.error instanceof ApiError && list.error.status === 404;
  if (expired) return <LinkExpired />;

  if (list.data !== undefined) {
    const { items, expiresAt } = list.data;
    // Any other failed reload (no connection, a server error) keeps the last list and its ticks, with a note.
    const notRefreshed = list.isError;
    return (
      <div className="shopping-page">
        <header className="list-page-header">
          <h1>Shopping list</h1>
          {items.length > 0 && <p className="muted">{summary(items)}</p>}
          <p className="muted shared-list-until">This link works until {formatWeekdayDate(expiresAt)}.</p>
          {notRefreshed && (
            <p role="status" className="shared-list-stale">
              Couldn't refresh the list, so it may be out of date. Check the connection.
            </p>
          )}
        </header>
        {items.length === 0 ? (
          // PLAN-9: the plan is empty for now; the link still works, and a later visit may find items.
          <p className="card shared-list-empty">Nothing to shop for right now.</p>
        ) : (
          <ShoppingItems items={items} ticks={ticks} toggle={toggle} />
        )}
      </div>
    );
  }
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
