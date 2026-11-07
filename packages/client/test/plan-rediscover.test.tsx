import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorRecipe, EditorRecipeSummary, Me, RediscoverEntry, ToMakeEntry } from "@recipebox/shared";
import { recipeKeys, rediscoverKeys } from "../src/api/query-keys.js";
import { showSavedRecipe } from "../src/recipes/recipe-changes.js";
import { API, EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

/** A stored time, written as the server would (UTC), for a local date and time on this device. */
function at(year: number, monthIndex: number, day: number, hours = 12, minutes = 0): string {
  return new Date(year, monthIndex, day, hours, minutes).toISOString();
}

function recipe(id: string, name: string, extra: Partial<EditorRecipe> = {}): EditorRecipe {
  return { id, name, ingredients: ["Something"], steps: ["Cook it."], tags: [], hasPhoto: false, cookedAt: [], timesCooked: 0, ...extra };
}

/** Cooking history fields for entries given newest first, as the server sends them (COOK-5). */
function cooked(...entries: string[]): Partial<EditorRecipe> {
  return { cookedAt: entries, lastCookedAt: entries[0], timesCooked: entries.length };
}

const LEMON_ID = "0b6a3c2e-0000-4000-8000-000000000011";
const TIKKA_ID = "0b6a3c2e-0000-4000-8000-000000000012";
const SHAKSHUKA_ID = "0b6a3c2e-0000-4000-8000-000000000013";
const FISH_ID = "0b6a3c2e-0000-4000-8000-000000000014";
const STEW_ID = "0b6a3c2e-0000-4000-8000-000000000015";
const CURRY_ID = "0b6a3c2e-0000-4000-8000-000000000016";
const PAD_THAI_ID = "0b6a3c2e-0000-4000-8000-000000000017";

// The mockups' day (docs/mockups/ToMake.dc.html, Rediscover.dc.html): Oct 30, 2026.
const OCT_30_NOON = new Date(2026, 9, 30, 12, 0);

const LEMON = recipe(LEMON_ID, "Lemon Risotto", { hasPhoto: true, toMake: { addedAt: at(2026, 9, 12, 18, 0) } });
const TIKKA = recipe(TIKKA_ID, "Chicken Tikka Masala", { toMake: { addedAt: at(2026, 9, 22, 9, 0) }, ...cooked(at(2026, 9, 21, 19, 0)) });
const SHAKSHUKA = recipe(SHAKSHUKA_ID, "Shakshuka", { toMake: { addedAt: at(2026, 9, 24, 8, 0) } });
const FISH = recipe(FISH_ID, "Fish Tacos", { toMake: { addedAt: at(2026, 9, 29, 20, 0) } });
const STEW = recipe(STEW_ID, "Beef Stew", cooked(at(2026, 0, 10, 18, 0), at(2025, 11, 1, 18, 0)));
const CURRY = recipe(CURRY_ID, "Chickpea Curry", cooked(at(2026, 2, 2, 18, 0)));
const PAD_THAI = recipe(PAD_THAI_ID, "Pad Thai", { hasPhoto: true, ...cooked(at(2026, 7, 2, 18, 0)) });

const ALL = [LEMON, TIKKA, SHAKSHUKA, FISH, STEW, CURRY, PAD_THAI];

function summaryOf({ id, name, tags, hasPhoto, totalTimeMinutes }: EditorRecipe) {
  return { id, name, tags, hasPhoto, ...(totalTimeMinutes === undefined ? {} : { totalTimeMinutes }) };
}

interface FakeServer {
  me?: Me;
  recipes?: EditorRecipe[];
  /** GET /plan or /recommendations, to fail or hold an answer back; undefined answers from the stored recipes. */
  plan?: () => Response | Promise<Response> | undefined;
  recommendations?: () => Response | Promise<Response> | undefined;
  /** A change, to fail it; undefined makes it as the real server would. */
  change?: (method: string, path: string) => Response | Promise<Response> | undefined;
}

/** A small stand-in for the API, keeping the recipes, the to-make list (PLAN) and cooking history (COOK) as the server would. */
function mockServer({ me = EDITOR, recipes: initial = ALL, plan, recommendations, change }: FakeServer = {}) {
  const recipes = initial.map((r) => ({ ...r }));
  let gate: Promise<void> | undefined;
  const find = (id: string) => recipes.find((r) => r.id === id);

  const fetchMock = mockApi(me, async (url, init) => {
    const method = init.method ?? "GET";
    const path = url.pathname;
    if (method === "GET") {
      if (path === "/plan") {
        return (
          plan?.() ??
          jsonResponse(
            200,
            recipes
              .filter((r) => r.toMake !== undefined)
              .sort((a, b) => (a.toMake?.addedAt ?? "").localeCompare(b.toMake?.addedAt ?? ""))
              .map((r): ToMakeEntry => ({ ...summaryOf(r), addedAt: r.toMake?.addedAt ?? "" })),
          )
        );
      }
      if (path === "/recommendations") {
        const never = recipes.filter((r) => r.lastCookedAt === undefined).sort((a, b) => a.name.localeCompare(b.name));
        const cookedOnes = recipes
          .filter((r) => r.lastCookedAt !== undefined)
          .sort((a, b) => (a.lastCookedAt ?? "").localeCompare(b.lastCookedAt ?? ""));
        return (
          recommendations?.() ??
          jsonResponse(
            200,
            [...never, ...cookedOnes].map(
              (r): RediscoverEntry => ({ ...summaryOf(r), ...(r.lastCookedAt === undefined ? {} : { lastCookedAt: r.lastCookedAt }) }),
            ),
          )
        );
      }
      if (path === "/recipes") {
        return jsonResponse(
          200,
          [...recipes]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r): EditorRecipeSummary => ({ ...summaryOf(r), onToMakeList: r.toMake !== undefined })),
        );
      }
      if (path === "/tags") return jsonResponse(200, []);
      const match = /^\/recipes\/([^/]+)$/.exec(path);
      const found = match === null ? undefined : find(decodeURIComponent(match[1] ?? ""));
      return found === undefined ? jsonResponse(404, { errors: [{ code: "recipe.notFound", message: "Not found." }] }) : jsonResponse(200, found);
    }

    if (gate !== undefined) await gate;
    const refused = change?.(method, path);
    if (refused !== undefined) return refused;
    const match = /^\/recipes\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
    const stored = match === null ? undefined : find(decodeURIComponent(match[1] ?? ""));
    if (stored === undefined) return jsonResponse(404, { errors: [] });
    const action = match?.[2];
    if (method === "DELETE" && action === undefined) {
      recipes.splice(recipes.indexOf(stored), 1);
      return new Response(null, { status: 204 });
    }
    if (action === "remove-from-plan") delete stored.toMake;
    else if (action === "add-to-plan") stored.toMake ??= { addedAt: new Date().toISOString() };
    else if (action === "cookings") {
      // PLAN-5: cooking takes it off the list. The time is the server's own (X-12).
      const now = new Date().toISOString();
      Object.assign(stored, { cookedAt: [now, ...stored.cookedAt], lastCookedAt: now, timesCooked: stored.timesCooked + 1 });
      delete stored.toMake;
    } else return jsonResponse(500, { errors: [] });
    return jsonResponse(200, stored);
  });

  /** Holds every change until the returned function is called. */
  function holdChanges(): () => void {
    let release: () => void = () => {};
    gate = new Promise<void>((resolve) => (release = resolve));
    return () => {
      gate = undefined;
      release();
    };
  }

  return { fetchMock, recipes, holdChanges };
}

function changes(fetchMock: FetchMock) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") !== "GET")
    .map(([input, init]) => ({
      method: init?.method,
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

function never(): Promise<Response> {
  return new Promise<Response>(() => {});
}

// ---------------------------------------------------------------------------------------------------------------------------
// The to-make list
// ---------------------------------------------------------------------------------------------------------------------------

async function openPlan(server: FakeServer = {}) {
  const fake = mockServer(server);
  const rendered = renderAt("/plan");
  await screen.findByRole("heading", { level: 1, name: "Plan" });
  return { ...fake, ...rendered };
}

function planList(): HTMLElement {
  return screen.getByRole("list", { name: "Plan" });
}

function planLines(): string[] {
  return within(planList())
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".recipe-card-text")?.textContent ?? "");
}

function removeButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: `Remove ${name} from the plan` });
}

describe("PLAN-3 the Plan", () => {
  it("shows the entries in the server's order, oldest first, with the date each was added", async () => {
    setClock(OCT_30_NOON);
    await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    expect(screen.getByText("4 recipes · oldest first")).toBeInTheDocument();
    // Not alphabetical: the order is the server's.
    expect(planLines()).toEqual([
      "Lemon RisottoAdded Oct 12",
      "Chicken Tikka MasalaAdded Oct 22",
      "ShakshukaAdded Oct 24",
      "Fish TacosAdded Oct 29",
    ]);
  });

  it("links each entry to its recipe, with its thumbnail or a placeholder, and a 44px round remove button per entry", async () => {
    await openPlan();
    const list = await screen.findByRole("list", { name: "Plan" });
    expect(within(list).getByRole("link", { name: /Lemon Risotto/ })).toHaveAttribute("href", `/recipes/${LEMON_ID}`);
    expect(within(list).getByRole("img", { name: "Lemon Risotto photo" })).toHaveAttribute("src", `${API}/recipes/${LEMON_ID}/thumbnail`);
    expect(list.querySelectorAll(".thumb-placeholder")).toHaveLength(3);
    expect(within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove Lemon Risotto from the plan",
      "Remove Chicken Tikka Masala from the plan",
      "Remove Shakshuka from the plan",
      "Remove Fish Tacos from the plan",
    ]);
    // The button sits beside the link, not inside it.
    expect(removeButton("Lemon Risotto").closest("a")).toBeNull();
    expect(removeButton("Lemon Risotto")).toHaveClass("round-button");
  });

  it("shows the date added in the device's time zone (X-12), with the year for an earlier year", async () => {
    setClock(OCT_30_NOON);
    await openPlan({
      recipes: [
        // 2025-12-31 03:30 UTC is still Dec 30 in New York.
        recipe(STEW_ID, "Beef Stew", { toMake: { addedAt: "2025-12-31T03:30:00.000Z" } }),
        // 2026-10-13 02:30 UTC is Oct 12 at 22:30 in New York.
        recipe(LEMON_ID, "Lemon Risotto", { toMake: { addedAt: "2026-10-13T02:30:00.000Z" } }),
        recipe(FISH_ID, "Fish Tacos", { toMake: { addedAt: at(2026, 9, 30, 0, 5) } }),
      ],
    });
    await screen.findByRole("list", { name: "Plan" });
    expect(planLines()).toEqual(["Beef StewAdded Dec 30, 2025", "Lemon RisottoAdded Oct 12", "Fish TacosAdded today"]);
  });

  it("says today until local midnight, then the date, on the open page", async () => {
    setClock(new Date(2026, 9, 30, 23, 58));
    await openPlan({ recipes: [recipe(FISH_ID, "Fish Tacos", { toMake: { addedAt: at(2026, 9, 30, 20, 0) } })] });
    await screen.findByRole("list", { name: "Plan" });
    expect(planLines()).toEqual(["Fish TacosAdded today"]);
    act(() => vi.advanceTimersByTime(3 * 60_000));
    expect(planLines()).toEqual(["Fish TacosAdded Oct 30"]);
  });

  it("counts one recipe in the singular", async () => {
    await openPlan({ recipes: [FISH, STEW] });
    expect(await screen.findByText("1 recipe · oldest first")).toBeInTheDocument();
  });

  it("says the list is empty, without a how-to, with a way to the recipes (mockup ToMakeEmpty)", async () => {
    await openPlan({ recipes: [STEW, CURRY] });
    expect(await screen.findByRole("heading", { level: 2, name: "Nothing planned yet" })).toBeInTheDocument();
    expect(screen.queryByText(/Open a recipe and choose/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/oldest first/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says loading, not empty, while the list loads", async () => {
    await openPlan({ plan: never });
    expect(await screen.findByText("Loading the list…")).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned yet")).not.toBeInTheDocument();
  });

  it("shows a failure to load with a way to try again, never the empty message", async () => {
    let attempt = 0;
    await openPlan({ plan: () => (++attempt === 1 ? jsonResponse(500, { errors: [] }) : undefined) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the plan.");
    expect(screen.queryByText("Nothing planned yet")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Plan" })).toBeInTheDocument();
  });

  it.each([
    ["visitors", VISITOR, "Sign in to see this"],
    ["signed-in non-editors", NON_EDITOR, "Only editors can see this"],
  ])("is not shown or loaded for %s (X-1)", async (_who, me, heading) => {
    const { fetchMock } = mockServer({ me });
    renderAt("/plan");
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(gets(fetchMock, "/plan")).toBe(0);
    expect(screen.queryByText("Lemon Risotto")).not.toBeInTheDocument();
  });
});

describe("PLAN-4 remove from the list", () => {
  it("sends an empty body and no time (X-12), and takes the entry out at once, before the server answers", async () => {
    const { fetchMock, holdChanges } = await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    const release = holdChanges();
    await userEvent.click(removeButton("Shakshuka"));

    expect(changes(fetchMock)).toEqual([
      { method: "POST", path: `/recipes/${SHAKSHUKA_ID}/remove-from-plan`, body: "{}", contentType: "application/json" },
    ]);
    expect(planLines().map((line) => line.replace(/Added.*/, ""))).toEqual(["Lemon Risotto", "Chicken Tikka Masala", "Fish Tacos"]);
    expect(screen.getByText("3 recipes · oldest first")).toBeInTheDocument();
    release();
    await waitFor(() => expect(gets(fetchMock, "/plan")).toBe(2));
    expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument();
  });

  it("keeps the entry out once the server answers, without waiting for the list to reload", async () => {
    let holdList = false;
    const { fetchMock, queryClient } = await openPlan({ plan: () => (holdList ? never() : undefined) });
    await screen.findByRole("list", { name: "Plan" });
    holdList = true;
    await userEvent.click(removeButton("Shakshuka"));
    // The list was asked for again and hasn't answered: what shows is the cache, with the saved recipe in it.
    await waitFor(() => expect(gets(fetchMock, "/plan")).toBe(2));
    expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument();
    expect(screen.getByText("3 recipes · oldest first")).toBeInTheDocument();
    // The recipe itself, as the server returned it, for the recipe view.
    expect(queryClient.getQueryData<EditorRecipe>(recipeKeys.detail(SHAKSHUKA_ID))?.toMake).toBeUndefined();
  });

  it("updates the recipe list's to-make mark in the cache (PLAN-7)", async () => {
    const { queryClient, router } = await openPlan();
    await act(() => router.navigate("/"));
    await screen.findByRole("link", { name: /Shakshuka/ });
    await act(() => router.navigate("/plan"));
    await userEvent.click(await screen.findByRole("button", { name: "Remove Shakshuka from the plan" }));
    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<EditorRecipeSummary[]>(recipeKeys.list({ name: "", tags: [] }))
          ?.find((r) => r.id === SHAKSHUKA_ID)?.onToMakeList,
      ).toBe(false),
    );
  });

  it("moves focus to the next entry's remove button", async () => {
    await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Chicken Tikka Masala"));
    expect(removeButton("Shakshuka")).toHaveFocus();
  });

  it("moves focus to the entry before when the last one is removed", async () => {
    await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Fish Tacos"));
    expect(removeButton("Shakshuka")).toHaveFocus();
  });

  it("moves focus to Browse recipes when the list is now empty", async () => {
    await openPlan({ recipes: [FISH] });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Fish Tacos"));
    expect(await screen.findByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveFocus();
  });

  it("leaves focus alone if it is elsewhere when the remove button is tapped", async () => {
    await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    const elsewhere = screen.getByRole("link", { name: "Catalog" });
    act(() => elsewhere.focus());
    fireEvent.click(removeButton("Chicken Tikka Masala"));
    await waitFor(() => expect(screen.queryByText("Chicken Tikka Masala")).not.toBeInTheDocument());
    expect(elsewhere).toHaveFocus();
  });

  it("brings the entry back and says why when the removal fails", async () => {
    await openPlan({ change: () => jsonResponse(500, { errors: [] }) });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Shakshuka"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't remove Shakshuka from the list. The server couldn't make the change. Try again.",
    );
    expect(removeButton("Shakshuka")).toBeEnabled();
    expect(screen.getByText("4 recipes · oldest first")).toBeInTheDocument();
    // Focus had moved to the next entry, and stays there.
    expect(removeButton("Fish Tacos")).toHaveFocus();
  });

  it("puts focus on the message when the only entry comes back", async () => {
    await openPlan({ recipes: [FISH], change: () => Promise.reject(new TypeError("Failed to fetch")) });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Fish Tacos"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't remove Fish Tacos from the list. Couldn't reach the server.");
    expect(screen.queryByText("Nothing planned yet")).not.toBeInTheDocument();
    expect(alert).toHaveFocus();
  });

  it("waits for another change to the recipe made from the recipe view, even after leaving it (COOK-1)", async () => {
    const { fetchMock, router, holdChanges } = await openPlan();
    await act(() => router.navigate(`/recipes/${SHAKSHUKA_ID}`));
    const release = holdChanges();
    await userEvent.click(await screen.findByRole("button", { name: "I cooked this today" }));
    await act(() => router.navigate("/plan"));

    const remove = await screen.findByRole("button", { name: "Remove Shakshuka from the plan" });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(changes(fetchMock).map((c) => c.path)).toEqual([`/recipes/${SHAKSHUKA_ID}/cookings`]);

    // PLAN-5: cooked, it leaves the list.
    release();
    await waitFor(() => expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument());
  });

  it("makes the recipe view wait for a removal still being saved, and shows it off the list there", async () => {
    const { fetchMock, router, holdChanges } = await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    const release = holdChanges();
    await userEvent.click(removeButton("Shakshuka"));
    await act(() => router.navigate(`/recipes/${SHAKSHUKA_ID}`));

    const cook = await screen.findByRole("button", { name: "I cooked this today" });
    expect(cook).toBeDisabled();
    fireEvent.click(cook);
    expect(changes(fetchMock)).toHaveLength(1);

    release();
    expect(await screen.findByRole("button", { name: "I want to cook this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
  });

  it("keeps the entry out when coming back while the removal is still being saved", async () => {
    const { router, holdChanges } = await openPlan();
    await screen.findByRole("list", { name: "Plan" });
    const release = holdChanges();
    await userEvent.click(removeButton("Shakshuka"));
    await act(() => router.navigate("/"));
    await act(() => router.navigate("/plan"));
    await screen.findByRole("list", { name: "Plan" });
    expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument();
    release();
  });

  it("doesn't report a failure on another page after leaving the list", async () => {
    let fail: (response: Response) => void = () => {};
    const { router } = await openPlan({ change: () => new Promise<Response>((resolve) => (fail = resolve)) });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Shakshuka"));
    await act(() => router.navigate("/account"));
    await act(async () => fail(jsonResponse(500, { errors: [] })));
    expect(router.state.location.pathname).toBe("/account");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why when a removal fails after leaving the list and coming back while it was being saved", async () => {
    let fail: (response: Response) => void = () => {};
    const { router } = await openPlan({ change: () => new Promise<Response>((resolve) => (fail = resolve)) });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Shakshuka"));
    await act(() => router.navigate("/account"));
    await act(() => router.navigate("/plan"));
    await screen.findByRole("list", { name: "Plan" });
    expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument();

    await act(async () => fail(jsonResponse(500, { errors: [] })));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't remove Shakshuka from the list. The server couldn't make the change. Try again.",
    );
    expect(removeButton("Shakshuka")).toBeEnabled();
  });

  it("clears the message when the next removal starts", async () => {
    let attempt = 0;
    await openPlan({ change: () => (++attempt === 1 ? jsonResponse(500, { errors: [] }) : undefined) });
    await screen.findByRole("list", { name: "Plan" });
    await userEvent.click(removeButton("Shakshuka"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove Shakshuka from the list.");
    await userEvent.click(removeButton("Fish Tacos"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Fish Tacos")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("updates a renamed entry in place, before the list reloads (REC-5)", async () => {
    let holdList = false;
    const { queryClient, fetchMock } = await openPlan({ plan: () => (holdList ? never() : undefined) });
    await screen.findByRole("list", { name: "Plan" });
    holdList = true;
    // As the edit form does after saving (RecipeForm.tsx).
    act(() => showSavedRecipe(queryClient, { ...SHAKSHUKA, name: "Green Shakshuka" }, { tagsChanged: true }));
    // The reload was asked for and is waiting, so what shows is the cache.
    await waitFor(() => expect(gets(fetchMock, "/plan")).toBe(2));
    await waitFor(() => expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument());
    expect(planLines().map((line) => line.replace(/Added.*/, ""))).toEqual([
      "Lemon Risotto",
      "Chicken Tikka Masala",
      "Green Shakshuka",
      "Fish Tacos",
    ]);
  });
});

describe("PLAN-1, PLAN-5, PLAN-6 coming back to the list after a change on the recipe", () => {
  /** Opens the list, then the recipe, and makes every later GET /plan wait, so what shows is the cache. */
  async function fromPlanToRecipe(id: string, server: FakeServer = {}) {
    let holdList = false;
    const opened = await openPlan({ ...server, plan: () => (holdList ? never() : undefined) });
    await screen.findByRole("list", { name: "Plan" });
    await act(() => opened.router.navigate(`/recipes/${id}`));
    await screen.findByRole("button", { name: "I cooked this today" });
    holdList = true;
    return opened;
  }

  it("leaves out a recipe just cooked, at once (PLAN-5)", async () => {
    const { router } = await fromPlanToRecipe(SHAKSHUKA_ID);
    await userEvent.click(screen.getByRole("button", { name: "I cooked this today" }));
    await screen.findByRole("button", { name: "Cooked today ✓" });
    await act(() => router.navigate("/plan"));
    expect(planLines().map((line) => line.replace(/Added.*/, ""))).toEqual(["Lemon Risotto", "Chicken Tikka Masala", "Fish Tacos"]);
  });

  it("shows a recipe just added at the end, added today, at once (PLAN-1)", async () => {
    const { router } = await fromPlanToRecipe(PAD_THAI_ID);
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));
    await screen.findByText("On your plan ✓");
    await act(() => router.navigate("/plan"));
    expect(planLines().at(-1)).toBe("Pad ThaiAdded today");
    expect(screen.getByText("5 recipes · oldest first")).toBeInTheDocument();
  });

  it("leaves out a recipe just deleted, at once (PLAN-6)", async () => {
    const { router } = await fromPlanToRecipe(LEMON_ID);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Lemon Risotto moved to trash");
    await act(() => router.navigate("/plan"));
    expect(screen.queryByText("Lemon Risotto", { selector: ".recipe-card-name" })).not.toBeInTheDocument();
    expect(planLines()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Haven't made in a while
// ---------------------------------------------------------------------------------------------------------------------------

async function openRediscover(server: FakeServer = {}) {
  const fake = mockServer(server);
  const rendered = renderAt("/recommendations");
  await screen.findByRole("heading", { level: 1, name: "Recommendations" });
  return { ...fake, ...rendered };
}

function rediscoverLines(): string[] {
  return within(screen.getByRole("list", { name: "Recommendations" }))
    .getAllByRole("link")
    .map((link) => [link.querySelector(".recipe-card-name"), link.querySelector(".recipe-card-meta"), link.querySelector(".cooked-ago")]
      .map((part) => part?.textContent)
      .join(" | "));
}

describe("COOK-6 Haven't made in a while, called Recommendations", () => {
  it("lists every recipe in the server's order, never cooked first, with the last cooking and how long ago", async () => {
    setClock(OCT_30_NOON);
    await openRediscover();
    await screen.findByRole("list", { name: "Recommendations" });
    expect(screen.queryByText("Least recently cooked first")).not.toBeInTheDocument();
    expect(rediscoverLines()).toEqual([
      "Fish Tacos | Never cooked | New",
      "Lemon Risotto | Never cooked | New",
      "Shakshuka | Never cooked | New",
      "Beef Stew | Last cooked Jan 10 | 9 months ago",
      "Chickpea Curry | Last cooked Mar 2 | 7 months ago",
      "Pad Thai | Last cooked Aug 2 | 2 months ago",
      "Chicken Tikka Masala | Last cooked Oct 21 | 9 days ago",
    ]);
  });

  it("keeps the server's order rather than sorting again (spec example: A never, B 2026-01-10, C 2026-08-02)", async () => {
    setClock(OCT_30_NOON);
    // In the opposite order to the names, to show the client doesn't sort.
    await openRediscover({
      recipes: [
        recipe(FISH_ID, "C", cooked(at(2026, 7, 2))),
        recipe(STEW_ID, "B", cooked(at(2026, 0, 10))),
        recipe(LEMON_ID, "A"),
      ],
      recommendations: () =>
        jsonResponse(200, [
          { id: LEMON_ID, name: "A", tags: [], hasPhoto: false },
          { id: STEW_ID, name: "B", tags: [], hasPhoto: false, lastCookedAt: at(2026, 0, 10) },
          { id: FISH_ID, name: "C", tags: [], hasPhoto: false, lastCookedAt: at(2026, 7, 2) },
        ]),
    });
    await screen.findByRole("list", { name: "Recommendations" });
    expect(rediscoverLines().map((line) => line.split(" | ")[0])).toEqual(["A", "B", "C"]);
  });

  it("links each entry to its recipe, with its thumbnail or a placeholder", async () => {
    await openRediscover();
    const list = await screen.findByRole("list", { name: "Recommendations" });
    expect(within(list).getByRole("link", { name: /Pad Thai/ })).toHaveAttribute("href", `/recipes/${PAD_THAI_ID}`);
    expect(within(list).getByRole("img", { name: "Pad Thai photo" })).toHaveAttribute("src", `${API}/recipes/${PAD_THAI_ID}/thumbnail`);
    expect(within(list).getAllByRole("img")).toHaveLength(2);
  });

  it("shows the last cooking in the device's time zone (X-12), with the year for an earlier year", async () => {
    setClock(OCT_30_NOON);
    await openRediscover({
      recipes: [
        // 2025-08-03 01:00 UTC is still Aug 2 in New York.
        recipe(STEW_ID, "Beef Stew", cooked("2025-08-03T01:00:00.000Z")),
        // 2026-10-30 03:00 UTC is Oct 29 at 23:00 in New York: yesterday, not today.
        recipe(FISH_ID, "Fish Tacos", cooked("2026-10-30T03:00:00.000Z")),
        recipe(LEMON_ID, "Lemon Risotto", cooked(at(2026, 9, 30, 8, 0))),
      ],
    });
    await screen.findByRole("list", { name: "Recommendations" });
    expect(rediscoverLines()).toEqual([
      "Beef Stew | Last cooked Aug 2, 2025 | 1 year ago",
      "Fish Tacos | Last cooked Oct 29 | yesterday",
      "Lemon Risotto | Last cooked today | today",
    ]);
  });

  it("moves the labels on while the page stays open: at local midnight, and when the page is shown again", async () => {
    setClock(new Date(2026, 9, 29, 23, 58));
    await openRediscover({
      recipes: [
        recipe(FISH_ID, "Fish Tacos", cooked(at(2026, 9, 29, 19, 0))),
        recipe(STEW_ID, "Beef Stew", cooked(at(2026, 8, 30, 19, 0))),
      ],
    });
    await screen.findByRole("list", { name: "Recommendations" });
    expect(rediscoverLines()).toEqual(["Beef Stew | Last cooked Sep 30 | 29 days ago", "Fish Tacos | Last cooked today | today"]);

    // Oct 30: a whole month since Sep 30.
    act(() => vi.advanceTimersByTime(3 * 60_000));
    expect(rediscoverLines()).toEqual(["Beef Stew | Last cooked Sep 30 | 1 month ago", "Fish Tacos | Last cooked Oct 29 | yesterday"]);

    // A sleeping phone: the clock moves on without the timers firing, and the page is shown again.
    vi.setSystemTime(new Date(2026, 10, 9, 8, 0));
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(rediscoverLines()).toEqual(["Beef Stew | Last cooked Sep 30 | 1 month ago", "Fish Tacos | Last cooked Oct 29 | 11 days ago"]);
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("marks never cooked, months and days differently, as in the mockup", async () => {
    setClock(OCT_30_NOON);
    await openRediscover({ recipes: [LEMON, STEW, TIKKA] });
    await screen.findByRole("list", { name: "Recommendations" });
    expect(screen.getByText("New")).toHaveClass("ago-new");
    expect(screen.getByText("9 months ago")).toHaveClass("ago-old");
    expect(screen.getByText("9 days ago")).toHaveClass("ago-recent");
  });

  it("moves a recipe just cooked to the end, cooked today, at once when coming back", async () => {
    setClock(OCT_30_NOON);
    let holdList = false;
    const { router } = await openRediscover({ recommendations: () => (holdList ? never() : undefined) });
    await screen.findByRole("list", { name: "Recommendations" });
    await act(() => router.navigate(`/recipes/${STEW_ID}`));
    holdList = true;
    await userEvent.click(await screen.findByRole("button", { name: "I cooked this today" }));
    await screen.findByRole("button", { name: "Cooked today ✓" });
    await act(() => router.navigate("/recommendations"));
    expect(rediscoverLines().at(-1)).toBe("Beef Stew | Last cooked today | today");
    expect(rediscoverLines()).toHaveLength(7);
  });

  /** Opens the list, keeps its order, and makes every later GET /recommendations wait, so what shows is the cache. */
  async function rediscoverHeld() {
    setClock(OCT_30_NOON);
    let holdList = false;
    const opened = await openRediscover({ recommendations: () => (holdList ? never() : undefined) });
    await screen.findByRole("list", { name: "Recommendations" });
    const before = rediscoverLines();
    holdList = true;
    return { ...opened, before };
  }

  it("keeps the order after a to-make change on the recipe, which isn't a cooking", async () => {
    const { router, before } = await rediscoverHeld();
    await act(() => router.navigate(`/recipes/${STEW_ID}`));
    await userEvent.click(await screen.findByRole("button", { name: "I want to cook this" }));
    await screen.findByText("On your plan ✓");
    await act(() => router.navigate("/recommendations"));
    expect(rediscoverLines()).toEqual(before);
  });

  it("keeps the order and updates in place a cooked recipe renamed in the edit form (REC-5)", async () => {
    const { queryClient, before, fetchMock } = await rediscoverHeld();
    act(() => showSavedRecipe(queryClient, { ...PAD_THAI, name: "Pad See Ew" }, { tagsChanged: true }));
    await waitFor(() => expect(gets(fetchMock, "/recommendations")).toBe(2));
    await waitFor(() => expect(screen.queryByText("Pad Thai")).not.toBeInTheDocument());
    expect(rediscoverLines()).toEqual(before.map((line) => line.replace("Pad Thai", "Pad See Ew")));
  });

  it("leaves a renamed never-cooked recipe to the reload, since those are in name order (X-13)", async () => {
    const { queryClient, before, fetchMock } = await rediscoverHeld();
    // "Tacos" would sort after Shakshuka; only the server sorts names (X-13), so the cache isn't reordered by guess.
    act(() => showSavedRecipe(queryClient, { ...FISH, name: "Tacos" }, { tagsChanged: true }));
    // The reload was asked for and is waiting; meanwhile the cache keeps the entry as it was.
    await waitFor(() => expect(gets(fetchMock, "/recommendations")).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(rediscoverLines()).toEqual(before);
    expect(queryClient.getQueryData<RediscoverEntry[]>(rediscoverKeys.all)?.[0]?.name).toBe("Fish Tacos");
  });

  it("says there are no recipes yet when the collection is empty", async () => {
    await openRediscover({ recipes: [] });
    expect(await screen.findByText(/No recipes yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first recipe" })).toHaveAttribute("href", "/recipes/new");
  });

  it("says loading, not empty, while the recipes load", async () => {
    await openRediscover({ recommendations: never });
    expect(await screen.findByText("Loading recipes…")).toBeInTheDocument();
    expect(screen.queryByText(/No recipes yet/)).not.toBeInTheDocument();
  });

  it("shows a failure to load with a way to try again", async () => {
    let attempt = 0;
    await openRediscover({ recommendations: () => (++attempt === 1 ? jsonResponse(500, { errors: [] }) : undefined) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the recipes.");
    expect(screen.queryByText(/No recipes yet/)).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Recommendations" })).toBeInTheDocument();
  });

  it.each([
    ["visitors", VISITOR, "Sign in to see this"],
    ["signed-in non-editors", NON_EDITOR, "Only editors can see this"],
  ])("is not shown or loaded for %s (X-1)", async (_who, me, heading) => {
    const { fetchMock } = mockServer({ me });
    renderAt("/recommendations");
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(gets(fetchMock, "/recommendations")).toBe(0);
    expect(screen.queryByText("Pad Thai")).not.toBeInTheDocument();
  });
});
