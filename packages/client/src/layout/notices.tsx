// Short messages that outlive the page that started them, such as "Pad Thai moved to trash" with Undo after deleting, which is
// shown on the recipe list the app goes to (REC-6, docs/mockups/DeletedUndo.dc.html). The layout keeps them, above the routes.
// "A new version is available" (X-4) shows here too, below any of those.
import {
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsMutating } from "@tanstack/react-query";
import { Link } from "react-router";
import { recipeKeys } from "../api/query-keys.js";
import { useAppUpdate } from "../pwa/service-worker.js";
import { focusIsUnclaimed } from "../recipes/focus.js";
import { changeErrorMessage } from "../recipes/recipe-changes.js";
import { useRestoreRecipe } from "../recipes/trash-changes.js";

/** How long a message stays when nobody points at or focuses it. REC-6 asks for at least 10 seconds. */
export const NOTICE_MS = 10_000;
/** Time left after pointing or focus moves away, at least, so a message doesn't vanish the moment it is let go. */
const RESUME_MS = 4_000;

interface NamedRecipe {
  id: string;
  name: string;
}

export interface Notices {
  /** "‹name› moved to trash", with Undo (REC-6). Replaces any message shown. */
  deleted: (recipe: NamedRecipe) => void;
  /** "‹name› restored", with a link to it (REC-15). `takeFocus` moves focus to the link, for when the pressed control is gone. */
  restored: (recipe: NamedRecipe, options: { takeFocus: boolean }) => void;
}

type Notice = NamedRecipe & { seq: number } & ({ kind: "deleted" } | { kind: "restored"; takeFocus: boolean });

const NoticesContext = createContext<Notices>({ deleted: () => {}, restored: () => {} });
const NoticeStateContext = createContext<{ notice: Notice | undefined; dismiss: (seq: number) => void } | null>(null);

/** Shows messages that outlive the page that asked for them. */
export function useNotices(): Notices {
  return useContext(NoticesContext);
}

/** Keeps the message being shown; NoticeRegion shows it. In the layout, so it survives going to another page. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>();
  const seq = useRef(0);
  const notices = useMemo<Notices>(
    () => ({
      deleted: ({ id, name }) => setNotice({ kind: "deleted", id, name, seq: ++seq.current }),
      restored: ({ id, name }, { takeFocus }) => setNotice({ kind: "restored", id, name, takeFocus, seq: ++seq.current }),
    }),
    [],
  );
  // Only the message it was for: a newer one stays.
  const dismiss = useCallback((done: number) => setNotice((current) => (current?.seq === done ? undefined : current)), []);
  const state = useMemo(() => ({ notice, dismiss }), [notice, dismiss]);
  return (
    <NoticesContext value={notices}>
      <NoticeStateContext value={state}>{children}</NoticeStateContext>
    </NoticesContext>
  );
}

/**
 * Where messages appear: a live region, always present so screen readers announce what is put in it. It comes before the page
 * in the document, so Undo is a few Tab presses away rather than after the whole list; on screen it floats at the bottom.
 */
export function NoticeRegion() {
  const state = useContext(NoticeStateContext);
  if (state === null) throw new Error("NoticeRegion must be inside NoticeProvider.");
  const { notice, dismiss } = state;
  return (
    <div role="status" className="notice-region">
      {notice?.kind === "deleted" && <DeletedNotice key={notice.seq} notice={notice} dismiss={dismiss} />}
      {notice?.kind === "restored" && <RestoredNotice key={notice.seq} notice={notice} dismiss={dismiss} />}
      <UpdateNotice />
    </div>
  );
}

/**
 * "A new version is available" with Reload (X-4), once a new version of the app has been installed in the background. It stays
 * until the user reloads: the app never reloads on its own, so nobody loses what they were typing.
 */
function UpdateNotice() {
  const { available, updates } = useAppUpdate();
  if (!available || updates === undefined) return null;
  return (
    <div className="notice">
      <span className="notice-text">A new version is available</span>
      <button type="button" className="notice-action" onClick={() => updates.apply()}>
        Reload
      </button>
    </div>
  );
}

/**
 * Closes the message after NOTICE_MS, but not while it is paused: pointed at, focused, or waiting for a restore. Time spent
 * paused doesn't count, so the message never goes while someone is reaching for it.
 */
function useAutoDismiss(close: () => void, paused: boolean) {
  const remaining = useRef(NOTICE_MS);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(RESUME_MS, remaining.current - (Date.now() - started));
    };
  }, [paused, close]);
}

/** Whether the pointer is over the message or focus is in it. */
function useHeld() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    },
  };
  return { held: hovered || focused, handlers };
}

interface NoticeProps<K extends Notice["kind"]> {
  notice: Extract<Notice, { kind: K }>;
  dismiss: (seq: number) => void;
}

function DeletedNotice({ notice, dismiss }: NoticeProps<"deleted">) {
  const notices = useNotices();
  const restore = useRestoreRecipe(notice.id);
  // Any change to this recipe, including the delete just finishing: Undo waits for it.
  const busy = useIsMutating({ mutationKey: recipeKeys.change(notice.id) }) > 0;
  const { held, handlers } = useHeld();
  const close = useCallback(() => dismiss(notice.seq), [dismiss, notice.seq]);
  useAutoDismiss(close, held || busy);

  function undo(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const pressed = event.currentTarget;
    // Runs only while this message is still shown: a newer one has replaced it otherwise.
    restore.mutate(undefined, { onSuccess: () => notices.restored(notice, { takeFocus: focusIsUnclaimed(pressed) }) });
  }

  return (
    <div className="notice" {...handlers}>
      <span className="notice-text">
        {restore.isError ? `Couldn't restore ${notice.name}. ${changeErrorMessage(restore.error)}` : `${notice.name} moved to trash`}
      </span>
      {/* aria-disabled rather than disabled while waiting, so it keeps focus, and with it the message. */}
      <button type="button" className="notice-action" aria-disabled={busy || undefined} onClick={undo}>
        Undo
      </button>
    </div>
  );
}

function RestoredNotice({ notice, dismiss }: NoticeProps<"restored">) {
  const { held, handlers } = useHeld();
  const close = useCallback(() => dismiss(notice.seq), [dismiss, notice.seq]);
  useAutoDismiss(close, held);
  const link = useRef<HTMLAnchorElement>(null);
  const { takeFocus } = notice;
  useEffect(() => {
    if (takeFocus) link.current?.focus();
  }, [takeFocus]);

  return (
    <div className="notice" {...handlers}>
      <span className="notice-text">{notice.name} restored</span>
      <Link ref={link} to={`/recipes/${encodeURIComponent(notice.id)}`} className="notice-action" onClick={close}>
        Open recipe
      </Link>
    </div>
  );
}
