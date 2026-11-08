// Imports from a photo in progress (IMP-5) and finishing (IMP-10), for the whole app. The layout keeps this, so the checking
// goes on, and "‹name› imported" shows, on whatever page the editor is on.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportStatus } from "@recipebox/shared";
import { fetchImports, startImport } from "../api/imports.js";
import { importKeys, recipeKeys, tagKeys } from "../api/query-keys.js";
import { useViewer } from "../auth/sign-in.js";
import { useNotices } from "../layout/notices.js";

/** How often GET /imports is read again while an import is in progress (docs/architecture.md, "Recipe import"). */
export const IMPORT_POLL_MS = 5_000;

type Reading = Extract<ImportStatus, { status: "reading" }>;

interface Imports {
  /** The imports in progress, newest first as the server lists them (IMP-5). Always empty for anyone but an editor (X-1). */
  reading: readonly Reading[];
  /** Keeps GET /imports read while the returned function hasn't been called, as the Catalog does while it is open. */
  watch: () => () => void;
  /** An import this device has just started (IMP-4): its card shows at once, and its end is watched for from any page. */
  started: (status: ImportStatus) => void;
}

const NO_READING: readonly Reading[] = [];

const ImportsContext = createContext<Imports>({ reading: NO_READING, watch: () => () => {}, started: () => {} });

function isReading(status: ImportStatus): status is Reading {
  return status.status === "reading";
}

/**
 * Reads GET /imports for an editor while the Catalog is open or this device has an import in progress, and again every
 * IMPORT_POLL_MS while any import is in progress; never for a visitor or non-editor (X-1).
 *
 * The imports this device started are remembered in memory only, never in localStorage or sessionStorage (X-15, the Privacy
 * page's promise), so a reload forgets them and their end goes without a message. When one is done, "‹name› imported" shows
 * (IMP-10); a failed one just ends, with no message (IMP-11). The server reports an import still reading after 10 minutes as
 * failed, so every one ends and the checking stops.
 */
export function ImportsProvider({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  const isEditor = viewer === "editor";
  const queryClient = useQueryClient();
  const notices = useNotices();

  const [watchers, setWatchers] = useState(0);
  // This device's imports in progress, each with when it was added, on the same count as the reads of GET /imports below.
  const ours = useRef(new Map<string, number>());
  const [oursInProgress, setOursInProgress] = useState(0);
  // Orders uploads and reads: each read of GET /imports and each started import takes the next number.
  const tick = useRef(0);
  // When each answer of GET /imports was asked for, by the answer itself. Data put in the cache by `started` isn't here.
  const askedAt = useRef(new WeakMap<readonly ImportStatus[], number>());
  // Imports seen in progress, so the recipe lists are reloaded when one of them is done, whichever device started it.
  const seenReading = useRef(new Set<string>());

  const imports = useQuery({
    queryKey: importKeys.all,
    queryFn: async ({ signal }) => {
      const asked = ++tick.current;
      const list = await fetchImports(signal);
      askedAt.current.set(list, asked);
      return list;
    },
    // Each answer stays its own array, so askedAt tells when it was asked for even if it equals the one before.
    structuralSharing: false,
    enabled: isEditor && (watchers > 0 || oursInProgress > 0),
    refetchInterval: (query) => (oursInProgress > 0 || (query.state.data ?? []).some(isReading) ? IMPORT_POLL_MS : false),
  });

  useEffect(() => {
    const list = imports.data;
    if (list === undefined) return;
    let finished = false;
    for (const item of list) {
      if (item.status === "reading") {
        seenReading.current.add(item.importId);
        continue;
      }
      // Each removal happens once, so each message is shown once, however often this runs.
      const wasReading = seenReading.current.delete(item.importId);
      const mine = ours.current.delete(item.importId);
      if (item.status === "done") {
        if (wasReading || mine) finished = true;
        if (mine) notices.imported({ id: item.recipeId, name: item.recipeName });
      }
    }
    // One of ours the server doesn't list has ended, such as a record past its one day (IMP-5): forgotten without a message, as
    // for a failed import (IMP-11), so the checking stops. Only by an answer asked for after it was added: one asked for
    // before the upload was answered may well not list it yet.
    const asked = askedAt.current.get(list);
    if (asked !== undefined) {
      for (const [importId, added] of ours.current) {
        if (asked > added && !list.some((item) => item.importId === importId)) ours.current.delete(importId);
      }
    }
    setOursInProgress(ours.current.size);
    if (finished) {
      // The new recipe is an ordinary one now (IMP-7): it belongs in the lists, and its tags in the counts.
      void queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
    }
  }, [imports.data, notices, queryClient]);

  const watch = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);

  const started = useCallback(
    (status: ImportStatus) => {
      ours.current.set(status.importId, ++tick.current);
      setOursInProgress(ours.current.size);
      void (async () => {
        // A read already on its way may have left before the upload was stored; its answer mustn't hide the new card.
        await queryClient.cancelQueries({ queryKey: importKeys.all });
        queryClient.setQueryData<ImportStatus[]>(importKeys.all, (list = []) => [
          status,
          ...list.filter((item) => item.importId !== status.importId),
        ]);
        void queryClient.invalidateQueries({ queryKey: importKeys.all });
      })();
    },
    [queryClient],
  );

  const data = imports.data;
  const reading = useMemo(() => (isEditor && data !== undefined ? data.filter(isReading) : NO_READING), [isEditor, data]);
  const value = useMemo<Imports>(() => ({ reading, watch, started }), [reading, watch, started]);
  return <ImportsContext value={value}>{children}</ImportsContext>;
}

/** The imports in progress, for the Catalog's cards (IMP-5). Keeps them checked while the caller is shown. */
export function useReadingImports(): readonly Reading[] {
  const { reading, watch } = useContext(ImportsContext);
  useEffect(() => watch(), [watch]);
  return reading;
}

/** POST /imports (IMP-1, IMP-3, IMP-4). Once the photo is uploaded, the import is watched from any page, even if the form has gone. */
export function useStartImport() {
  const { started } = useContext(ImportsContext);
  return useMutation({
    mutationKey: importKeys.start(),
    mutationFn: (file: File) => startImport(file),
    onSuccess: (status) => started(status),
  });
}
