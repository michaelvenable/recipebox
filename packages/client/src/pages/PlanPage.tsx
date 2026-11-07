import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ToMakeEntry } from "@recipebox/shared";
import { Link } from "react-router";
import { planKeys } from "../api/query-keys.js";
import { fetchPlan } from "../api/recipes.js";
import { formatRecentDay, localDayKey } from "../recipes/dates.js";
import { focusIsUnclaimed } from "../recipes/focus.js";
import { Thumbnail } from "../recipes/RecipeCard.js";
import {
  changeErrorMessage,
  clearFailedPlanRemovals,
  useFailedPlanRemoval,
  usePendingPlanRemovals,
  useRecipeChange,
} from "../recipes/recipe-changes.js";
import { useNow } from "../recipes/use-now.js";

/** Where focus goes once a removed entry has left the list: the remove button now in its place, or the one before it. */
interface FocusRequest {
  removedId: string;
  index: number;
  pressed: Element;
}

/**
 * The to-make list at /plan (PLAN-3): oldest first as the server sends it, each entry linking to its recipe, with a button to
 * take it off the list (PLAN-4). Editor-only (X-1), behind EditorOnly in routes.tsx. No reordering (out of scope).
 */
export function PlanPage() {
  const plan = useQuery({ queryKey: planKeys.all, queryFn: ({ signal }) => fetchPlan(signal) });
  const removing = usePendingPlanRemovals();
  const now = useNow();

  const queryClient = useQueryClient();
  // From the mutation cache, not from this page's own request: a removal started before leaving the list and coming back
  // still reports its failure here.
  const failure = useFailedPlanRemoval();
  const failedEntry = failure === undefined ? undefined : plan.data?.find((entry) => entry.id === failure.id);
  const problem =
    failure !== undefined && failedEntry !== undefined
      ? { key: failure.mutationId, text: `Couldn't remove ${failedEntry.name} from the list. ${changeErrorMessage(failure.error)}` }
      : undefined;
  const problemMessage = useRef<HTMLParagraphElement>(null);
  const [focus, setFocus] = useState<FocusRequest>();
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const browseLink = useRef<HTMLAnchorElement>(null);

  // An entry being removed leaves the list at once, and comes back if the removal fails.
  const visible = plan.data?.filter((entry) => !removing.has(entry.id));

  useEffect(() => {
    if (focus === undefined || visible === undefined) return;
    // Failed: the entry is back, and there is nowhere to move focus to.
    if (failure?.id === focus.removedId) return setFocus(undefined);
    if (visible.some((entry) => entry.id === focus.removedId)) return;
    setFocus(undefined);
    if (!focusIsUnclaimed(focus.pressed)) return;
    const next = visible[focus.index] ?? visible[focus.index - 1];
    if (next === undefined) browseLink.current?.focus();
    else removeButtons.current.get(next.id)?.focus();
  }, [focus, visible, failure?.id]);

  const removal: RemovalHandlers = {
    started: (entry, pressed) => {
      // The editor has moved on from an earlier failure.
      clearFailedPlanRemovals(queryClient);
      setFocus({ removedId: entry.id, index: visible?.findIndex((e) => e.id === entry.id) ?? 0, pressed });
    },
  };

  const problemKey = problem?.key;
  useEffect(() => {
    // The entry is back, but the button that was pressed is gone: focus the message rather than leave it on the page.
    if (problemKey !== undefined && focusIsUnclaimed(null)) problemMessage.current?.focus();
  }, [problemKey]);

  return (
    <div className="plan-page">
      <header className="list-page-header">
        <h1>Plan</h1>
        {visible !== undefined && visible.length > 0 && <p className="muted">{countLabel(visible.length)}</p>}
      </header>
      {problem !== undefined && (
        <p ref={problemMessage} className="form-error" role="alert" tabIndex={-1}>
          {problem.text}
        </p>
      )}
      <PlanContents
        entries={plan.data}
        visible={visible}
        failed={plan.isError}
        retry={() => void plan.refetch()}
        today={localDayKey(now)}
        removal={removal}
        removeButtons={removeButtons.current}
        browseLink={browseLink}
      />
    </div>
  );
}

function countLabel(count: number): string {
  return count === 1 ? "1 recipe" : `${count} recipes`;
}

interface RemovalHandlers {
  started: (entry: ToMakeEntry, pressed: Element) => void;
}

interface PlanContentsProps {
  entries: ToMakeEntry[] | undefined;
  visible: ToMakeEntry[] | undefined;
  failed: boolean;
  retry: () => void;
  today: string;
  removal: RemovalHandlers;
  removeButtons: Map<string, HTMLButtonElement>;
  browseLink: RefObject<HTMLAnchorElement | null>;
}

function PlanContents({ entries, visible, failed, retry, today, removal, removeButtons, browseLink }: PlanContentsProps) {
  if (entries === undefined || visible === undefined) {
    if (failed) {
      return (
        <div className="card stack" role="alert">
          <p>Couldn't load the plan. Check the connection and try again.</p>
          <button type="button" className="button" onClick={retry}>
            Try again
          </button>
        </div>
      );
    }
    return <p role="status">Loading the list…</p>;
  }
  if (visible.length === 0) return <EmptyPlan browseLink={browseLink} />;
  return (
    <ul className="entry-cards" aria-label="Plan">
      {visible.map((entry) => (
        <PlanRow
          key={entry.id}
          entry={entry}
          today={today}
          removal={removal}
          buttonRef={(button) => {
            if (button === null) removeButtons.delete(entry.id);
            else removeButtons.set(entry.id, button);
          }}
        />
      ))}
    </ul>
  );
}

/** PLAN-3: an empty list says so (docs/mockups/ToMakeEmpty.dc.html). */
function EmptyPlan({ browseLink }: { browseLink: RefObject<HTMLAnchorElement | null> }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
      </div>
      <h2>Nothing planned yet</h2>
      <Link ref={browseLink} to="/" className="button button-primary">
        Browse recipes
      </Link>
    </div>
  );
}

interface PlanRowProps {
  entry: ToMakeEntry;
  today: string;
  removal: RemovalHandlers;
  buttonRef: (button: HTMLButtonElement | null) => void;
}

/** Thumbnail, name and "Added Oct 12", linking to the recipe, and a round remove button (docs/mockups/ToMake.dc.html). */
function PlanRow({ entry, today, removal, buttonRef }: PlanRowProps) {
  // The recipe's own change lock, shared with the recipe view: no removal while another change to it is being saved.
  const { mutation, busy } = useRecipeChange(entry.id);

  function onRemove(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    removal.started(entry, event.currentTarget);
    // The row leaves at once (usePendingPlanRemovals); the caches and any failure are in the query client
    // (recipe-changes.ts), so nothing here waits for the answer.
    mutation.mutate({ kind: "removeFromPlan" });
  }

  return (
    <li className="entry-card">
      <Link to={`/recipes/${encodeURIComponent(entry.id)}`} className="entry-card-link">
        <Thumbnail recipe={entry} />
        <span className="recipe-card-text">
          <span className="recipe-card-name">{entry.name}</span>
          <span className="recipe-card-meta">Added {formatRecentDay(entry.addedAt, today)}</span>
        </span>
      </Link>
      <button
        ref={buttonRef}
        type="button"
        className="round-button"
        aria-label={`Remove ${entry.name} from the plan`}
        disabled={busy}
        onClick={onRemove}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}
