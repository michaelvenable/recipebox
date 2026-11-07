import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import type { TrashEntry } from "@recipebox/shared";
import { recipeKeys, trashKeys } from "../api/query-keys.js";
import { fetchTrash } from "../api/recipes.js";
import { useNotices } from "../layout/notices.js";
import { formatRecentDay, localDayKey, trashTimeLeft } from "../recipes/dates.js";
import { focusIsUnclaimed } from "../recipes/focus.js";
import { Thumbnail } from "../recipes/RecipeCard.js";
import { changeErrorMessage } from "../recipes/recipe-changes.js";
import { isBeyondRestore, useExpiredTrash, useRestoreRecipe } from "../recipes/trash-changes.js";
import { useNow } from "../recipes/use-now.js";

interface Problem {
  text: string;
  /** Move focus to the message, because the entry whose Restore was pressed is gone. */
  takeFocus: boolean;
}

/**
 * The trash at /trash (REC-14): deleted recipes, most recently deleted first as the server sends them, each with Restore
 * (REC-15). Editor-only (X-1), behind EditorOnly in routes.tsx. There is no "Delete forever" or "Empty trash" (out of scope).
 * Entries aren't links: a recipe in the trash can't be opened (REC-4), only restored and then opened.
 */
export function TrashPage() {
  const trash = useQuery({ queryKey: trashKeys.all, queryFn: ({ signal }) => fetchTrash(signal) });
  const expired = useExpiredTrash();
  const now = useNow();
  const notices = useNotices();

  const [problem, setProblem] = useState<Problem>();
  const problemMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem?.takeFocus) problemMessage.current?.focus();
  }, [problem]);

  const restoring: RestoreHandlers = {
    started: () => setProblem(undefined),
    // The entry leaves the list; the message offers the recipe (layout/notices.tsx).
    restored: (entry, pressed) => notices.restored(entry, { takeFocus: focusIsUnclaimed(pressed) }),
    failed: (entry, error, pressed) =>
      setProblem({
        text: `Couldn't restore ${entry.name}. ${changeErrorMessage(error)}`,
        // REC-16: an expired or already removed entry leaves the list with the server's message; any other failure keeps it,
        // to try again.
        takeFocus: isBeyondRestore(error) && focusIsUnclaimed(pressed),
      }),
  };

  const entries = trash.data?.filter((entry) => !expired.has(entry.id));

  return (
    <div className="trash-page">
      <h1>Trash</h1>
      {problem !== undefined && (
        <p ref={problemMessage} className="form-error" role="alert" tabIndex={-1}>
          {problem.text}
        </p>
      )}
      <TrashContents
        entries={entries}
        failed={trash.isError}
        retry={() => void trash.refetch()}
        now={now}
        restoring={restoring}
      />
    </div>
  );
}

interface RestoreHandlers {
  started: () => void;
  restored: (entry: TrashEntry, pressed: Element) => void;
  failed: (entry: TrashEntry, error: unknown, pressed: Element) => void;
}

interface TrashContentsProps {
  entries: TrashEntry[] | undefined;
  failed: boolean;
  retry: () => void;
  now: Date;
  restoring: RestoreHandlers;
}

function TrashContents({ entries, failed, retry, now, restoring }: TrashContentsProps) {
  if (entries === undefined) {
    if (failed) {
      return (
        <div className="card stack" role="alert">
          <p>Couldn't load the trash. Check the connection and try again.</p>
          <button type="button" className="button" onClick={retry}>
            Try again
          </button>
        </div>
      );
    }
    return <p role="status">Loading trash…</p>;
  }
  if (entries.length === 0) {
    return (
      <div className="card">
        <p>The trash is empty.</p>
      </div>
    );
  }
  const today = localDayKey(now);
  return (
    <ul className="trash-list" aria-label="Deleted recipes">
      {entries.map((entry) => (
        <TrashRow key={entry.id} entry={entry} now={now} today={today} restoring={restoring} />
      ))}
    </ul>
  );
}

interface TrashRowProps {
  entry: TrashEntry;
  now: Date;
  today: string;
  restoring: RestoreHandlers;
}

/** Thumbnail, name, "Deleted Oct 21 · 21 days left" and Restore (REC-14, docs/mockups/Trash.dc.html). */
function TrashRow({ entry, now, today, restoring }: TrashRowProps) {
  const restore = useRestoreRecipe(entry.id);
  const busy = useIsMutating({ mutationKey: recipeKeys.change(entry.id) }) > 0;

  function onRestore(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const pressed = event.currentTarget;
    restoring.started();
    // These run only while the trash is still shown; the cache is updated either way (trash-changes.ts).
    restore.mutate(undefined, {
      onSuccess: () => restoring.restored(entry, pressed),
      onError: (error) => restoring.failed(entry, error, pressed),
    });
  }

  return (
    <li className="trash-entry">
      <Thumbnail recipe={entry} />
      <span className="recipe-card-text">
        <span className="recipe-card-name">{entry.name}</span>
        <span className="recipe-card-meta">
          Deleted {formatRecentDay(entry.deletedAt, today)} · {trashTimeLeft(entry, now)}
        </span>
      </span>
      <button type="button" className="button button-small trash-restore" aria-label={`Restore ${entry.name}`} disabled={busy} onClick={onRestore}>
        Restore
      </button>
    </li>
  );
}
