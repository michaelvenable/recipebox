import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorRecipeSummary, Me, RecipeSummary, TagCount } from "@recipebox/shared";
import { API, EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const BEEF_STEW: RecipeSummary = {
  id: "0b6a3c2e-0000-4000-8000-000000000001",
  name: "Beef Stew",
  tags: ["dinner", "slow"],
  totalTimeMinutes: 150,
  hasPhoto: false,
};
const PAD_THAI: RecipeSummary = {
  id: "0b6a3c2e-0000-4000-8000-000000000002",
  name: "Pad Thai",
  tags: ["dinner", "noodles", "quick"],
  totalTimeMinutes: 30,
  hasPhoto: true,
};
const TOAST: RecipeSummary = { id: "0b6a3c2e-0000-4000-8000-000000000003", name: "Toast", tags: [], hasPhoto: false };
const ALL = [BEEF_STEW, PAD_THAI, TOAST];

const TAGS: TagCount[] = [
  { tag: "dinner", count: 2 },
  { tag: "noodles", count: 1 },
  { tag: "quick", count: 1 },
  { tag: "slow", count: 1 },
];

function asEditor(recipe: RecipeSummary, onToMakeList = false): EditorRecipeSummary {
  return { ...recipe, onToMakeList };
}

interface FakeApi {
  me?: Me;
  /** The answer to GET /recipes, given its query. The server's matching isn't faked; each test says what it returns. */
  recipes?: (url: URL) => unknown;
  tags?: () => Response;
}

function mockListApi({ me = VISITOR, recipes = () => ALL, tags = () => jsonResponse(200, TAGS) }: FakeApi = {}): FetchMock {
  return mockApi(me, (url) => {
    if (url.pathname === "/recipes") {
      const answer = recipes(url);
      return answer instanceof Response || answer instanceof Promise ? answer : jsonResponse(200, answer);
    }
    if (url.pathname === "/tags") return tags();
    return undefined;
  });
}

/** The query strings GET /recipes was called with, in order ("" for the unfiltered list). */
function listQueries(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === "/recipes")
    .map((url) => url.search);
}

function recipeLinks(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Recipes" })).getAllByRole("link");
}

function searchField(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Search by name" });
}

async function chip(name: string): Promise<HTMLElement> {
  return within(await screen.findByRole("group", { name: "Filter by tag" })).getByRole("button", { name });
}

describe("REC-8 list", () => {
  it("shows the recipes in the order the server sorted them, each linking to the recipe", async () => {
    mockListApi({ recipes: () => [PAD_THAI, BEEF_STEW, TOAST] });
    renderAt("/");
    await screen.findByText("Pad Thai");
    expect(recipeLinks().map((link) => link.getAttribute("href"))).toEqual([
      `/recipes/${PAD_THAI.id}`,
      `/recipes/${BEEF_STEW.id}`,
      `/recipes/${TOAST.id}`,
    ]);
  });

  it("shows the name, total time and tags of each recipe", async () => {
    mockListApi();
    renderAt("/");
    const [beef, pad, toast] = await screen.findAllByRole("link", { name: /Beef Stew|Pad Thai|Toast/ });
    expect(beef).toHaveTextContent("Beef Stew2 h 30 min · dinner, slow");
    expect(pad).toHaveTextContent("Pad Thai30 min · dinner, noodles, quick");
    expect(toast).toHaveTextContent(/^Toast$/);
  });

  it("shows the thumbnail of a recipe with a photo, and a placeholder for one without", async () => {
    mockListApi();
    renderAt("/");
    const photo = await screen.findByRole("img", { name: "Pad Thai photo" });
    expect(photo).toHaveAttribute("src", `${API}/recipes/${PAD_THAI.id}/thumbnail`);
    expect(screen.getAllByRole("img")).toEqual([photo]);
    const beef = screen.getByRole("link", { name: /Beef Stew/ });
    expect(beef.querySelector(".thumb-placeholder")).not.toBeNull();
  });

  it("shows the placeholder if the thumbnail can't be loaded", async () => {
    mockListApi();
    renderAt("/");
    fireEvent.error(await screen.findByRole("img", { name: "Pad Thai photo" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pad Thai/ }).querySelector(".thumb-placeholder")).not.toBeNull();
  });

  it("shows a loading message until the list arrives", async () => {
    mockListApi({ recipes: () => new Promise<Response>(() => {}) });
    renderAt("/");
    expect(await screen.findByText("Loading recipes…")).toHaveAttribute("role", "status");
  });

  it("shows an error with a way to try again", async () => {
    let attempts = 0;
    mockListApi({ recipes: () => (++attempts === 1 ? jsonResponse(500, { errors: [] }) : ALL) });
    renderAt("/");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the recipes.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Pad Thai")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("invites editors to add the first recipe when there are none", async () => {
    mockListApi({ me: EDITOR, recipes: () => [], tags: () => jsonResponse(200, []) });
    renderAt("/");
    expect(await screen.findByText("No recipes yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first recipe" })).toHaveAttribute("href", "/recipes/new");
    expect(screen.queryByRole("group", { name: "Filter by tag" })).not.toBeInTheDocument();
  });

  it("tells visitors there are no recipes, with nothing to add them", async () => {
    mockListApi({ recipes: () => [], tags: () => jsonResponse(200, []) });
    renderAt("/");
    expect(await screen.findByText("No recipes yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add your first recipe" })).not.toBeInTheDocument();
  });
});

describe("REC-9 search by name", () => {
  it("labels the search for screen readers only, with Find a recipe as its placeholder", async () => {
    mockListApi();
    renderAt("/");
    await screen.findByText("Pad Thai");
    expect(searchField()).toHaveAttribute("placeholder", "Find a recipe");
    expect(screen.getByText("Search by name")).toHaveClass("visually-hidden");
  });

  it("searches once typing pauses, and keeps the term in the address", async () => {
    const fetchMock = mockListApi({ recipes: (url) => (url.searchParams.get("name") === "chick" ? [] : ALL) });
    const { router } = renderAt("/");
    await screen.findByText("Pad Thai");

    await userEvent.type(searchField(), "chick");
    // Not yet: the search waits for a pause in typing.
    expect(listQueries(fetchMock)).toEqual([""]);
    expect(router.state.location.search).toBe("");

    await waitFor(() => expect(listQueries(fetchMock)).toEqual(["", "?name=chick"]));
    expect(router.state.location.search).toBe("?name=chick");
  });

  it("searches at once on Enter", async () => {
    const fetchMock = mockListApi();
    const { router } = renderAt("/");
    await screen.findByText("Pad Thai");
    await userEvent.type(searchField(), "pad{Enter}");
    expect(router.state.location.search).toBe("?name=pad");
    await waitFor(() => expect(listQueries(fetchMock)).toEqual(["", "?name=pad"]));
  });

  it("passes the term to the server as typed; the server does the matching (X-13)", async () => {
    const fetchMock = mockListApi();
    renderAt("/");
    await screen.findByText("Pad Thai");
    await userEvent.type(searchField(), "Crème ");
    await waitFor(() => expect(listQueries(fetchMock)).toContain(`?name=${encodeURIComponent("Crème ")}`));
  });

  it("restores the search from the address on load", async () => {
    const fetchMock = mockListApi({ recipes: () => [PAD_THAI] });
    renderAt("/?name=pad");
    await screen.findByText("Pad Thai");
    expect(searchField()).toHaveValue("pad");
    expect(listQueries(fetchMock)).toEqual(["?name=pad"]);
    // In the page: the layout has a live region of its own for messages such as Undo (REC-6).
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("1 recipe matches “pad”");
  });

  it("restores the search on Back after opening a recipe", async () => {
    mockListApi();
    const { router } = renderAt("/");
    await screen.findByText("Pad Thai");
    await userEvent.type(searchField(), "pad{Enter}");
    await userEvent.click(screen.getByRole("link", { name: /Pad Thai/ }));
    expect(router.state.location.pathname).toBe(`/recipes/${PAD_THAI.id}`);

    await router.navigate(-1);
    expect(router.state.location.search).toBe("?name=pad");
    expect(await screen.findByRole("searchbox", { name: "Search by name" })).toHaveValue("pad");
  });

  it("says no recipes match the term, and offers to show all recipes", async () => {
    const fetchMock = mockListApi({ recipes: (url) => (url.search === "" ? ALL : []) });
    const { router } = renderAt("/?name=%20zzz%20");
    expect(await screen.findByText(/No recipes match “zzz”/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all recipes" }));
    expect(await screen.findByText("Pad Thai")).toBeInTheDocument();
    expect(searchField()).toHaveValue("");
    expect(searchField()).toHaveFocus();
    expect(router.state.location.search).toBe("");
    expect(listQueries(fetchMock)).toEqual([`?name=${encodeURIComponent(" zzz ")}`, ""]);
  });

  it("doesn't call the collection empty while the unfiltered list loads after showing all", async () => {
    let answerAll: (response: Response) => void = () => {};
    mockListApi({
      me: EDITOR,
      recipes: (url) =>
        url.search === "" ? new Promise<Response>((resolve) => (answerAll = resolve)) : jsonResponse(200, []),
    });
    renderAt("/?name=zzz");
    expect(await screen.findByText(/No recipes match “zzz”/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all recipes" }));
    await waitFor(() => expect(screen.queryByText(/No recipes match/)).not.toBeInTheDocument());
    expect(screen.queryByText("No recipes yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add your first recipe" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading recipes…")).toBeInTheDocument();

    answerAll(jsonResponse(200, ALL.map((r) => asEditor(r))));
    expect(await screen.findByText("Pad Thai")).toBeInTheDocument();
    expect(screen.queryByText("Loading recipes…")).not.toBeInTheDocument();
  });

  it("keeps the same summary while refining a search that matched nothing, without a loading message", async () => {
    let answerZzz: (response: Response) => void = () => {};
    mockListApi({
      recipes: (url) =>
        url.search === "?name=zzz" ? new Promise<Response>((resolve) => (answerZzz = resolve)) : jsonResponse(200, []),
    });
    const { router } = renderAt("/?name=zz");
    const summary = await screen.findByText(/No recipes match “zz”/);

    await userEvent.type(searchField(), "z");
    await waitFor(() => expect(router.state.location.search).toBe("?name=zzz"));
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent("Searching…");
    expect(screen.queryByText("Loading recipes…")).not.toBeInTheDocument();

    answerZzz(jsonResponse(200, []));
    await waitFor(() => expect(summary).toHaveTextContent("No recipes match “zzz”"));
    expect(screen.queryByText("Loading recipes…")).not.toBeInTheDocument();
  });

  it("follows the address when it changes, such as from the Recipes link in the navigation", async () => {
    mockListApi();
    const { router } = renderAt("/?name=pad");
    await screen.findByText("Pad Thai");
    await router.navigate("/");
    await waitFor(() => expect(searchField()).toHaveValue(""));
  });
});

describe("REC-13 filter by tags", () => {
  it("offers every tag with its count, in the server's order, none picked", async () => {
    mockListApi();
    renderAt("/");
    const group = await screen.findByRole("group", { name: "Filter by tag" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["dinner · 2", "noodles · 1", "quick · 1", "slow · 1"]);
    for (const c of chips) expect(c).toHaveAttribute("aria-pressed", "false");
  });

  it("picks tags, combining them, and keeps them in the address", async () => {
    const fetchMock = mockListApi({
      recipes: (url) => ({ "": ALL, "?tags=dinner": [BEEF_STEW, PAD_THAI], "?tags=dinner,quick": [PAD_THAI] })[url.search],
    });
    const { router } = renderAt("/");
    await screen.findByText("Pad Thai");

    await userEvent.click(await chip("dinner · 2"));
    expect(await chip("dinner · 2")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(recipeLinks()).toHaveLength(2));

    await userEvent.click(await chip("quick · 1"));
    await waitFor(() => expect(recipeLinks()).toHaveLength(1));
    expect(router.state.location.search).toBe("?tags=dinner,quick");
    expect(listQueries(fetchMock)).toEqual(["", "?tags=dinner", "?tags=dinner,quick"]);
  });

  it("shows no summary and no Show all recipes when only tags are picked and some recipes match", async () => {
    mockListApi({ recipes: (url) => (url.search === "" ? ALL : [BEEF_STEW, PAD_THAI]) });
    renderAt("/?tags=dinner");
    await waitFor(() => expect(recipeLinks()).toHaveLength(2));
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("");
    expect(screen.queryByText(/tagged/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all recipes" })).not.toBeInTheDocument();
  });

  it("shows the unfiltered list once every picked tag is unpicked", async () => {
    const fetchMock = mockListApi({ recipes: (url) => (url.search === "" ? ALL : [PAD_THAI]) });
    const { router } = renderAt("/?tags=dinner,quick");
    await screen.findByText("Pad Thai");

    await userEvent.click(await chip("dinner · 2"));
    await userEvent.click(await chip("quick · 1"));
    expect(await screen.findByText("Beef Stew")).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
    expect(listQueries(fetchMock)).toEqual(["?tags=dinner,quick", "?tags=quick", ""]);
    expect(screen.queryByRole("button", { name: "Show all recipes" })).not.toBeInTheDocument();
  });

  it("restores picked tags and the search from the address, and sends both", async () => {
    const fetchMock = mockListApi({ recipes: () => [BEEF_STEW] });
    renderAt("/?name=b&tags=dinner");
    await screen.findByText("Beef Stew");
    expect(await chip("dinner · 2")).toHaveAttribute("aria-pressed", "true");
    expect(await chip("quick · 1")).toHaveAttribute("aria-pressed", "false");
    expect(searchField()).toHaveValue("b");
    expect(listQueries(fetchMock)).toEqual(["?name=b&tags=dinner"]);
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("1 recipe matches “b” with the tag dinner");
  });

  it("applies a term still being typed along with a picked tag", async () => {
    const fetchMock = mockListApi();
    const { router } = renderAt("/");
    await screen.findByText("Pad Thai");
    await userEvent.type(searchField(), "b");
    await userEvent.click(await chip("dinner · 2"));
    expect(router.state.location.search).toBe("?name=b&tags=dinner");
    await waitFor(() => expect(listQueries(fetchMock)).toEqual(["", "?name=b&tags=dinner"]));
  });

  it("says when no recipe has every picked tag, and offers to show all", async () => {
    mockListApi({ recipes: (url) => (url.search === "" ? ALL : []) });
    renderAt("/?tags=noodles,slow");
    expect(await screen.findByText(/No recipes tagged noodles and slow/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show all recipes" }));
    expect(await screen.findByText("Beef Stew")).toBeInTheDocument();
    expect(await chip("noodles · 1")).toHaveAttribute("aria-pressed", "false");
  });

  it("says when the tags can't be loaded, and loads them on request", async () => {
    let attempts = 0;
    mockListApi({ tags: () => (++attempts === 1 ? jsonResponse(500, { errors: [] }) : jsonResponse(200, TAGS)) });
    renderAt("/");
    expect(await screen.findByText(/Couldn't load the tags/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await chip("dinner · 2")).toBeInTheDocument();
    expect(screen.getByText("Pad Thai")).toBeInTheDocument();
  });
});

describe("PLAN-7, X-1 to-make indicator", () => {
  it("marks recipes on the to-make list for editors", async () => {
    mockListApi({ me: EDITOR, recipes: () => [asEditor(BEEF_STEW), asEditor(PAD_THAI, true), asEditor(TOAST)] });
    renderAt("/");
    expect(await screen.findByRole("link", { name: /Pad Thai/ })).toHaveTextContent("Plan");
    expect(screen.getByRole("link", { name: /Beef Stew/ })).not.toHaveTextContent("Plan");
    expect(screen.getAllByText("Plan", { selector: ".to-make-badge" })).toHaveLength(1);
  });

  it("shows visitors no indicator; their list has no to-make field", async () => {
    mockListApi({ me: VISITOR });
    renderAt("/");
    await screen.findByText("Pad Thai");
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
  });

  it("shows no indicator when the app knows the person is a visitor, even if the list has the editor shape", async () => {
    // For instance, a list loaded as an editor and still cached after the session ended (X-9) and /me was reloaded.
    mockListApi({ me: VISITOR, recipes: () => [asEditor(BEEF_STEW), asEditor(PAD_THAI, true)] });
    renderAt("/");
    await screen.findByText("Pad Thai");
    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
  });

  it("refuses a list mixing visitor and editor shapes as a contract error", async () => {
    mockListApi({ recipes: () => [asEditor(PAD_THAI, true), BEEF_STEW] });
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the recipes.");
  });
});

describe("X-8 editing controls on the list", () => {
  it("gives editors the Catalog heading and an Add recipe link", async () => {
    mockListApi({ me: EDITOR, recipes: () => ALL.map((r) => asEditor(r)) });
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Catalog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add recipe" })).toHaveAttribute("href", "/recipes/new");
  });

  it.each([
    ["visitors", VISITOR],
    ["signed-in non-editors", NON_EDITOR],
  ])("gives %s the Recipe Box heading and no Add recipe link", async (_who, me) => {
    mockListApi({ me });
    renderAt("/");
    await screen.findByText("Pad Thai");
    expect(screen.getByRole("heading", { level: 1, name: "Recipe Box" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add/ })).not.toBeInTheDocument();
  });
});

describe("REC-22 recently added", () => {
  /** Local time on the device, in the tests' time zone (America/New_York; X-12). */
  function local(monthIndex: number, day: number, hours = 12, minutes = 0): Date {
    return new Date(2026, monthIndex, day, hours, minutes);
  }

  /** The device's clock (X-12). Only `Date` is faked, so typing and the search pause run as usual. */
  function setClock(now: Date) {
    vi.useFakeTimers({ now, shouldAdvanceTime: true, toFake: ["Date"] });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  let nextId = 100;
  function added(name: string, at: Date | undefined, extra: Partial<RecipeSummary> = {}): RecipeSummary {
    nextId += 1;
    const id = `0b6a3c2e-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
    return { id, name, tags: [], hasPhoto: false, ...(at === undefined ? {} : { createdAt: at.toISOString() }), ...extra };
  }

  function row(): HTMLElement | null {
    return screen.queryByRole("list", { name: "Recently added" });
  }

  /** The names on the row's cards, in order; empty when there is no row. */
  function rowNames(): string[] {
    const list = row();
    if (list === null) return [];
    return within(list)
      .getAllByRole("link")
      .map((link) => link.querySelector(".recent-card-name")?.textContent ?? "");
  }

  async function listShown(): Promise<void> {
    await screen.findByRole("list", { name: "Recipes" });
  }

  it("spec example: today Nov 8, A added Nov 8, B Nov 5, C Oct 1, D before added times: A, B", async () => {
    setClock(local(10, 8, 12));
    const a = added("A", local(10, 8, 9));
    const b = added("B", local(10, 5, 9));
    const c = added("C", local(9, 1, 9));
    const d = added("D", undefined);
    mockListApi({ recipes: () => [a, b, c, d] });
    renderAt("/");
    await listShown();

    expect(rowNames()).toEqual(["A", "B"]);
    // The list below is unchanged: every recipe, including those in the row.
    expect(recipeLinks().map((link) => link.getAttribute("href"))).toEqual([a, b, c, d].map((r) => `/recipes/${r.id}`));
  });

  it("shows each recipe's thumbnail or the placeholder, its name and 'Added <date>', linking to the recipe (REC-4)", async () => {
    setClock(local(10, 8, 12));
    const withPhoto = added("Pad Thai", local(10, 8, 9), { hasPhoto: true });
    const without = added("Banana Bread", local(10, 5, 9));
    mockListApi({ recipes: () => [without, withPhoto] });
    renderAt("/");
    await listShown();

    const [first, second] = within(row()!).getAllByRole("link");
    expect(first).toHaveAttribute("href", `/recipes/${withPhoto.id}`);
    expect(within(first!).getByRole("img", { name: "Pad Thai photo" })).toHaveAttribute(
      "src",
      `${API}/recipes/${withPhoto.id}/thumbnail`,
    );
    expect(first).toHaveTextContent("Pad ThaiAdded Nov 8");
    expect(second).toHaveAttribute("href", `/recipes/${without.id}`);
    expect(second!.querySelector(".thumb-placeholder")).not.toBeNull();
    expect(second).toHaveTextContent("Banana BreadAdded Nov 5");
  });

  it("sits under a 'Recently added' heading, with an 'All recipes' heading over the list", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("A", local(10, 8, 9))] });
    renderAt("/");
    await listShown();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Recently added", "All recipes"]);
  });

  it("shows the day added in the device's time zone (X-12)", async () => {
    setClock(local(10, 8, 12));
    // 03:00 UTC on Nov 8 is still Nov 7 in New York.
    mockListApi({ recipes: () => [{ ...added("Late Supper", undefined), createdAt: "2026-11-08T03:00:00.000Z" }] });
    renderAt("/");
    await listShown();
    expect(within(row()!).getByRole("link")).toHaveTextContent("Added Nov 7");
  });

  it("spec example: 10 recipes added this week: shows the newest 8, newest first", async () => {
    setClock(local(10, 8, 20));
    const recipes = Array.from({ length: 10 }, (_, i) => added(`Recipe ${String(i).padStart(2, "0")}`, local(10, 2, 8 + i)));
    mockListApi({ recipes: () => recipes });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["09", "08", "07", "06", "05", "04", "03", "02"].map((n) => `Recipe ${n}`));
  });

  it("orders recipes added at the same time by name, keeping the server's order (X-13)", async () => {
    setClock(local(10, 8, 12));
    const same = local(10, 6, 9);
    // The server sorts the list by name (REC-8, X-13): "apple pie", "Éclair", "Shakshuka", "Zucchini Bread".
    const recipes = [
      added("apple pie", same),
      added("Éclair", same),
      added("Shakshuka", local(10, 7, 9)),
      added("Zucchini Bread", same),
    ];
    mockListApi({ recipes: () => recipes });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Shakshuka", "apple pie", "Éclair", "Zucchini Bread"]);
  });

  it("spec example: today Nov 8; A added Oct 9 at 11:30 pm, B Oct 8 at 9 am: A", async () => {
    // 11 pm on Nov 8 in New York (Nov 9, 04:00 UTC): 30 x 24 hours back would be midnight on Oct 10 and leave out A.
    setClock(local(10, 8, 23));
    expect(new Date().toISOString().slice(0, 16)).toBe("2026-11-09T04:00");
    // 11:30 pm on Oct 9 in New York is already Oct 10 in UTC: the device's date is the one that counts (X-12).
    const a = added("A", local(9, 9, 23, 30));
    expect(a.createdAt).toBe("2026-10-10T03:30:00.000Z");
    mockListApi({ recipes: () => [a, added("B", local(9, 8, 9))] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["A"]);
  });

  // The days are local calendar days, not 30 x 24 hours. Between Oct 9 (EDT) and Nov 8 (EST) the clocks went back on Nov 1,
  // so 30 x 24 hours before the first minute of Nov 8 is 1:01 am on Oct 9, which would leave out a recipe added at 12:30 am.
  it.each([
    ["the first minute of Nov 8", local(10, 8, 0, 1)],
    ["the last minute of Nov 8", local(10, 8, 23, 59)],
  ])("at %s, shows all of Oct 9 and none of Oct 8, across the daylight saving change (X-12)", async (_when, now) => {
    setClock(now);
    const recipes = [
      added("Oct 8, 11:59 pm", local(9, 8, 23, 59)),
      added("Oct 9, 12:30 am", local(9, 9, 0, 30)),
      added("Oct 9, 11:59 pm", local(9, 9, 23, 59)),
    ];
    // Oct 8 at 11:59 pm in New York is Oct 9 in UTC, yet it is out.
    expect(recipes[0]!.createdAt).toBe("2026-10-09T03:59:00.000Z");
    mockListApi({ recipes: () => recipes });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Oct 9, 11:59 pm", "Oct 9, 12:30 am"]);
  });

  it("at noon on Nov 8, shows a recipe added at 9 am on Oct 9, which 30 x 24 hours would leave out", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("Oct 9, 9 am", local(9, 9, 9))] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Oct 9, 9 am"]);
  });

  it("on Nov 9, a recipe added on Oct 9 is no longer shown", async () => {
    setClock(local(10, 9, 0, 1));
    mockListApi({ recipes: () => [added("Oct 9", local(9, 9, 23, 59)), added("Oct 10", local(9, 10, 0, 0))] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Oct 10"]);
  });

  it("spec example: no recipe added in the last 30 days: no row, and no headings over the list", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("Old", local(9, 1, 9)), added("Older", undefined)] });
    renderAt("/");
    await listShown();
    expect(row()).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recently added" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All recipes" })).not.toBeInTheDocument();
  });

  it('spec example: search "chick" typed: no row, from the first key, before the search is applied (REC-9)', async () => {
    setClock(local(10, 8, 12));
    const chickpea = added("Chickpea Curry", local(10, 7, 9));
    const fetchMock = mockListApi({
      recipes: (url) => (url.searchParams.get("name") === "chick" ? [chickpea] : [chickpea, PAD_THAI]),
    });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Chickpea Curry"]);

    await userEvent.type(searchField(), "c");
    expect(row()).not.toBeInTheDocument();
    await userEvent.type(searchField(), "hick");
    await waitFor(() => expect(listQueries(fetchMock)).toContain("?name=chick"));
    await waitFor(() => expect(recipeLinks()).toHaveLength(1));
    expect(row()).not.toBeInTheDocument();
  });

  it("isn't shown for a search in the address either", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("Chickpea Curry", local(10, 7, 9))] });
    renderAt("/?name=chick");
    await listShown();
    expect(row()).not.toBeInTheDocument();
  });

  it("isn't shown while tags are picked (REC-13), and comes back when they are unpicked", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("Beef Stew", local(10, 7, 9), { tags: ["dinner", "slow"] })] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["Beef Stew"]);

    await userEvent.click(await chip("dinner · 2"));
    await waitFor(() => expect(row()).not.toBeInTheDocument());
    await userEvent.click(await chip("dinner · 2"));
    await waitFor(() => expect(rowNames()).toEqual(["Beef Stew"]));
  });

  it("stays shown for a blank search, which searches nothing (REC-9)", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ recipes: () => [added("A", local(10, 8, 9))] });
    renderAt("/");
    await listShown();
    await userEvent.type(searchField(), "   ");
    expect(rowNames()).toEqual(["A"]);
  });

  it.each([
    ["visitors", VISITOR],
    ["signed-in non-editors", NON_EDITOR],
  ])("is shown to %s: the row and the added dates are public (X-1)", async (_who, me) => {
    setClock(local(10, 8, 12));
    mockListApi({ me, recipes: () => [added("A", local(10, 8, 9))] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["A"]);
  });

  it("is shown to editors too", async () => {
    setClock(local(10, 8, 12));
    mockListApi({ me: EDITOR, recipes: () => [asEditor(added("A", local(10, 8, 9)))] });
    renderAt("/");
    await listShown();
    expect(rowNames()).toEqual(["A"]);
  });
});

describe("REC-23 waking the server", () => {
  const LOADING = "Loading recipes…";
  const WAKING = "Loading recipes… (waking up the server)";

  /**
   * Only the timers are faked, and they move only when a test says so, so it can stop just before 5 seconds. Each answer to
   * GET /recipes waits until the test gives it.
   */
  function slowList(me: Me = VISITOR) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const answers: ((response: Response) => void)[] = [];
    mockListApi({ me, recipes: () => new Promise<Response>((resolve) => answers.push(resolve)) });
    return {
      /** Answers the latest GET /recipes. */
      answer: (response: Response) => answers.at(-1)?.(response),
      requests: () => answers.length,
    };
  }

  /** Moves the device's clock on by `ms`, running whatever was waiting for it. */
  async function wait(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
  }

  /** Lets the page load what it can without moving the clock. */
  async function settle() {
    for (let i = 0; i < 5; i += 1) await wait(0);
  }

  function status(): HTMLElement {
    return screen.getByText(/^Loading recipes…/);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spec example: the list arrives after 3 seconds: only 'Loading recipes…' was shown", async () => {
    const list = slowList();
    renderAt("/");
    await settle();
    expect(status()).toHaveTextContent(new RegExp(`^${LOADING}$`));
    for (let second = 1; second <= 3; second += 1) {
      await wait(1_000);
      expect(screen.queryByText(WAKING)).not.toBeInTheDocument();
      expect(screen.getByText(LOADING)).toBeInTheDocument();
    }
    list.answer(jsonResponse(200, ALL));
    await settle();
    expect(screen.getByText("Pad Thai")).toBeInTheDocument();
    expect(screen.queryByText(/^Loading recipes…/)).not.toBeInTheDocument();
    // Nothing left to change after the list is shown.
    await wait(10_000);
    expect(screen.queryByText(/^Loading recipes…/)).not.toBeInTheDocument();
  });

  it("spec example: the list arrives after 12 seconds: '(waking up the server)' is added at 5 seconds", async () => {
    const list = slowList();
    renderAt("/");
    await settle();
    const region = status();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveTextContent(new RegExp(`^${LOADING}$`));

    await wait(5_000);
    // The same live region, its text changed in place.
    expect(status()).toBe(region);
    expect(region).toHaveTextContent(WAKING);
    expect(screen.getAllByRole("status").filter((el) => /Loading/.test(el.textContent ?? ""))).toHaveLength(1);

    await wait(7_000);
    expect(region).toHaveTextContent(WAKING);
    list.answer(jsonResponse(200, ALL));
    await settle();
    expect(screen.getByText("Pad Thai")).toBeInTheDocument();
    expect(screen.queryByText(/^Loading recipes…/)).not.toBeInTheDocument();
  });

  it("says 'Loading recipes…' just before 5 seconds, and adds '(waking up the server)' at 5 seconds", async () => {
    slowList();
    renderAt("/");
    await settle();
    await wait(4_999);
    expect(status()).toHaveTextContent(new RegExp(`^${LOADING}$`));
    await wait(1);
    expect(status()).toHaveTextContent(WAKING);
  });

  it("removes the message when loading fails, and shows the error", async () => {
    const list = slowList();
    renderAt("/");
    await settle();
    await wait(6_000);
    expect(status()).toHaveTextContent(WAKING);

    list.answer(jsonResponse(500, { errors: [] }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the recipes.");
    expect(screen.queryByText(/^Loading recipes…/)).not.toBeInTheDocument();
  });

  it("starts the 5 seconds again when loading again with 'Try again'", async () => {
    const list = slowList();
    renderAt("/");
    await settle();
    await wait(6_000);
    list.answer(jsonResponse(500, { errors: [] }));
    await settle();

    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    await settle();
    expect(list.requests()).toBe(2);
    expect(status()).toHaveTextContent(new RegExp(`^${LOADING}$`));
    await wait(4_999);
    expect(status()).toHaveTextContent(new RegExp(`^${LOADING}$`));
    await wait(1);
    expect(status()).toHaveTextContent(WAKING);

    list.answer(jsonResponse(200, ALL));
    await settle();
    expect(screen.getByText("Pad Thai")).toBeInTheDocument();
    expect(screen.queryByText(/^Loading recipes…/)).not.toBeInTheDocument();
  });

  it.each([
    ["visitors", VISITOR, "Recipe Box"],
    ["editors", EDITOR, "Catalog"],
  ] as const)("shows %s the same message", async (_who, me, heading) => {
    slowList(me);
    renderAt("/");
    await settle();
    // Signed in as who the test says: editors see "Catalog", visitors "Recipe Box".
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(status()).toHaveTextContent(new RegExp(`^${LOADING}$`));
    await wait(5_000);
    expect(status()).toHaveTextContent(WAKING);
  });
});
