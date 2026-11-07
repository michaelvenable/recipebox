import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EditorRecipe, Me, ShoppingItem, ToMakeEntry } from "@recipebox/shared";
import { shoppingListKeys } from "../src/api/query-keys.js";
import { showSavedRecipe } from "../src/recipes/recipe-changes.js";
import { recipeDeleted } from "../src/recipes/trash-changes.js";
import { EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const SHAKSHUKA_ID = "0b6a3c2e-0000-4000-8000-000000000021";
const CHILI_ID = "0b6a3c2e-0000-4000-8000-000000000022";
const STEW_ID = "0b6a3c2e-0000-4000-8000-000000000023";

function recipe(id: string, name: string, extra: Partial<EditorRecipe> = {}): EditorRecipe {
  return { id, name, ingredients: ["Something"], steps: ["Cook it."], tags: [], hasPhoto: false, cookedAt: [], timesCooked: 0, ...extra };
}

// The spec's example (PLAN-8), with prep on Shakshuka that must never show.
const SHAKSHUKA = recipe(SHAKSHUKA_ID, "Shakshuka", {
  ingredients: ["6 eggs", "1 can tomatoes"],
  prep: ["Slice the peppers"],
  toMake: { addedAt: "2026-10-01T08:00:00.000Z" },
});
const CHILI = recipe(CHILI_ID, "Chili", {
  ingredients: ["1 can tomatoes", "500 g beef mince"],
  toMake: { addedAt: "2026-10-02T08:00:00.000Z" },
});
const STEW = recipe(STEW_ID, "Beef Stew", { ingredients: ["1 kg beef"] });

/** The spec's example as the server answers it: sorted by the domain (X-13), the same line twice ordered by recipe name. */
const SPEC_EXAMPLE: [text: string, recipe: string][] = [
  ["1 can tomatoes", "Chili"],
  ["1 can tomatoes", "Shakshuka"],
  ["500 g beef mince", "Chili"],
  ["6 eggs", "Shakshuka"],
];

interface FakeServer {
  me?: Me;
  recipes?: EditorRecipe[];
  /** GET /plan/shopping-list, to fail or hold an answer back; undefined answers from the stored recipes. */
  shopping?: () => Response | Promise<Response> | undefined;
  /** Delays every answer to GET /plan/shopping-list after the first, like a slow connection. */
  reloadDelayMs?: number;
}

/** A small stand-in for the API: the to-make list, its shopping list and taking a recipe off the list or deleting it. */
function mockServer({ me = EDITOR, recipes: initial = [SHAKSHUKA, CHILI, STEW], shopping, reloadDelayMs = 0 }: FakeServer = {}) {
  let shoppingGets = 0;
  const recipes = initial.map((r) => ({ ...r }));
  const planned = () =>
    recipes.filter((r) => r.toMake !== undefined).sort((a, b) => (a.toMake?.addedAt ?? "").localeCompare(b.toMake?.addedAt ?? ""));

  const fetchMock = mockApi(me, (url, init) => {
    const method = init.method ?? "GET";
    const path = url.pathname;
    if (method === "GET" && path === "/plan") {
      return jsonResponse(
        200,
        planned().map((r): ToMakeEntry => ({ id: r.id, name: r.name, tags: r.tags, hasPhoto: r.hasPhoto, addedAt: r.toMake?.addedAt ?? "" })),
      );
    }
    if (method === "GET" && path === "/plan/shopping-list") {
      // The order is the server's (tested in packages/domain and packages/server); this stand-in only needs to be stable.
      const items = planned()
        .flatMap((r) => r.ingredients.map((text): ShoppingItem => ({ text, recipeId: r.id, recipeName: r.name })))
        .sort((a, b) => a.text.localeCompare(b.text, "en", { sensitivity: "base" }) || a.recipeName.localeCompare(b.recipeName));
      const answer = shopping?.() ?? jsonResponse(200, items);
      if (++shoppingGets === 1 || reloadDelayMs === 0) return answer;
      return new Promise<Response>((resolve) => setTimeout(() => resolve(answer), reloadDelayMs));
    }
    const match = /^\/recipes\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
    const stored = recipes.find((r) => r.id === decodeURIComponent(match?.[1] ?? ""));
    if (stored === undefined) return jsonResponse(404, { errors: [{ code: "recipe.notFound", message: "Not found." }] });
    if (method === "GET") return jsonResponse(200, stored);
    if (method === "POST" && match?.[2] === "remove-from-plan") {
      delete stored.toMake;
      return jsonResponse(200, stored);
    }
    if (method === "DELETE" && match?.[2] === undefined) {
      recipes.splice(recipes.indexOf(stored), 1);
      return new Response(null, { status: 204 });
    }
    return undefined;
  });
  return { fetchMock, recipes };
}

function gets(fetchMock: FetchMock, path: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => (init?.method ?? "GET") === "GET" && new URL(String(input)).pathname === path)
    .length;
}

function never(): Promise<Response> {
  return new Promise<Response>(() => {});
}

async function openShoppingList(server: FakeServer = {}) {
  const fake = mockServer(server);
  const rendered = renderAt("/plan/shopping");
  await screen.findByRole("heading", { level: 1, name: "Shopping list" });
  return { ...fake, ...rendered };
}

/** Each line as [ingredient, recipe name], in the order shown. */
function lines(): [string, string][] {
  return within(screen.getByRole("list", { name: "Shopping list" }))
    .getAllByRole("listitem")
    .map((li) => [
      li.querySelector(".shopping-item-name")?.textContent ?? "",
      li.querySelector(".shopping-item-recipe")?.textContent ?? "",
    ]);
}

/** "‹ Plan" above the heading, not the navigation's Plan. */
function backLink(): HTMLElement {
  const header = screen.getByRole("heading", { level: 1, name: "Shopping list" }).closest("header");
  if (header === null) throw new Error("No page header");
  return within(header).getByRole("link", { name: "Plan" });
}

function checkboxes(): HTMLInputElement[] {
  return within(screen.getByRole("list", { name: "Shopping list" })).getAllByRole<HTMLInputElement>("checkbox");
}

describe("PLAN-8 shopping list", () => {
  describe("the button on the Plan", () => {
    it("is shown with recipes on the list and opens the shopping list, still under Plan in the navigation", async () => {
      mockServer();
      const { router } = renderAt("/plan");
      const link = await screen.findByRole("link", { name: "Shopping list" });
      expect(link).toHaveAttribute("href", "/plan/shopping");
      expect(link).toHaveClass("pill-button");

      await userEvent.click(link);
      expect(router.state.location.pathname).toBe("/plan/shopping");
      expect(await screen.findByRole("heading", { level: 1, name: "Shopping list" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Plan", current: "page" })).toHaveAttribute("href", "/plan");
    });

    it("is not shown when the list is empty: there is no shopping list to open", async () => {
      mockServer({ recipes: [STEW] });
      renderAt("/plan");
      await screen.findByRole("heading", { level: 2, name: "Nothing planned yet" });
      expect(screen.queryByRole("link", { name: "Shopping list" })).not.toBeInTheDocument();
    });

    it("goes when the last recipe is taken off the list", async () => {
      mockServer({ recipes: [CHILI] });
      renderAt("/plan");
      await screen.findByRole("link", { name: "Shopping list" });
      await userEvent.click(screen.getByRole("button", { name: "Remove Chili from the plan" }));
      await screen.findByRole("heading", { level: 2, name: "Nothing planned yet" });
      expect(screen.queryByRole("link", { name: "Shopping list" })).not.toBeInTheDocument();
    });
  });

  it("spec example: one list in the server's A–Z order, the same line twice, each with its recipe's name", async () => {
    await openShoppingList();
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(SPEC_EXAMPLE);
    expect(screen.getByText("4 items from 2 recipes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).not.toBeChecked();
  });

  it("shows the lines in the order the server sends, without sorting them again", async () => {
    const answer: ShoppingItem[] = [
      { text: "zucchini", recipeId: CHILI_ID, recipeName: "Chili" },
      { text: "apples", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" },
    ];
    await openShoppingList({ shopping: () => jsonResponse(200, answer) });
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual([
      ["zucchini", "Chili"],
      ["apples", "Shakshuka"],
    ]);
  });

  it("leaves out prep and steps, and loads the list in one request, not recipe by recipe", async () => {
    const { fetchMock } = await openShoppingList();
    await screen.findByRole("list", { name: "Shopping list" });
    expect(screen.queryByText("Slice the peppers")).not.toBeInTheDocument();
    expect(screen.queryByText("Cook it.")).not.toBeInTheDocument();
    expect(gets(fetchMock, "/plan/shopping-list")).toBe(1);
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.startsWith("/recipes/"))).toEqual([]);
  });

  it("counts in the singular: 1 item from 1 recipe", async () => {
    await openShoppingList({ recipes: [recipe(CHILI_ID, "Chili", { ingredients: ["1 can tomatoes"], toMake: CHILI.toMake })] });
    expect(await screen.findByText("1 item from 1 recipe")).toBeInTheDocument();
  });

  it("ticks a line off and unticks it, striking through only that line, and sends nothing", async () => {
    const { fetchMock } = await openShoppingList();
    await screen.findByRole("list", { name: "Shopping list" });
    const before = fetchMock.mock.calls.length;
    const eggs = screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" });

    await userEvent.click(eggs);
    expect(eggs).toBeChecked();
    expect(eggs.closest("label")).toHaveClass("ticked");
    expect(checkboxes().map((box) => box.checked)).toEqual([false, false, false, true]);

    await userEvent.click(eggs);
    expect(eggs).not.toBeChecked();
    expect(eggs.closest("label")).not.toHaveClass("ticked");
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("ticks one of two identical lines without the other", async () => {
    await openShoppingList();
    await screen.findByRole("list", { name: "Shopping list" });
    await userEvent.click(screen.getByRole("checkbox", { name: "1 can tomatoes, Shakshuka" }));
    expect(screen.getByRole("checkbox", { name: "1 can tomatoes, Chili" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "1 can tomatoes, Shakshuka" })).toBeChecked();
  });

  it("clears the ticks when the editor leaves the shopping list and comes back", async () => {
    const { router } = await openShoppingList();
    await screen.findByRole("list", { name: "Shopping list" });
    await userEvent.click(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "500 g beef mince, Chili" }));

    await userEvent.click(backLink());
    await screen.findByRole("heading", { level: 1, name: "Plan" });
    expect(router.state.location.pathname).toBe("/plan");
    await act(() => router.navigate("/plan/shopping"));
    await screen.findByRole("list", { name: "Shopping list" });
    expect(checkboxes().map((box) => box.checked)).toEqual([false, false, false, false]);
  });

  it("keeps a tick on its line when the list reloads with other lines", async () => {
    let answer: ShoppingItem[] | undefined;
    const { queryClient } = await openShoppingList({ shopping: () => (answer === undefined ? undefined : jsonResponse(200, answer)) });
    await screen.findByRole("list", { name: "Shopping list" });
    await userEvent.click(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" }));

    answer = [
      { text: "1 can tomatoes", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" },
      { text: "6 eggs", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" },
    ];
    await act(() => queryClient.invalidateQueries({ queryKey: shoppingListKeys.all }));
    await waitFor(() => expect(lines()).toHaveLength(2));
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "1 can tomatoes, Shakshuka" })).not.toBeChecked();
  });

  it("keeps the ticks while the list is dropped and slowly reloaded on the open page, as when a recipe is added", async () => {
    const { queryClient, recipes } = await openShoppingList({ reloadDelayMs: 100 });
    await screen.findByRole("list", { name: "Shopping list" });
    await userEvent.click(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" }));

    // The add-to-plan answer arrives (from another tab or an earlier request) while the editor is here.
    const stew = recipes.find((r) => r.id === STEW_ID);
    if (stew === undefined) throw new Error("No Beef Stew");
    stew.toMake = { addedAt: "2026-10-03T08:00:00.000Z" };
    act(() => showSavedRecipe(queryClient, { ...stew }, { tagsChanged: false }));
    expect(await screen.findByText("Loading the shopping list…")).toBeInTheDocument();

    expect(await screen.findByRole("checkbox", { name: "1 kg beef, Beef Stew" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).toBeChecked();
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(1);
  });

  it("has a way back to the Plan", async () => {
    await openShoppingList();
    expect(backLink()).toHaveAttribute("href", "/plan");
  });

  it("says there is nothing to shop for when the list is empty, with a way to the recipes", async () => {
    await openShoppingList({ recipes: [STEW] });
    expect(await screen.findByRole("heading", { level: 2, name: "Nothing to shop for" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("list", { name: "Shopping list" })).not.toBeInTheDocument();
    expect(screen.queryByText(/items? from/)).not.toBeInTheDocument();
  });

  it("says loading, not empty, while the list loads", async () => {
    await openShoppingList({ shopping: never });
    expect(await screen.findByText("Loading the shopping list…")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to shop for")).not.toBeInTheDocument();
  });

  it("shows a failure to load with a way to try again, never the empty message", async () => {
    let attempt = 0;
    await openShoppingList({ shopping: () => (++attempt === 1 ? jsonResponse(500, { errors: [] }) : undefined) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the shopping list.");
    expect(screen.queryByText("Nothing to shop for")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(SPEC_EXAMPLE);
  });

  describe("never shows what has changed since it loaded", () => {
    it("leaves out a deleted planned recipe at once, before the list reloads (REC-6, PLAN-6)", async () => {
      let hold = false;
      const { queryClient, fetchMock } = await openShoppingList({ shopping: () => (hold ? never() : undefined) });
      await screen.findByRole("list", { name: "Shopping list" });
      hold = true;
      act(() => recipeDeleted(queryClient, { id: SHAKSHUKA_ID, name: "Shakshuka", tags: [] }));
      await waitFor(() => expect(gets(fetchMock, "/plan/shopping-list")).toBe(2));
      expect(lines()).toEqual([
        ["1 can tomatoes", "Chili"],
        ["500 g beef mince", "Chili"],
      ]);
      expect(screen.getByText("2 items from 1 recipe")).toBeInTheDocument();
    });

    it("leaves out a recipe taken off the Plan when the editor comes back (PLAN-4)", async () => {
      let hold = false;
      const { router } = await openShoppingList({ shopping: () => (hold ? never() : undefined) });
      await screen.findByRole("list", { name: "Shopping list" });
      await act(() => router.navigate("/plan"));
      hold = true;
      await userEvent.click(await screen.findByRole("button", { name: "Remove Chili from the plan" }));
      await waitFor(() => expect(screen.queryByText("Chili")).not.toBeInTheDocument());
      await act(() => router.navigate("/plan/shopping"));
      await screen.findByRole("list", { name: "Shopping list" });
      expect(lines()).toEqual([
        ["1 can tomatoes", "Shakshuka"],
        ["6 eggs", "Shakshuka"],
      ]);
    });

    it("drops the cached list rather than show old lines when a planned recipe's ingredients change (REC-5)", async () => {
      let hold = false;
      const { queryClient } = await openShoppingList({ shopping: () => (hold ? never() : undefined) });
      await screen.findByRole("list", { name: "Shopping list" });
      hold = true;
      act(() => showSavedRecipe(queryClient, { ...CHILI, ingredients: ["2 cans tomatoes"] }, { tagsChanged: true }));
      expect(await screen.findByText("Loading the shopping list…")).toBeInTheDocument();
      expect(screen.queryByText("500 g beef mince")).not.toBeInTheDocument();
    });

    it("drops the cached list when a recipe is added to the plan, since only the server can place its lines (PLAN-1)", () => {
      mockServer();
      const { queryClient } = renderAt("/");
      queryClient.setQueryData<ShoppingItem[]>(shoppingListKeys.all, [{ text: "6 eggs", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" }]);
      act(() => showSavedRecipe(queryClient, { ...STEW, toMake: { addedAt: "2026-10-03T08:00:00.000Z" } }, { tagsChanged: false }));
      expect(queryClient.getQueryData(shoppingListKeys.all)).toBeUndefined();
    });

    it("keeps the cached lines, marked for reload, when a planned recipe changes in a way they don't show (a photo)", () => {
      mockServer();
      const { queryClient } = renderAt("/");
      const cached: ShoppingItem[] = [
        { text: "1 can tomatoes", recipeId: CHILI_ID, recipeName: "Chili" },
        { text: "500 g beef mince", recipeId: CHILI_ID, recipeName: "Chili" },
      ];
      queryClient.setQueryData<ShoppingItem[]>(shoppingListKeys.all, cached);
      act(() => showSavedRecipe(queryClient, { ...CHILI, hasPhoto: true }, { tagsChanged: false }));
      expect(queryClient.getQueryData(shoppingListKeys.all)).toEqual(cached);
      expect(queryClient.getQueryState(shoppingListKeys.all)?.isInvalidated).toBe(true);
    });
  });

  it.each([
    ["visitors", VISITOR, "Sign in to see this"],
    ["signed-in non-editors", NON_EDITOR, "Only editors can see this"],
  ])("is not shown or loaded for %s (X-1)", async (_who, me, heading) => {
    const { fetchMock } = mockServer({ me });
    renderAt("/plan/shopping");
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(gets(fetchMock, "/plan/shopping-list")).toBe(0);
    expect(screen.queryByText("6 eggs")).not.toBeInTheDocument();
    expect(screen.queryByText("Shakshuka")).not.toBeInTheDocument();
  });
});
