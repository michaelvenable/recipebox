// Short messages that outlive the page that started them, such as "Pad Thai moved to trash" with Undo after deleting, which is
// shown on the recipe list the app goes to (REC-6, docs/mockups/DeletedUndo.dc.html). The layout keeps them, above the routes.
// "A new version is available" (X-4) shows here too, below any of those. "‹name› imported" (IMP-10) waits its turn instead of
// replacing what is shown, so when several imports finish close together each message is seen, one after another.
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
  /** "Photo uploaded. …", after starting an import (IMP-4). Replaces any message shown. */
  uploaded: () => void;
  /** "‹name› imported", with Open (IMP-10). Shown after the message on screen, and after any other import's before it. */
  imported: (recipe: NamedRecipe) => void;
}

type Imported = NamedRecipe & { seq: number; kind: "imported" };
type Notice =
  | (NamedRecipe & { seq: number } & ({ kind: "deleted" } | { kind: "restored"; takeFocus: boolean }))
  | { seq: number; kind: "uploaded" }
  | Imported;

interface NoticeState {
  /** The message shown. */
  current: Notice | undefined;
  /** "‹name› imported" messages waiting to be shown, oldest first (IMP-10). */
  waiting: readonly Imported[];
}

/**
 * Another message in place of the one shown. An import's message it pushes aside goes back to the front of the queue, so it
 * is still seen (IMP-10); any other is replaced, as before.
 */
function replaced(state: NoticeState, notice: Notice): NoticeState {
  const waiting = state.current?.kind === "imported" ? [state.current, ...state.waiting] : state.waiting;
  return { current: notice, waiting };
}

const NO_NOTICES: NoticeState = { current: undefined, waiting: [] };

const NoticesContext = createContext<Notices>({ deleted: () => {}, restored: () => {}, uploaded: () => {}, imported: () => {} });
const NoticeStateContext = createContext<{ notice: Notice | undefined; dismiss: (seq: number) => void } | null>(null);

/** Shows messages that outlive the page that asked for them. */
export function useNotices(): Notices {
  return useContext(NoticesContext);
}

/** Keeps the message being shown; NoticeRegion shows it. In the layout, so it survives going to another page. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<NoticeState>(NO_NOTICES);
  const seq = useRef(0);
  const notices = useMemo<Notices>(() => {
    const show = (notice: Notice) => setShown((state) => replaced(state, notice));
    return {
      deleted: ({ id, name }) => show({ kind: "deleted", id, name, seq: ++seq.current }),
      restored: ({ id, name }, { takeFocus }) => show({ kind: "restored", id, name, takeFocus, seq: ++seq.current }),
      uploaded: () => show({ kind: "uploaded", seq: ++seq.current }),
      imported: ({ id, name }) => {
        const notice: Imported = { kind: "imported", id, name, seq: ++seq.current };
        setShown((state) =>
          state.current === undefined ? { current: notice, waiting: state.waiting } : { ...state, waiting: [...state.waiting, notice] },
        );
      },
    };
  }, []);
  // Only the message it was for: a newer one stays. The next waiting one, if any, takes its place.
  const dismiss = useCallback(
    (done: number) =>
      setShown((state) => (state.current?.seq === done ? { current: state.waiting[0], waiting: state.waiting.slice(1) } : state)),
    [],
  );
  const notice = shown.current;
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
      {notice?.kind === "uploaded" && <UploadedNotice key={notice.seq} notice={notice} dismiss={dismiss} />}
      {notice?.kind === "imported" && <ImportedNotice key={notice.seq} notice={notice} dismiss={dismiss} />}
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

/** IMP-4, docs/mockups/ImportReading.dc.html: no action, so there is nothing to reach for but the text. */
function UploadedNotice({ notice, dismiss }: NoticeProps<"uploaded">) {
  const { held, handlers } = useHeld();
  const close = useCallback(() => dismiss(notice.seq), [dismiss, notice.seq]);
  useAutoDismiss(close, held);
  return (
    <div className="notice notice-plain" {...handlers}>
      <span className="notice-text">Photo uploaded. Your recipe will be added to the Catalog in a minute or two.</span>
    </div>
  );
}

/** IMP-10, docs/mockups/ImportReady.dc.html. Open goes to the recipe; closing, either way, lets the next one show. */
function ImportedNotice({ notice, dismiss }: NoticeProps<"imported">) {
  const { held, handlers } = useHeld();
  const close = useCallback(() => dismiss(notice.seq), [dismiss, notice.seq]);
  useAutoDismiss(close, held);
  return (
    <div className="notice" {...handlers}>
      <span className="notice-text">{notice.name} imported</span>
      <Link to={`/recipes/${encodeURIComponent(notice.id)}`} className="notice-action" onClick={close}>
        Open
      </Link>
    </div>
  );
}
