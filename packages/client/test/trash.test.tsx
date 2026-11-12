import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorRecipe, EditorRecipeSummary, Me, TagCount, TrashEntry } from "@recipebox/shared";
import { planKeys, rediscoverKeys, trashKeys } from "../src/api/query-keys.js";
import { NOTICE_MS } from "../src/layout/notices.js";
import { API, EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const PAD_THAI_ID = "0b6a3c2e-0000-4000-8000-000000000002";
const STEW_ID = "0b6a3c2e-0000-4000-8000-000000000001";
const BREAD_ID = "0b6a3c2e-0000-4000-8000-000000000004";
const STROGANOFF_ID = "0b6a3c2e-0000-4000-8000-000000000005";

const DAY = 86_400_000;

const PAD_THAI: EditorRecipe = {
  id: PAD_THAI_ID,
  name: "Pad Thai",
  ingredients: ["200 g flat rice noodles", "2 eggs"],
  steps: ["Soak the noodles.", "Fry everything."],
  totalTimeMinutes: 30,
  tags: ["dinner", "noodles"],
  hasPhoto: true,
  toMake: { addedAt: "2026-10-01T12:00:00.000Z" },
  cookedAt: ["2026-09-02T18:00:00.000Z"],
  lastCookedAt: "2026-09-02T18:00:00.000Z",
  timesCooked: 1,
};
const BEEF_STEW: EditorRecipe = {
  id: STEW_ID,
  name: "Beef Stew",
  ingredients: ["Beef"],
  steps: ["Stew it."],
  tags: ["dinner"],
  hasPhoto: false,
  cookedAt: [],
  timesCooked: 0,
};

const ERROR_EXPIRED = {
  errors: [{ code: "trash.expired", message: "This recipe has been in the trash for 30 days and can no longer be restored." }],
};
const NOT_FOUND = { errors: [{ code: "recipe.notFound", message: "This recipe doesn't exist." }] };

/** A stored time, written as the server would (UTC), for a local date and time on this device. */
function at(year: number, monthIndex: number, day: number, hours = 12, minutes = 0): Date {
  return new Date(year, monthIndex, day, hours, minutes);
}

/** A trash entry deleted at `deletedAt`, due for removal 30 days later, as the server computes it (REC-16). */
function trashed(id: string, name: string, deletedAt: Date, extra: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id,
    name,
    tags: [],
    hasPhoto: false,
    deletedAt: deletedAt.toISOString(),
    removalDueAt: new Date(deletedAt.getTime() + 30 * DAY).toISOString(),
    ...extra,
  };
}

type Answer = Response | Promise<Response> | undefined;

interface FakeServer {
  me?: Me;
  /** The recipes not in the trash. */
  live?: EditorRecipe[];
  /** GET /trash, in the server's order. */
  trash?: () => TrashEntry[] | Response | Promise<Response>;
  /** DELETE /recipes/{id}; by default the recipe leaves `live` and the answer is 204. */
  remove?: (id: string) => Answer;
  /** POST /trash/{id}/restore; by default the recipe comes back to `live`, off the to-make list (PLAN-6). */
  restore?: (id: string) => Answer;
  /** GET /recipes, to hold an answer back. */
  list?: () => Answer;
  /** GET /tags, to hold an answer back. */
  tags?: () => Answer;
}

function summary(recipe: EditorRecipe): EditorRecipeSummary {
  const { id, name, tags, hasPhoto, totalTimeMinutes } = recipe;
  return { id, name, tags, hasPhoto, ...(totalTimeMinutes === undefined ? {} : { totalTimeMinutes }), onToMakeList: recipe.toMake !== undefined };
}

function tagCounts(recipes: EditorRecipe[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const tag of recipes.flatMap((r) => r.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count }));
}

/** A small stand-in for the API, keeping which recipes are in the trash. */
function mockServer({ me = EDITOR, live: initial = [PAD_THAI, BEEF_STEW], trash, remove, restore, list, tags }: FakeServer = {}) {
  const live = [...initial];
  const deleted = new Map<string, EditorRecipe>();
  const fetchMock = mockApi(me, (url, init) => {
    const method = init.method ?? "GET";
    const path = url.pathname;
    const recipeMatch = /^\/recipes\/([^/]+)$/.exec(path);
    const restoreMatch = /^\/trash\/([^/]+)\/restore$/.exec(path);
    if (method === "GET" && path === "/recipes") {
      return list?.() ?? jsonResponse(200, [...live].sort((a, b) => a.name.localeCompare(b.name)).map(summary));
    }
    if (method === "GET" && path === "/tags") return tags?.() ?? jsonResponse(200, tagCounts(live));
    if (method === "GET" && path === "/trash") {
      const answer = trash?.() ?? [];
      return answer instanceof Response || answer instanceof Promise ? answer : jsonResponse(200, answer);
    }
    if (method === "GET" && recipeMatch !== null) {
      const recipe = live.find((r) => r.id === decodeURIComponent(recipeMatch[1] ?? ""));
      return recipe === undefined ? jsonResponse(404, NOT_FOUND) : jsonResponse(200, recipe);
    }
    if (method === "DELETE" && recipeMatch !== null) {
      const id = decodeURIComponent(recipeMatch[1] ?? "");
      const answer = remove?.(id);
      if (answer !== undefined) return answer;
      const index = live.findIndex((r) => r.id === id);
      if (index >= 0) {
        const [recipe] = live.splice(index, 1);
        // PLAN-6: deleting takes it off the to-make list.
        if (recipe !== undefined) deleted.set(id, { ...recipe, toMake: undefined });
      }
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && restoreMatch !== null) {
      const id = decodeURIComponent(restoreMatch[1] ?? "");
      const answer = restore?.(id);
      if (answer !== undefined) return answer;
      const recipe = deleted.get(id) ?? live.find((r) => r.id === id);
      if (recipe === undefined) return jsonResponse(404, NOT_FOUND);
      deleted.delete(id);
      if (!live.includes(recipe)) live.push(recipe);
      const { toMake: _offTheList, ...restored } = recipe;
      return jsonResponse(200, restored);
    }
    return undefined;
  });
  return { fetchMock, live };
}

interface SentRequest {
  method: string;
  path: string;
  body: string | undefined;
  contentType: string | undefined;
}

function changes(fetchMock: FetchMock): SentRequest[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") !== "GET")
    .map(([input, init]) => ({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      body: init?.body === undefined ? undefined : String(init.body),
      contentType: ((init?.headers ?? {}) as Record<string, string>)["content-type"],
    }));
}

function gets(fetchMock: FetchMock, path: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => (init?.method ?? "GET") === "GET" && new URL(String(input)).pathname === path)
    .length;
}

/** The device's clock (X-12). Timers are faked too, so tests can move time on; it also runs on by itself. */
function setClock(now: Date) {
  vi.useFakeTimers({ now, shouldAdvanceTime: true, toFake: ["Date", "setTimeout", "clearTimeout"] });
}

afterEach(() => {
  vi.useRealTimers();
});

async function openRecipe(server: FakeServer = {}, id = PAD_THAI_ID) {
  const fake = mockServer(server);
  const rendered = renderAt(`/recipes/${id}`);
  await screen.findByRole("heading", { level: 1 });
  await screen.findByRole("link", { name: (server.me ?? EDITOR).signedIn ? "Account" : "Sign in" });
  return { ...fake, ...rendered };
}

function notice(): HTMLElement {
  return screen.getByText(/moved to trash|restored|Couldn't restore/).closest(".notice") as HTMLElement;
}

describe("REC-6, X-8 Delete on the recipe view", () => {
  it("is offered to editors at the bottom, beside Edit", async () => {
    await openRecipe();
    const edit = screen.getByRole("link", { name: "Edit" });
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(edit.parentElement).toBe(remove.parentElement);
  });

  it.each([
    ["visitors", VISITOR],
    ["signed-in non-editors", NON_EDITOR],
  ])("is not offered to %s", async (_who, me) => {
    const { id, name, ingredients, steps, tags, hasPhoto } = PAD_THAI;
    const publicRecipe = { id, name, ingredients, steps, tags, hasPhoto };
    mockApi(me, (url) => (url.pathname === `/recipes/${PAD_THAI_ID}` ? jsonResponse(200, publicRecipe) : undefined));
    renderAt(`/recipes/${PAD_THAI_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Pad Thai" });
    await screen.findByRole("link", { name: me.signedIn ? "Account" : "Sign in" });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("deletes without asking, sending an empty body and no time (X-12), and goes to the list with the message", async () => {
    const { fetchMock, router } = await openRecipe();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Pad Thai moved to trash")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(changes(fetchMock)).toEqual([
      { method: "DELETE", path: `/recipes/${PAD_THAI_ID}`, body: "{}", contentType: "application/json" },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const status = screen.getByText("Pad Thai moved to trash").closest('[role="status"]');
    expect(status).not.toBeNull();
    expect(within(status as HTMLElement).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // The list as the server now has it.
    const list = await screen.findByRole("list", { name: "Recipes" });
    expect(within(list).queryByText("Pad Thai")).not.toBeInTheDocument();
    expect(within(list).getByText("Beef Stew")).toBeInTheDocument();
  });

  it("replaces the recipe's history entry, so Back doesn't lead to a recipe that is gone", async () => {
    mockServer();
    const { router } = renderAt("/");
    await screen.findByRole("link", { name: /Pad Thai/ });
    await userEvent.click(screen.getByRole("link", { name: /Pad Thai/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByText("Pad Thai moved to trash");
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("takes the recipe out of the cached list and tag counts at once, before they reload", async () => {
    // After the delete, the list and the tags don't answer: what shows is the cache.
    let hold = false;
    const held = () => (hold ? new Promise<Response>(() => {}) : undefined);
    const { fetchMock } = mockServer({ list: held, tags: held });
    const { router } = renderAt("/");
    await screen.findByRole("link", { name: /Pad Thai/ });
    expect(screen.getByRole("button", { name: "noodles" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /Pad Thai/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const tagLoads = gets(fetchMock, "/tags");
    hold = true;

    await screen.findByText("Pad Thai moved to trash");
    expect(router.state.location.pathname).toBe("/");
    // The message shows before the router has rendered the list (a navigation is a transition), so wait for it. The list
    // never answers again, so whatever list appears is the cache.
    const list = await screen.findByRole("list", { name: "Recipes" });
    expect(within(list).queryByText("Pad Thai")).not.toBeInTheDocument();
    expect(within(list).getByText("Beef Stew")).toBeInTheDocument();
    // The tags were asked for again, and are still waiting for the answer.
    await waitFor(() => expect(gets(fetchMock, "/tags")).toBeGreaterThan(tagLoads));
    // REC-13: a tag on no other recipe leaves the filter; a shared one counts one fewer.
    expect(screen.getByRole("button", { name: "dinner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /noodles/ })).not.toBeInTheDocument();
  });

  it("takes the recipe out of the Recently added row at once, before the list reloads (REC-22)", async () => {
    // Both added yesterday, by the device's clock; after the delete the list doesn't answer, so what shows is the cache.
    const yesterday = new Date(Date.now() - DAY).toISOString();
    let hold = false;
    const { live } = mockServer({
      list: () =>
        hold
          ? new Promise<Response>(() => {})
          : jsonResponse(
              200,
              [...live].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ ...summary(r), createdAt: yesterday })),
            ),
    });
    renderAt("/");
    const row = await screen.findByRole("list", { name: "Recently added" });
    expect(within(row).getAllByRole("link").map((link) => link.querySelector(".recent-card-name")?.textContent)).toEqual([
      "Beef Stew",
      "Pad Thai",
    ]);
    await userEvent.click(within(row).getByRole("link", { name: /Pad Thai/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    hold = true;

    await screen.findByText("Pad Thai moved to trash");
    // As above: wait for the list page to render; the list never answers again, so the row is from the cache.
    const after = await screen.findByRole("list", { name: "Recently added" });
    expect(within(after).queryByText("Pad Thai")).not.toBeInTheDocument();
    expect(within(after).getByText("Beef Stew")).toBeInTheDocument();
  });

  it("marks the to-make list, rediscovery and the trash stale (PLAN-6)", async () => {
    const { queryClient } = await openRecipe();
    queryClient.setQueryData(planKeys.all, [{ ...summary(PAD_THAI), addedAt: "2026-10-01T12:00:00.000Z" }]);
    queryClient.setQueryData(rediscoverKeys.all, [summary(BEEF_STEW)]);
    queryClient.setQueryData(trashKeys.all, []);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Pad Thai moved to trash");
    expect(queryClient.getQueryData(planKeys.all)).toEqual([]);
    expect(queryClient.getQueryState(planKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(rediscoverKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(trashKeys.all)?.isInvalidated).toBe(true);
  });

  it("shows not found when the deleted recipe is opened again, never the cached copy (REC-4, REC-17)", async () => {
    const { router } = await openRecipe();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Pad Thai moved to trash");

    await act(() => router.navigate(`/recipes/${PAD_THAI_ID}`));
    expect(screen.queryByRole("heading", { level: 1, name: "Pad Thai" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Recipe not found" })).toBeInTheDocument();
  });

  it("doesn't reload the recipe it is deleting before going to the list", async () => {
    const { fetchMock } = await openRecipe();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Pad Thai moved to trash");
    await screen.findByRole("list", { name: "Recipes" });
    expect(gets(fetchMock, `/recipes/${PAD_THAI_ID}`)).toBe(1);
    expect(screen.queryByRole("heading", { name: "Recipe not found" })).not.toBeInTheDocument();
  });

  it("waits for another change to the recipe, and the other actions wait for it (COOK-1)", async () => {
    let answer: (response: Response) => void = () => {};
    const { fetchMock } = await openRecipe({ remove: () => new Promise<Response>((resolve) => (answer = resolve)) });
    const remove = screen.getByRole("button", { name: "Delete" });
    await userEvent.dblClick(remove);
    expect(remove).toBeDisabled();
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeDisabled();
    expect(changes(fetchMock)).toHaveLength(1);
    answer(new Response(null, { status: 204 }));
    expect(await screen.findByText("Pad Thai moved to trash")).toBeInTheDocument();
  });

  it("stays where the editor went if they left before the delete was saved, and still shows the message", async () => {
    let answer: (response: Response) => void = () => {};
    const { router } = await openRecipe({ remove: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(() => router.navigate("/account"));
    answer(new Response(null, { status: 204 }));
    expect(await screen.findByText("Pad Thai moved to trash")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/account");
  });

  it("stays on the recipe and says why when the delete fails", async () => {
    const { router } = await openRecipe({ remove: () => jsonResponse(500, { errors: [] }) });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server couldn't make the change. Try again.");
    expect(router.state.location.pathname).toBe(`/recipes/${PAD_THAI_ID}`);
    expect(screen.queryByText(/moved to trash/)).not.toBeInTheDocument();
  });
});

describe("REC-6 the Undo message", () => {
  async function deleteFromView(server: FakeServer = {}) {
    const opened = await openRecipe(server);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Pad Thai moved to trash");
    return opened;
  }

  it(`stays for at least 10 seconds (${NOTICE_MS} ms), then goes`, async () => {
    setClock(at(2026, 10, 4, 18, 0));
    await deleteFromView();
    act(() => vi.advanceTimersByTime(9_900));
    expect(screen.getByText("Pad Thai moved to trash")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText("Pad Thai moved to trash")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("survives going to another page", async () => {
    setClock(at(2026, 10, 4, 18, 0));
    const { router } = await deleteFromView();
    await act(() => router.navigate("/plan"));
    expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Pad Thai moved to trash")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));
    expect(screen.queryByText("Pad Thai moved to trash")).not.toBeInTheDocument();
  });

  it("waits while pointed at, and gives a few more seconds after", async () => {
    setClock(at(2026, 10, 4, 18, 0));
    await deleteFromView();
    fireEvent.pointerEnter(notice());
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Pad Thai moved to trash")).toBeInTheDocument();
    fireEvent.pointerLeave(notice());
    act(() => vi.advanceTimersByTime(3_500));
    expect(screen.getByText("Pad Thai moved to trash")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.queryByText("Pad Thai moved to trash")).not.toBeInTheDocument();
  });

  it("waits while Undo has keyboard focus, and Undo is reachable with Tab", async () => {
    setClock(at(2026, 10, 4, 18, 0));
    await deleteFromView();
    const undo = screen.getByRole("button", { name: "Undo" });
    // From the top of the page: the navigation, then the message, before the list.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    for (let i = 0; i < 10 && document.activeElement !== undo; i++) await user.tab();
    expect(undo).toHaveFocus();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Pad Thai moved to trash")).toBeInTheDocument();
    act(() => undo.blur());
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.queryByText("Pad Thai moved to trash")).not.toBeInTheDocument();
  });

  it("restores the recipe with an empty body (X-12), as from the trash (REC-15), and offers to open it", async () => {
    const { fetchMock } = await deleteFromView();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Pad Thai restored")).toBeInTheDocument();
    expect(changes(fetchMock).at(-1)).toEqual({
      method: "POST",
      path: `/trash/${PAD_THAI_ID}/restore`,
      body: "{}",
      contentType: "application/json",
    });
    // Undo was pressed and is gone, so focus moves to the link that takes its place.
    const open = screen.getByRole("link", { name: "Open recipe" });
    expect(open).toHaveFocus();
    expect(open).toHaveAttribute("href", `/recipes/${PAD_THAI_ID}`);
    // Back in the list, which reloads.
    expect(await within(screen.getByRole("list", { name: "Recipes" })).findByText("Pad Thai")).toBeInTheDocument();
  });

  it("brings back content, photo, tags and history, but not the to-make mark (REC-15, PLAN-6)", async () => {
    await deleteFromView();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await userEvent.click(await screen.findByRole("link", { name: "Open recipe" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pad Thai photo" })).toBeInTheDocument();
    const tags = within(screen.getByRole("list", { name: "Tags" }));
    expect(tags.getByText("dinner")).toBeInTheDocument();
    expect(tags.getByText("noodles")).toBeInTheDocument();
    expect(screen.getByText(/cooked once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I want to cook this" })).toBeInTheDocument();
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
    // Opening it closes the message.
    expect(screen.queryByText("Pad Thai restored")).not.toBeInTheDocument();
  });

  it("marks the lists, tags, to-make list, rediscovery and trash stale when undone", async () => {
    const { queryClient } = await deleteFromView();
    queryClient.setQueryData(planKeys.all, []);
    queryClient.setQueryData(rediscoverKeys.all, []);
    queryClient.setQueryData(trashKeys.all, [trashed(PAD_THAI_ID, "Pad Thai", new Date())]);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Pad Thai restored");
    expect(queryClient.getQueryState(planKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(rediscoverKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(trashKeys.all)).toEqual([]);
    expect(queryClient.getQueryState(trashKeys.all)?.isInvalidated).toBe(true);
  });

  it("says so when Undo fails, keeps Undo to try again, and doesn't go while restoring", async () => {
    setClock(at(2026, 10, 4, 18, 0));
    let attempt = 0;
    let answer: (response: Response) => void = () => {};
    await deleteFromView({
      restore: () =>
        ++attempt === 1 ? jsonResponse(500, { errors: [] }) : new Promise<Response>((resolve) => (answer = resolve)),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't restore Pad Thai. The server couldn't make the change. Try again.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("aria-disabled", "true");
    act(() => undoBlur());
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await act(async () => answer(jsonResponse(200, { ...PAD_THAI, toMake: undefined })));
    expect(await screen.findByText("Pad Thai restored")).toBeInTheDocument();
  });

  it("is replaced by the message for the next recipe deleted", async () => {
    const { router } = await deleteFromView();
    await act(() => router.navigate(`/recipes/${STEW_ID}`));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Beef Stew moved to trash")).toBeInTheDocument();
    expect(screen.queryByText("Pad Thai moved to trash")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });
});

/** Takes focus off whatever has it, as moving elsewhere on the page would. */
function undoBlur() {
  (document.activeElement as HTMLElement | null)?.blur();
}

// The mockup's day (docs/mockups/Trash.dc.html): Oct 30, 2026, a few days before daylight saving time ends on Nov 1.
const OCT_30_NOON = at(2026, 9, 30, 12, 0);
const MOCKUP_TRASH = [
  trashed("pad-thai", "Pad Thai", at(2026, 9, 30, 9, 0), { hasPhoto: true }),
  trashed(STROGANOFF_ID, "Mushroom Stroganoff", at(2026, 9, 21, 18, 30)),
  trashed(BREAD_ID, "Banana Bread", at(2026, 9, 3, 8, 15)),
];

async function openTrash(server: FakeServer) {
  const fake = mockServer(server);
  const rendered = renderAt("/trash");
  await screen.findByRole("heading", { level: 1, name: "Trash" });
  return { ...fake, ...rendered };
}

function entryLines(): string[] {
  return within(screen.getByRole("list", { name: "Deleted recipes" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".recipe-card-text")?.textContent ?? "");
}

describe("REC-14 trash", () => {
  it("lists deleted recipes in the server's order with the date deleted and days left, as in the mockup", async () => {
    setClock(OCT_30_NOON);
    await openTrash({ trash: () => MOCKUP_TRASH });
    expect(screen.queryByText(/Deleted recipes stay here for 30 days/)).not.toBeInTheDocument();
    await screen.findByRole("list", { name: "Deleted recipes" });
    expect(entryLines()).toEqual([
      "Pad ThaiDeleted today · 30 days left",
      "Mushroom StroganoffDeleted Oct 21 · 21 days left",
      "Banana BreadDeleted Oct 3 · 3 days left",
    ]);
  });

  it("shows each thumbnail, which the API serves editors for trashed recipes, or a placeholder without a photo", async () => {
    setClock(OCT_30_NOON);
    await openTrash({ trash: () => MOCKUP_TRASH });
    const list = await screen.findByRole("list", { name: "Deleted recipes" });
    expect(within(list).getByRole("img", { name: "Pad Thai photo" })).toHaveAttribute("src", `${API}/recipes/pad-thai/thumbnail`);
    expect(within(list).getAllByRole("img")).toHaveLength(1);
    expect(list.querySelectorAll(".thumb-placeholder")).toHaveLength(2);
  });

  it("doesn't link entries to the recipe, which can't be opened while in the trash (REC-4)", async () => {
    await openTrash({ trash: () => MOCKUP_TRASH });
    const list = await screen.findByRole("list", { name: "Deleted recipes" });
    expect(within(list).queryAllByRole("link")).toEqual([]);
  });

  it.each([
    ["deleted Oct 1 at 23:30, on Oct 21 just after midnight", at(2026, 9, 1, 23, 30), at(2026, 9, 21, 0, 10)],
    ["deleted Oct 1 at 00:30, on Oct 21 just before midnight", at(2026, 9, 1, 0, 30), at(2026, 9, 21, 23, 50)],
  ])("shows 10 days left for a recipe %s (spec example)", async (_when, deleted, now) => {
    setClock(now);
    await openTrash({ trash: () => [trashed(BREAD_ID, "Banana Bread", deleted)] });
    await screen.findByRole("list", { name: "Deleted recipes" });
    expect(entryLines()).toEqual(["Banana BreadDeleted Oct 1 · 10 days left"]);
  });

  it("counts down on the open page: a day less at local midnight, then the last day, then never below zero", async () => {
    // Deleted Oct 3 at 08:15 EDT; due 30 × 24 hours later, Nov 2 at 07:15 EST, after daylight saving time ends on Nov 1.
    setClock(at(2026, 10, 1, 7, 0));
    await openTrash({ trash: () => [trashed(BREAD_ID, "Banana Bread", at(2026, 9, 3, 8, 15))] });
    await screen.findByRole("list", { name: "Deleted recipes" });
    expect(entryLines()).toEqual(["Banana BreadDeleted Oct 3 · 1 day left"]);

    // Nov 1 at 08:02 EST: under 24 hours to go.
    act(() => vi.advanceTimersByTime(62 * 60_000));
    expect(entryLines()).toEqual(["Banana BreadDeleted Oct 3 · less than a day left"]);

    // Nov 2 at 08:02: past due, not yet removed by the daily cleanup (REC-16).
    act(() => vi.advanceTimersByTime(DAY));
    expect(entryLines()).toEqual(["Banana BreadDeleted Oct 3 · removed soon"]);
    expect(screen.getByRole("button", { name: "Restore Banana Bread" })).toBeEnabled();
  });

  it("shows a calm message when the trash is empty", async () => {
    await openTrash({ trash: () => [] });
    expect(await screen.findByText("The trash is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says loading, not empty, while the trash loads", async () => {
    await openTrash({ trash: () => new Promise<Response>(() => {}) });
    expect(await screen.findByText("Loading trash…")).toBeInTheDocument();
    expect(screen.queryByText("The trash is empty.")).not.toBeInTheDocument();
  });

  it("shows a failure to load with a way to try again", async () => {
    let attempt = 0;
    await openTrash({ trash: () => (++attempt === 1 ? jsonResponse(500, { errors: [] }) : MOCKUP_TRASH) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the trash.");
    expect(screen.queryByText("The trash is empty.")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Deleted recipes" })).toBeInTheDocument();
  });

  it.each([
    ["visitors", VISITOR, "Sign in to see this"],
    ["signed-in non-editors", NON_EDITOR, "Only editors can see this"],
  ])("is not shown or loaded for %s (X-1)", async (_who, me, heading) => {
    const { fetchMock } = mockServer({ me, trash: () => MOCKUP_TRASH });
    renderAt("/trash");
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(gets(fetchMock, "/trash")).toBe(0);
    expect(screen.queryByText("Banana Bread")).not.toBeInTheDocument();
  });
});

describe("REC-15 restore from the trash", () => {
  it("restores with an empty body (X-12), takes the entry out and offers to open the recipe", async () => {
    let trash = [trashed(PAD_THAI_ID, "Pad Thai", at(2026, 10, 3)), trashed(BREAD_ID, "Banana Bread", at(2026, 9, 20))];
    const pad = { ...PAD_THAI, toMake: undefined };
    const { fetchMock } = await openTrash({
      live: [BEEF_STEW],
      trash: () => trash,
      restore: (id) => {
        trash = trash.filter((e) => e.id !== id);
        return jsonResponse(200, pad);
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Restore Pad Thai" }));

    expect(await screen.findByText("Pad Thai restored")).toBeInTheDocument();
    expect(changes(fetchMock)).toEqual([
      { method: "POST", path: `/trash/${PAD_THAI_ID}/restore`, body: "{}", contentType: "application/json" },
    ]);
    expect(screen.queryByRole("button", { name: "Restore Pad Thai" })).not.toBeInTheDocument();
    expect(entryLines()).toEqual([expect.stringMatching(/^Banana Bread/)]);
    // The pressed button is gone; focus goes to the link that takes its place.
    const open = screen.getByRole("link", { name: "Open recipe" });
    expect(open).toHaveFocus();
    await userEvent.click(open);
    expect(await screen.findByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
    expect(screen.getByText(/cooked once/)).toBeInTheDocument();
  });

  it("shows the empty trash after restoring the last entry", async () => {
    let trash = [trashed(PAD_THAI_ID, "Pad Thai", at(2026, 10, 3))];
    await openTrash({
      trash: () => trash,
      restore: () => {
        trash = [];
        return jsonResponse(200, { ...PAD_THAI, toMake: undefined });
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Restore Pad Thai" }));
    expect(await screen.findByText("The trash is empty.")).toBeInTheDocument();
  });

  it("sends one restore for a double tap", async () => {
    let answer: (response: Response) => void = () => {};
    const { fetchMock } = await openTrash({
      trash: () => [trashed(PAD_THAI_ID, "Pad Thai", at(2026, 10, 3))],
      restore: () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const button = await screen.findByRole("button", { name: "Restore Pad Thai" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    expect(changes(fetchMock)).toHaveLength(1);
    await act(async () => answer(jsonResponse(200, { ...PAD_THAI, toMake: undefined })));
    expect(await screen.findByText("Pad Thai restored")).toBeInTheDocument();
  });

  it("keeps the entry and says why when the restore doesn't get through", async () => {
    await openTrash({
      trash: () => [trashed(PAD_THAI_ID, "Pad Thai", at(2026, 10, 3))],
      restore: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const button = await screen.findByRole("button", { name: "Restore Pad Thai" });
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't restore Pad Thai. Couldn't reach the server. Check the connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Restore Pad Thai" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore Pad Thai" })).toHaveFocus();
  });
});

describe("REC-16 a restore refused after 30 days", () => {
  it("shows the server's message and drops the entry, which stays out when the trash reloads", async () => {
    const trash = [trashed(BREAD_ID, "Banana Bread", at(2026, 9, 3)), trashed(STROGANOFF_ID, "Mushroom Stroganoff", at(2026, 9, 2))];
    const { queryClient, fetchMock } = await openTrash({ trash: () => trash, restore: () => jsonResponse(409, ERROR_EXPIRED) });
    await userEvent.click(await screen.findByRole("button", { name: "Restore Banana Bread" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't restore Banana Bread. This recipe has been in the trash for 30 days and can no longer be restored.",
    );
    expect(alert).toHaveFocus();
    expect(entryLines()).toEqual([expect.stringMatching(/^Mushroom Stroganoff/)]);

    // The server lists it until the daily cleanup removes it. Meanwhile another recipe was deleted, which shows the reload.
    trash.unshift(trashed(STEW_ID, "Beef Stew", at(2026, 10, 4)));
    const loads = gets(fetchMock, "/trash");
    await act(() => queryClient.refetchQueries({ queryKey: trashKeys.all }));
    expect(gets(fetchMock, "/trash")).toBe(loads + 1);
    await screen.findByText("Beef Stew");
    expect(entryLines()).toEqual([expect.stringMatching(/^Beef Stew/), expect.stringMatching(/^Mushroom Stroganoff/)]);
  });
});

describe("REC-16 a restore after the recipe was removed for good", () => {
  it("shows the server's message and drops the entry when the restore answers 404", async () => {
    const trash = [trashed(BREAD_ID, "Banana Bread", at(2026, 9, 3)), trashed(STROGANOFF_ID, "Mushroom Stroganoff", at(2026, 9, 2))];
    await openTrash({ trash: () => trash, restore: () => jsonResponse(404, NOT_FOUND) });
    await userEvent.click(await screen.findByRole("button", { name: "Restore Banana Bread" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't restore Banana Bread. This recipe doesn't exist.");
    expect(alert).toHaveFocus();
    expect(entryLines()).toEqual([expect.stringMatching(/^Mushroom Stroganoff/)]);
    expect(screen.queryByRole("button", { name: "Restore Banana Bread" })).not.toBeInTheDocument();
  });
});

describe("REC-17 deleting from a view opened before", () => {
  it("goes to the list with the message when the recipe was already deleted elsewhere (204, no change)", async () => {
    await openRecipe({ remove: () => new Response(null, { status: 204 }) });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Pad Thai moved to trash")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
