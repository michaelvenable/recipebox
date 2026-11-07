import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorRecipe, Me, PublicRecipe } from "@recipebox/shared";
import { planKeys, recipeKeys, rediscoverKeys, tagKeys } from "../src/api/query-keys.js";
import { API, EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const ID = "0b6a3c2e-0000-4000-8000-000000000002";
const OTHER_ID = "0b6a3c2e-0000-4000-8000-000000000003";

const PAD_THAI: PublicRecipe = {
  id: ID,
  name: "Pad Thai",
  ingredients: ["200 g flat rice noodles", "3 tbsp tamarind paste", "2 eggs"],
  steps: ["Soak the noodles.", "Stir the sauce.", "Fry everything."],
  totalTimeMinutes: 30,
  tags: ["dinner", "noodles", "quick"],
  hasPhoto: true,
};
const TOAST: PublicRecipe = { id: OTHER_ID, name: "Toast", ingredients: ["Bread"], steps: ["Toast it."], tags: [], hasPhoto: false };
/** A recipe with prep (REC-20). */
const CURRY: PublicRecipe = {
  ...PAD_THAI,
  name: "Curry",
  prep: ["Chop the onions.", "Grind the spices."],
  steps: ["Fry the onions.", "Simmer."],
};

function asEditor(recipe: PublicRecipe, extra: Partial<EditorRecipe> = {}): EditorRecipe {
  return { ...recipe, cookedAt: [], timesCooked: 0, ...extra };
}

/** A stored time, written as the server would (UTC), for a local date and time on this device. */
function at(year: number, monthIndex: number, day: number, hours = 12, minutes = 0): string {
  return new Date(year, monthIndex, day, hours, minutes).toISOString();
}

/** Cooking history fields for entries given newest first, as the server sends them (COOK-5). */
function cooked(...entries: string[]): Partial<EditorRecipe> {
  return entries.length === 0
    ? { cookedAt: [], timesCooked: 0 }
    : { cookedAt: entries, lastCookedAt: entries[0], timesCooked: entries.length };
}

type Answer = Response | Promise<Response> | unknown;

interface FakeApi {
  me?: Me;
  /** GET /recipes/{id}, by id. */
  recipes?: Record<string, () => Answer>;
  /** Any change (POST, PUT, DELETE), by method and path; its body parsed. */
  change?: (method: string, path: string, body: unknown) => Answer;
  suggestions?: (url: URL) => Answer;
}

function respond(answer: Answer): Response | Promise<Response> {
  return answer instanceof Response || answer instanceof Promise ? answer : jsonResponse(200, answer);
}

function mockRecipeApi({ me = EDITOR, recipes = {}, change, suggestions }: FakeApi): FetchMock {
  return mockApi(me, (url, init) => {
    const method = init.method ?? "GET";
    if (method !== "GET") {
      if (change === undefined) return undefined;
      return respond(change(method, url.pathname, JSON.parse(String(init.body))));
    }
    if (url.pathname === "/recipes" || url.pathname === "/tags") return jsonResponse(200, []);
    if (url.pathname === "/tag-suggestions" && suggestions !== undefined) return respond(suggestions(url));
    const match = /^\/recipes\/([^/]+)$/.exec(url.pathname);
    if (match !== null) {
      const recipe = recipes[decodeURIComponent(match[1] ?? "")];
      return recipe === undefined ? jsonResponse(404, { errors: [{ code: "recipe.notFound", message: "This recipe doesn't exist." }] }) : respond(recipe());
    }
    return undefined;
  });
}

interface SentRequest {
  method: string;
  path: string;
  body: string | undefined;
  contentType: string | undefined;
}

function requests(fetchMock: FetchMock): SentRequest[] {
  return fetchMock.mock.calls.map(([input, init]) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname + new URL(String(input)).search,
      body: init?.body === undefined ? undefined : String(init.body),
      contentType: headers["content-type"],
    };
  });
}

function changes(fetchMock: FetchMock): SentRequest[] {
  return requests(fetchMock).filter((r) => r.method !== "GET");
}

async function openRecipe(fake: FakeApi, path = `/recipes/${ID}`) {
  const fetchMock = mockRecipeApi(fake);
  const rendered = renderAt(path);
  await screen.findByRole("heading", { level: 1 });
  // Editor controls wait for /me, as does the navigation.
  await screen.findByRole("link", { name: (fake.me ?? EDITOR).signedIn ? "Account" : "Sign in" });
  return { fetchMock, ...rendered };
}

function ingredient(name: string): HTMLElement {
  return screen.getByRole("checkbox", { name });
}

function step(n: number): HTMLElement {
  return screen.getByRole("button", { name: `Step ${n} done` });
}

function prep(n: number): HTMLElement {
  return screen.getByRole("button", { name: `Prep ${n} done` });
}

const EDITOR_CONTROLS = ["I cooked this today", "I want to cook this", "Edit", "+ Tag", "History", "Remove", "Remove tag dinner"];

function editorControlsShown(): string[] {
  return EDITOR_CONTROLS.filter(
    (name) => screen.queryByRole("button", { name }) !== null || screen.queryByRole("link", { name }) !== null,
  );
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("REC-4 view", () => {
  it("shows the name, total time, tags, ingredients in order and steps numbered from 1", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    expect(screen.getByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
    expect(screen.getByText("30 min total")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "dinner",
      "noodles",
      "quick",
    ]);
    expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(PAD_THAI.ingredients);
    const steps = within(screen.getByRole("region", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual(["1Soak the noodles.", "2Stir the sauce.", "3Fry everything."]);
    expect(screen.queryByText("Tap a number when done")).not.toBeInTheDocument();
  });

  it("shows the photo from the API, described by the recipe's name (REC-7)", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    expect(screen.getByRole("img", { name: "Pad Thai photo" })).toHaveAttribute("src", `${API}/recipes/${ID}/photo`);
  });

  it("shows no photo and no empty tag list for a recipe without them", async () => {
    await openRecipe({ me: VISITOR, recipes: { [OTHER_ID]: () => TOAST } }, `/recipes/${OTHER_ID}`);
    expect(screen.getByRole("heading", { level: 1, name: "Toast" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText(/total/)).not.toBeInTheDocument();
  });

  it.each([
    ["an unknown id", "8d3f2a4e-1b2c-4d5e-8f90-1234567890ab"],
    ["a malformed id", "not-an-id"],
  ])("shows not found, with a link back to the list, for %s", async (_what, id) => {
    mockRecipeApi({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    renderAt(`/recipes/${id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Recipe not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the recipes" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows not found for a recipe in the trash, which the API answers with 404 (REC-6)", async () => {
    mockRecipeApi({
      me: EDITOR,
      recipes: { [ID]: () => jsonResponse(404, { errors: [{ code: "recipe.notFound", message: "This recipe doesn't exist." }] }) },
    });
    renderAt(`/recipes/${ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Recipe not found" })).toBeInTheDocument();
  });

  it("shows other failures as an error with a way to try again", async () => {
    let attempts = 0;
    mockRecipeApi({ me: VISITOR, recipes: { [ID]: () => (++attempts === 1 ? jsonResponse(500, { errors: [] }) : PAD_THAI) } });
    renderAt(`/recipes/${ID}`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the recipe.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
  });
});

describe("REC-20 prep", () => {
  it("shows prep numbered from 1, in order, in a section before the steps", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => CURRY } });
    const section = screen.getByRole("region", { name: "Prep" });
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Chop the onions.", "2Grind the spices."]);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Prep")).toBeLessThan(headings.indexOf("Steps"));
    expect(headings.indexOf("Prep")).toBeGreaterThan(-1);
  });

  it("shows no Prep section for a recipe with no prep entries", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    expect(screen.queryByRole("region", { name: "Prep" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Prep" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Steps" })).toBeInTheDocument();
  });
});

describe("X-1, X-8 visitors and editors", () => {
  it.each([
    ["visitors", VISITOR],
    ["signed-in non-editors", NON_EDITOR],
  ])("shows %s the recipe without editing controls, to-make mark or cooking history", async (_who, me) => {
    await openRecipe({ me, recipes: { [ID]: () => PAD_THAI } });
    expect(editorControlsShown()).toEqual([]);
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
    expect(screen.queryByText(/cooked/i)).not.toBeInTheDocument();
    // What everyone may do: tick (REC-19).
    expect(step(1)).toBeEnabled();
  });

  it("shows editors the actions, history and Edit link, but no way to change the tags (REC-10)", async () => {
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 7, 2))) } });
    expect(editorControlsShown()).toEqual(["I cooked this today", "I want to cook this", "Edit", "History"]);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/recipes/${ID}/edit`);
  });

  it("shows no editing controls once the app knows the person is a visitor, even if the recipe has the editor shape", async () => {
    // For instance, a recipe loaded as an editor and still cached after the session ended (X-9) and /me was reloaded.
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => asEditor(PAD_THAI, { toMake: { addedAt: at(2026, 10, 1) } }) } });
    await screen.findByRole("link", { name: "Sign in" });
    expect(editorControlsShown()).toEqual([]);
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
  });

  it("refuses a public recipe carrying a private field, as a contract error", async () => {
    mockRecipeApi({ me: VISITOR, recipes: { [ID]: () => ({ ...PAD_THAI, timesCooked: 3 }) } });
    renderAt(`/recipes/${ID}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the recipe.");
  });
});

describe("REC-19 ticks", () => {
  it("ticks and unticks ingredients and steps", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await userEvent.click(ingredient("2 eggs"));
    await userEvent.click(step(2));
    expect(ingredient("2 eggs")).toBeChecked();
    expect(ingredient("3 tbsp tamarind paste")).not.toBeChecked();
    expect(step(2)).toHaveAttribute("aria-pressed", "true");
    expect(step(1)).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(step(2));
    expect(step(2)).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(ingredient("2 eggs"));
    expect(ingredient("2 eggs")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Clear ticks" })).not.toBeInTheDocument();
  });

  it("ticks and unticks prep entries apart from the steps (REC-20)", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => CURRY } });
    await userEvent.click(prep(2));
    expect(prep(2)).toHaveAttribute("aria-pressed", "true");
    expect(prep(1)).toHaveAttribute("aria-pressed", "false");
    expect(step(2)).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(step(1));
    expect(prep(1)).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(prep(2));
    expect(prep(2)).toHaveAttribute("aria-pressed", "false");
    expect(step(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("never sends ticks to the API or saves them on the device", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { fetchMock } = await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI) } });
    const before = fetchMock.mock.calls.length;
    await userEvent.click(ingredient("2 eggs"));
    await userEvent.click(step(1));
    await userEvent.click(step(1));
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(changes(fetchMock)).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("clears ticks on leaving the recipe and coming back", async () => {
    const { router } = await openRecipe({ me: VISITOR, recipes: { [ID]: () => CURRY } });
    await userEvent.click(ingredient("2 eggs"));
    await userEvent.click(prep(1));
    await userEvent.click(step(1));
    await act(() => router.navigate("/"));
    await act(() => router.navigate(-1));
    await screen.findByRole("heading", { level: 1, name: "Curry" });
    expect(ingredient("2 eggs")).not.toBeChecked();
    expect(prep(1)).toHaveAttribute("aria-pressed", "false");
    expect(step(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("clears ticks on opening another recipe", async () => {
    const { router } = await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI, [OTHER_ID]: () => TOAST } });
    await userEvent.click(ingredient("200 g flat rice noodles"));
    await userEvent.click(step(1));
    await act(() => router.navigate(`/recipes/${OTHER_ID}`));
    await screen.findByRole("heading", { level: 1, name: "Toast" });
    expect(ingredient("Bread")).not.toBeChecked();
    expect(step(1)).toHaveAttribute("aria-pressed", "false");
  });
});

/** A stand-in for navigator.wakeLock: each request grants a lock the test can see, release and check. */
class FakeSentinel extends EventTarget {
  readonly type = "screen";
  released = false;
  onrelease = null;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

function installWakeLock(request?: () => Promise<FakeSentinel>) {
  const sentinels: FakeSentinel[] = [];
  const requestMock = vi.fn(
    request ??
      (async () => {
        const sentinel = new FakeSentinel();
        sentinels.push(sentinel);
        return sentinel;
      }),
  );
  Object.defineProperty(navigator, "wakeLock", { value: { request: requestMock }, configurable: true });
  return { request: requestMock, sentinels };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const SCREEN_ON = "Screen stays on while this recipe is open";

describe("REC-18 screen stays on", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("keeps the screen on while the recipe is open, without a note saying so", async () => {
    const wakeLock = installWakeLock();
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledExactlyOnceWith("screen"));
    expect(wakeLock.sentinels[0]?.released).toBe(false);
    expect(screen.queryByText(SCREEN_ON)).not.toBeInTheDocument();
  });

  it("releases the lock on leaving the recipe", async () => {
    const wakeLock = installWakeLock();
    const { router } = await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await waitFor(() => expect(wakeLock.sentinels).toHaveLength(1));
    await act(() => router.navigate("/"));
    expect(wakeLock.sentinels[0]?.release).toHaveBeenCalled();
  });

  it("asks again when the page becomes visible after the browser released the lock", async () => {
    const wakeLock = installWakeLock();
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await waitFor(() => expect(wakeLock.sentinels).toHaveLength(1));

    // The browser releases the lock when the page is hidden.
    await act(async () => {
      setVisibility("hidden");
      await wakeLock.sentinels[0]?.release();
    });

    await act(async () => setVisibility("visible"));
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledTimes(2));
  });

  it("doesn't ask again while the lock is still held", async () => {
    const wakeLock = installWakeLock();
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await waitFor(() => expect(wakeLock.sentinels).toHaveLength(1));
    await act(async () => setVisibility("visible"));
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it("shows no error when the browser has no wake lock", async () => {
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no error when the browser refuses the lock", async () => {
    const wakeLock = installWakeLock(() => Promise.reject(new DOMException("Battery saver", "NotAllowedError")));
    await openRecipe({ me: VISITOR, recipes: { [ID]: () => PAD_THAI } });
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("doesn't hold the lock for a recipe that wasn't found", async () => {
    const wakeLock = installWakeLock();
    mockRecipeApi({ me: VISITOR });
    renderAt(`/recipes/${ID}`);
    await screen.findByRole("heading", { level: 1, name: "Recipe not found" });
    expect(wakeLock.request).not.toHaveBeenCalled();
  });
});

/** The device's clock, for "today" (X-12). Timers are faked too, so the test can move past midnight. */
function setClock(now: Date) {
  vi.useFakeTimers({ now, shouldAdvanceTime: true, toFake: ["Date", "setTimeout", "clearTimeout"] });
}

const NOV_4_6PM = new Date(2026, 10, 4, 18, 0);

describe("COOK-1, COOK-8 cooked today", () => {
  it("records a cooking with an empty body, and then reads Cooked today ✓, disabled", async () => {
    setClock(NOV_4_6PM);
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => asEditor(PAD_THAI, cooked(new Date().toISOString())),
    });
    await userEvent.click(screen.getByRole("button", { name: "I cooked this today" }));
    expect(await screen.findByRole("button", { name: "Cooked today ✓" })).toHaveAttribute("aria-disabled", "true");
    // Focus stays on the action rather than falling to the page when the pressed button is replaced.
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toHaveFocus();
    expect(changes(fetchMock)).toEqual([
      { method: "POST", path: `/recipes/${ID}/cookings`, body: "{}", contentType: "application/json" },
    ]);
    expect(screen.getByText(/Last cooked today · cooked once/)).toBeInTheDocument();
  });

  it("styles I cooked this today like I want to cook this, not as the primary action", async () => {
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI) } });
    const cook = screen.getByRole("button", { name: "I cooked this today" });
    expect(cook).not.toHaveClass("button-primary");
    expect(cook.className).toBe(screen.getByRole("button", { name: "I want to cook this" }).className);
  });

  it("reads Cooked today ✓ when it was last cooked earlier on this local day", async () => {
    setClock(NOV_4_6PM);
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 10, 4, 0, 5))) } });
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "I cooked this today" })).not.toBeInTheDocument();
  });

  it("offers I cooked this today when it was last cooked just before local midnight", async () => {
    setClock(new Date(2026, 10, 5, 0, 1));
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 10, 4, 23, 59))) } });
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
    expect(screen.getByText(/Last cooked Nov 4 · cooked once/)).toBeInTheDocument();
  });

  it("offers the button again at local midnight while the recipe stays open", async () => {
    setClock(new Date(2026, 10, 4, 23, 59, 30));
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 10, 4, 18, 0))) } });
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toHaveAttribute("aria-disabled", "true");

    act(() => vi.advanceTimersByTime(29_000));
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toHaveAttribute("aria-disabled", "true");

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
    expect(screen.getByText(/Last cooked Nov 4/)).toBeInTheDocument();
  });

  it("rechecks the day when the page becomes visible again, as timers may not run while a phone sleeps", async () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    setClock(NOV_4_6PM);
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 10, 4, 8, 0))) } });
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toHaveAttribute("aria-disabled", "true");

    // The clock moves on without the midnight timer firing, as on a sleeping phone.
    vi.setSystemTime(new Date(2026, 10, 5, 7, 0));
    act(() => setVisibility("visible"));
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
  });

  it("keeps the button waiting for a cooking still being saved after leaving and reopening the recipe", async () => {
    let answer: (response: Response) => void = () => {};
    const { fetchMock, router } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    await userEvent.click(screen.getByRole("button", { name: "I cooked this today" }));
    await act(() => router.navigate("/"));
    await act(() => router.navigate(-1));
    const button = await screen.findByRole("button", { name: "I cooked this today" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(changes(fetchMock)).toHaveLength(1);

    answer(jsonResponse(200, asEditor(PAD_THAI, cooked(new Date().toISOString()))));
    expect(await screen.findByRole("button", { name: "Cooked today ✓" })).toBeInTheDocument();
    expect(changes(fetchMock)).toHaveLength(1);
  });

  it("can't record another cooking from Cooked today ✓, which stays reachable for screen readers", async () => {
    setClock(NOV_4_6PM);
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 10, 4, 8, 0))) },
      change: () => asEditor(PAD_THAI),
    });
    const button = screen.getByRole("button", { name: "Cooked today ✓" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(changes(fetchMock)).toEqual([]);
  });

  it("offers the button again at local midnight after a spring-forward day, 23 hours long", async () => {
    // America/New_York (vitest.config.ts) skips 02:00-03:00 on 2026-03-08.
    setClock(new Date(2026, 2, 8, 1, 0));
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2026, 2, 8, 0, 30))) } });
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toBeInTheDocument();

    // 01:00 to midnight is 22 hours on this day, not 23.
    act(() => vi.advanceTimersByTime(22 * 3_600_000 - 1_000));
    expect(screen.getByRole("button", { name: "Cooked today ✓" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
  });

  it("sends one cooking for a double tap, as the button waits for the first", async () => {
    let answer: (response: Response) => void = () => {};
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const button = screen.getByRole("button", { name: "I cooked this today" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    expect(changes(fetchMock)).toHaveLength(1);
    answer(jsonResponse(200, asEditor(PAD_THAI, cooked(new Date().toISOString()))));
    expect(await screen.findByRole("button", { name: "Cooked today ✓" })).toBeInTheDocument();
  });
});

describe("PLAN-1, PLAN-4, PLAN-7 the to-make list from the recipe", () => {
  it("adds the recipe with an empty body, then shows it is on the list, with the mark by the title", async () => {
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => asEditor(PAD_THAI, { toMake: { addedAt: new Date().toISOString() } }),
    });
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));

    expect(await screen.findByText("On your plan ✓")).toBeInTheDocument();
    expect(screen.getByText("Plan", { selector: ".to-make-badge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I want to cook this" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toHaveFocus();
    expect(changes(fetchMock)).toEqual([
      { method: "POST", path: `/recipes/${ID}/add-to-plan`, body: "{}", contentType: "application/json" },
    ]);
  });

  it("removes the recipe from the list, leaving its history alone", async () => {
    const history = cooked(at(2026, 7, 2));
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI, { ...history, toMake: { addedAt: at(2026, 10, 1) } }) },
      change: () => asEditor(PAD_THAI, history),
    });
    expect(screen.getByText("Plan", { selector: ".to-make-badge" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("button", { name: "I want to cook this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I want to cook this" })).toHaveFocus();
    expect(screen.queryByText("On your plan ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
    expect(screen.getByText(/Last cooked Aug 2 · cooked once/)).toBeInTheDocument();
    expect(changes(fetchMock)).toEqual([
      { method: "POST", path: `/recipes/${ID}/remove-from-plan`, body: "{}", contentType: "application/json" },
    ]);
  });

  it("marks the lists, the plan and the tag counts stale, and keeps the returned recipe without reloading it", async () => {
    const { fetchMock, queryClient } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => asEditor(PAD_THAI, { toMake: { addedAt: new Date().toISOString() } }),
    });
    queryClient.setQueryData(recipeKeys.list({ name: "", tags: [] }), []);
    queryClient.setQueryData(planKeys.all, []);
    queryClient.setQueryData(tagKeys.all, []);
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));
    await screen.findByText("On your plan ✓");

    expect(queryClient.getQueryState(recipeKeys.list({ name: "", tags: [] }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(planKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(tagKeys.all)?.isInvalidated).toBe(false);
    expect(requests(fetchMock).filter((r) => r.path === `/recipes/${ID}`)).toHaveLength(1);
  });
});

describe("PLAN-5 cooked recipes leave the list", () => {
  it("shows the recipe off the list after marking it cooked, as the server returns it", async () => {
    const { queryClient } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI, { toMake: { addedAt: at(2026, 10, 1) } }) },
      change: () => asEditor(PAD_THAI, cooked(new Date().toISOString())),
    });
    queryClient.setQueryData(planKeys.all, []);
    queryClient.setQueryData(rediscoverKeys.all, []);
    expect(screen.getByText("On your plan ✓")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "I cooked this today" }));
    expect(await screen.findByRole("button", { name: "Cooked today ✓" })).toBeInTheDocument();
    expect(screen.queryByText("On your plan ✓")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan", { selector: ".to-make-badge" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I want to cook this" })).toBeInTheDocument();
    expect(queryClient.getQueryState(planKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(rediscoverKeys.all)?.isInvalidated).toBe(true);
  });
});

describe("COOK-5 history on the recipe", () => {
  it("says Never cooked, with no history to open", async () => {
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI) } });
    expect(screen.getByText("Never cooked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
  });

  it("shows the last-cooked date and count, and the full list newest first as local dates, without delete", async () => {
    setClock(NOV_4_6PM);
    // Just after and just before local midnight: in any time zone but UTC, one of these is on another day in UTC.
    const entries = [at(2026, 7, 2, 0, 30), at(2026, 6, 14, 23, 30), at(2025, 11, 31, 19, 0)];
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(...entries)) } });
    expect(screen.getByText(/Last cooked Aug 2 · cooked 3 times/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Cooking history" })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "History" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Cooking history" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Aug 2, 2026", "Jul 14, 2026", "Dec 31, 2025"]);
    expect(within(list).queryAllByRole("button")).toEqual([]);

    await userEvent.click(toggle);
    expect(screen.queryByRole("list", { name: "Cooking history" })).not.toBeInTheDocument();
  });

  it("gives the year of a last cooking in an earlier year", async () => {
    setClock(NOV_4_6PM);
    await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI, cooked(at(2025, 11, 31, 19, 0))) } });
    expect(screen.getByText(/Last cooked Dec 31, 2025 · cooked once/)).toBeInTheDocument();
  });
});

describe("REC-10 tags on the recipe view", () => {
  it("shows editors the tags without any way to add or remove them", async () => {
    const { fetchMock } = await openRecipe({ recipes: { [ID]: () => asEditor(PAD_THAI) } });
    const tags = screen.getByRole("list", { name: "Tags" });
    expect(within(tags).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["dinner", "noodles", "quick"]);
    expect(within(tags).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("button", { name: "+ Tag" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a tag" })).not.toBeInTheDocument();
    expect(requests(fetchMock).some((r) => r.path.startsWith("/tag-suggestions"))).toBe(false);
  });
});

describe("REC-17, X-12 failed changes", () => {
  it("says the recipe is in the trash, keeping the recipe and the ticks", async () => {
    await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () =>
        jsonResponse(409, {
          errors: [{ code: "recipe.inTrash", message: "This recipe is in the trash. Restore it before changing it." }],
        }),
    });
    await userEvent.click(ingredient("2 eggs"));
    await userEvent.click(step(1));
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This recipe is in the trash. Restore it before changing it.");
    expect(screen.getByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
    expect(ingredient("2 eggs")).toBeChecked();
    expect(step(1)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "I want to cook this" })).toBeEnabled();
  });

  it("says when the server can't be reached, keeping the ticks", async () => {
    await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await userEvent.click(step(2));
    await userEvent.click(screen.getByRole("button", { name: "I cooked this today" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server. Check the connection and try again.");
    expect(step(2)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "I cooked this today" })).toBeEnabled();
  });

  it("clears the message when the next change succeeds", async () => {
    let attempts = 0;
    await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      change: () => (++attempts === 1 ? Promise.reject(new TypeError("Failed to fetch")) : asEditor(PAD_THAI, { toMake: { addedAt: new Date().toISOString() } })),
    });
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));
    expect(await screen.findByText("On your plan ✓")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends no time with any change: an empty body (X-12)", async () => {
    const { fetchMock } = await openRecipe({
      recipes: { [ID]: () => asEditor(PAD_THAI) },
      suggestions: () => [],
      change: (_method, path) =>
        path.endsWith("/add-to-plan") ? asEditor(PAD_THAI, { toMake: { addedAt: new Date().toISOString() } }) : asEditor(PAD_THAI),
    });
    await userEvent.click(screen.getByRole("button", { name: "I want to cook this" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "I cooked this today" }));
    await waitFor(() => expect(changes(fetchMock)).toHaveLength(3));
    expect(changes(fetchMock).map((r) => r.body)).toEqual(["{}", "{}", "{}"]);
  });
});
