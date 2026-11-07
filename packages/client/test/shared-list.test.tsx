import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, SharedShoppingList, ShoppingItem, ShoppingListLink } from "@recipebox/shared";
import { API, APP, EDITOR, NON_EDITOR, VISITOR, type FetchMock, jsonResponse, mockApi, renderAt } from "./helpers.js";

const SHAKSHUKA_ID = "0b6a3c2e-0000-4000-8000-000000000021";
const CHILI_ID = "0b6a3c2e-0000-4000-8000-000000000022";
const TOKEN = "k7Qm2xV9pR4tZ8wL-a1B_c";
const TOKEN_2 = "Zz9Yy8Xx7Ww6Vv5Uu4Tt3S";

/** The PLAN-8 spec example as the server sends it. */
const ITEMS: ShoppingItem[] = [
  { text: "1 can tomatoes", recipeId: CHILI_ID, recipeName: "Chili" },
  { text: "1 can tomatoes", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" },
  { text: "500 g beef mince", recipeId: CHILI_ID, recipeName: "Chili" },
  { text: "6 eggs", recipeId: SHAKSHUKA_ID, recipeName: "Shakshuka" },
];
const ROWS = ITEMS.map((i) => [i.text, i.recipeName]);

/** The spec example's link: made 2026-11-07 at 09:00 UTC, works until 2026-11-14 at 09:00 UTC, a Saturday in New York too. */
const EXPIRES = "2026-11-14T09:00:00.000Z";

function link(token = TOKEN, expiresAt = EXPIRES): ShoppingListLink {
  return { token, path: `/list/${token}`, expiresAt };
}

function lines(): string[][] {
  return within(screen.getByRole("list", { name: "Shopping list" }))
    .getAllByRole("listitem")
    .map((li) => [li.querySelector(".shopping-item-name")?.textContent ?? "", li.querySelector(".shopping-item-recipe")?.textContent ?? ""]);
}

function posts(fetchMock: FetchMock, path: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => init?.method === "POST" && new URL(String(input)).pathname === path)
    .map(([, init]) => init ?? {});
}

/** Sets or removes `navigator.share`, which jsdom doesn't have. */
function stubShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
});

describe("PLAN-9 sending the shopping list", () => {
  interface SendServer {
    items?: ShoppingItem[];
    /** Answers POST /plan/shopping-list/shares, in order; the last one repeats. */
    links?: (() => Response | Promise<Response>)[];
  }

  function mockSendServer({ items = ITEMS, links = [() => jsonResponse(201, link())] }: SendServer = {}) {
    let sends = 0;
    return mockApi(EDITOR, (url, init) => {
      if ((init.method ?? "GET") === "GET" && url.pathname === "/plan/shopping-list") return jsonResponse(200, items);
      if (init.method === "POST" && url.pathname === "/plan/shopping-list/shares") {
        const answer = links[Math.min(sends++, links.length - 1)];
        return answer?.();
      }
      return undefined;
    });
  }

  async function openAndSend(server: SendServer = {}) {
    const user = userEvent.setup();
    const fetchMock = mockSendServer(server);
    renderAt("/plan/shopping");
    const button = await screen.findByRole("button", { name: "Send" });
    await user.click(button);
    return { user, fetchMock, button };
  }

  /** The panel under the heading, not the layout's own live region. */
  function sentPanel(): HTMLElement {
    const header = screen.getByRole("heading", { level: 1, name: "Shopping list" }).closest("header");
    if (header === null) throw new Error("No page header");
    return within(header).getByRole("status");
  }

  it("asks the server for a link with an empty JSON body, sending no list, token or time", async () => {
    stubShare(vi.fn(async () => {}));
    const { fetchMock } = await openAndSend();
    await waitFor(() => expect(posts(fetchMock, "/plan/shopping-list/shares")).toHaveLength(1));
    const [request] = posts(fetchMock, "/plan/shopping-list/shares");
    expect(request?.body).toBe("{}");
    expect(request?.headers).toMatchObject({ "content-type": "application/json" });
    expect(request?.credentials).toBe("include");
  });

  it("offers the link through the device's share function, built from the app's own origin", async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubShare(share);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await openAndSend();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ title: "Shopping list", url: `${APP}/list/${TOKEN}` });
    expect(writeText).not.toHaveBeenCalled();
    const panel = sentPanel();
    expect(panel).toHaveTextContent(
      "Link created. Anyone with it can see this list, without signing in, until Sat, Nov 14. Then it stops working.",
    );
    expect(within(panel).getByText(`${APP}/list/${TOKEN}`)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("copied");
  });

  it("copies the link where the device has no share function, and says so", async () => {
    stubShare(undefined);
    await openAndSend();
    await waitFor(() => expect(sentPanel()).toHaveTextContent("Link copied."));
    await expect(navigator.clipboard.readText()).resolves.toBe(`${APP}/list/${TOKEN}`);
    expect(sentPanel()).toHaveTextContent("until Sat, Nov 14");
  });

  it("treats closing the share sheet as the editor's choice, not an error: the link stays on screen, nothing is copied", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    stubShare(share);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await openAndSend();

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(sentPanel()).toHaveTextContent("Link created.");
    expect(within(sentPanel()).getByText(`${APP}/list/${TOKEN}`)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link instead when the device refuses to share it", async () => {
    stubShare(
      vi.fn(async () => {
        throw new DOMException("Must be handling a user gesture", "NotAllowedError");
      }),
    );
    await openAndSend();
    await waitFor(() => expect(sentPanel()).toHaveTextContent("Link copied."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("when the device refuses both sharing and copying after Send, points to Share, which shares the link on a fresh tap", async () => {
    const share = vi
      .fn(async (_data: ShareData) => {})
      .mockRejectedValueOnce(new DOMException("Must be handling a user gesture", "NotAllowedError"));
    stubShare(share);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    mockSendServer();
    renderAt("/plan/shopping");
    await user.click(await screen.findByRole("button", { name: "Send" }));

    await waitFor(() => expect(sentPanel()).toHaveTextContent("Couldn't share or copy the link yet. Tap Share to send it."));
    expect(within(sentPanel()).getByText(`${APP}/list/${TOKEN}`)).toBeInTheDocument();
    expect(share).toHaveBeenCalledTimes(1);

    await user.click(within(sentPanel()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledTimes(2);
    expect(share).toHaveBeenLastCalledWith({ title: "Shopping list", url: `${APP}/list/${TOKEN}` });
    await waitFor(() => expect(sentPanel()).not.toHaveTextContent("Tap Share"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("has no Share button where the device has no share function, and says when the link couldn't be copied", async () => {
    stubShare(undefined);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    mockSendServer();
    renderAt("/plan/shopping");
    await user.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(sentPanel()).toHaveTextContent("Couldn't copy. Select the link and copy it instead."));
    expect(within(sentPanel()).getByText(`${APP}/list/${TOKEN}`)).toBeInTheDocument();
    expect(within(sentPanel()).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(within(sentPanel()).queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("treats closing the share sheet opened from Share as the editor's choice: no error", async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubShare(share);
    const { user } = await openAndSend();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    share.mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));

    await user.click(within(sentPanel()).getByRole("button", { name: "Share" }));

    expect(share).toHaveBeenCalledTimes(2);
    expect(sentPanel()).not.toHaveTextContent("Couldn't");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so briefly when sharing from Share fails for another reason", async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubShare(share);
    const { user } = await openAndSend();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    share.mockRejectedValueOnce(new DOMException("Refused", "NotAllowedError"));

    await user.click(within(sentPanel()).getByRole("button", { name: "Share" }));

    await waitFor(() => expect(sentPanel()).toHaveTextContent("Couldn't share. Copy the link instead."));
  });

  it('"Copy link" copies the link', async () => {
    stubShare(vi.fn(async () => {}));
    const { user } = await openAndSend();
    await user.click(await within(sentPanel()).findByRole("button", { name: "Copy link" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(`${APP}/list/${TOKEN}`);
    expect(sentPanel()).toHaveTextContent("Link copied.");
  });

  it("shows the date the link stops working in the device's time zone (X-12)", async () => {
    stubShare(vi.fn(async () => {}));
    // 03:00 UTC on the 14th is still the 13th in New York (the test device's zone, vitest.config.ts).
    await openAndSend({ links: [() => jsonResponse(201, link(TOKEN, "2026-11-14T03:00:00.000Z"))] });
    await waitFor(() => expect(sentPanel()).toHaveTextContent("until Fri, Nov 13. Then it stops working."));
  });

  it("makes a new link on each Send", async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubShare(share);
    const { user, fetchMock, button } = await openAndSend({
      links: [() => jsonResponse(201, link(TOKEN)), () => jsonResponse(201, link(TOKEN_2))],
    });
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await user.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(posts(fetchMock, "/plan/shopping-list/shares")).toHaveLength(2);
    expect(share).toHaveBeenLastCalledWith({ title: "Shopping list", url: `${APP}/list/${TOKEN_2}` });
    expect(within(sentPanel()).getByText(`${APP}/list/${TOKEN_2}`)).toBeInTheDocument();
    expect(screen.queryByText(`${APP}/list/${TOKEN}`)).not.toBeInTheDocument();
  });

  it("waits for the server: Send is disabled and says it is making a link, and nothing is shared yet", async () => {
    const share = vi.fn(async () => {});
    stubShare(share);
    let answer: (response: Response) => void = () => {};
    const { button } = await openAndSend({ links: [() => new Promise<Response>((resolve) => (answer = resolve))] });

    expect(await screen.findByText("Making a link…")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(share).not.toHaveBeenCalled();

    answer(jsonResponse(201, link()));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(button).toBeEnabled();
    expect(screen.queryByText("Making a link…")).not.toBeInTheDocument();
  });

  it("says when no link could be made, and shares nothing", async () => {
    const share = vi.fn(async () => {});
    stubShare(share);
    await openAndSend({ links: [() => jsonResponse(500, { errors: [] })] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make a link.");
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByText("Link created.", { exact: false })).not.toBeInTheDocument();
  });

  it("passes on the server's reason, such as an empty plan", async () => {
    stubShare(vi.fn(async () => {}));
    await openAndSend({
      links: [
        () =>
          jsonResponse(409, {
            errors: [{ code: "shoppingList.empty", message: "The plan is empty, so there's no shopping list to send." }],
          }),
      ],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't make a link. The plan is empty, so there's no shopping list to send.",
    );
  });

  it("isn't offered when there is nothing on the list", async () => {
    mockSendServer({ items: [] });
    renderAt("/plan/shopping");
    await screen.findByRole("heading", { level: 2, name: "Nothing to shop for" });
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });
});

describe("PLAN-9 opening a shopping list link", () => {
  function mockListServer(me: Me, answer: () => Response = () => jsonResponse(200, { items: ITEMS, expiresAt: EXPIRES } satisfies SharedShoppingList)) {
    return mockApi(me, (url, init) => {
      if ((init.method ?? "GET") === "GET" && url.pathname === `/shopping-lists/${TOKEN}`) return answer();
      return undefined;
    });
  }

  it("spec example: shows anyone the current list in the server's order with recipe names, and the date it stops working", async () => {
    const fetchMock = mockListServer(VISITOR);
    renderAt(`/list/${TOKEN}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Shopping list" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(ROWS);
    expect(screen.getByText("4 items from 2 recipes")).toBeInTheDocument();
    expect(screen.getByText("This link works until Sat, Nov 14.")).toBeInTheDocument();
    // Only who is asking and the list itself: nothing editor-only.
    expect(fetchMock.mock.calls.map(([input]) => String(input)).sort()).toEqual([`${API}/me`, `${API}/shopping-lists/${TOKEN}`]);
  });

  it("shows a visitor the visitor's navigation, with Sign in", async () => {
    mockListServer(VISITOR);
    renderAt(`/list/${TOKEN}`);
    await screen.findByRole("list", { name: "Shopping list" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Catalog" })).toBeInTheDocument();
    expect(await within(nav).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
  });

  it.each([
    ["an editor", EDITOR],
    ["a signed-in non-editor", NON_EDITOR],
  ])("shows %s the same list, with their own navigation", async (_who, me) => {
    mockListServer(me);
    renderAt(`/list/${TOKEN}`);
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(ROWS);
    expect(screen.getByText("This link works until Sat, Nov 14.")).toBeInTheDocument();
    expect(await within(screen.getByRole("navigation", { name: "Main" })).findByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("ticks items off on the device only: one of two identical lines, and nothing is sent", async () => {
    const user = userEvent.setup();
    const fetchMock = mockListServer(VISITOR);
    renderAt(`/list/${TOKEN}`);
    await screen.findByRole("list", { name: "Shopping list" });
    const before = fetchMock.mock.calls.length;

    const shakshukaTomatoes = screen.getByRole("checkbox", { name: "1 can tomatoes, Shakshuka" });
    await user.click(shakshukaTomatoes);
    expect(shakshukaTomatoes).toBeChecked();
    expect(shakshukaTomatoes.closest("label")).toHaveClass("ticked");
    expect(screen.getByRole("checkbox", { name: "1 can tomatoes, Chili" })).not.toBeChecked();

    await user.click(shakshukaTomatoes);
    expect(shakshukaTomatoes).not.toBeChecked();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("says the link has expired when the server doesn't find it, whether expired or never made", async () => {
    mockListServer(VISITOR, () => jsonResponse(404, { errors: [{ code: "sharedList.notFound", message: "Gone." }] }));
    renderAt(`/list/${TOKEN}`);
    expect(await screen.findByRole("heading", { level: 1, name: "This link has expired" })).toBeInTheDocument();
    expect(screen.getByText("Shopping list links work for 7 days. Ask for a new one.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("list", { name: "Shopping list" })).not.toBeInTheDocument();
  });

  it("says when it couldn't load, with a way to try again, rather than that it has expired", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    mockListServer(VISITOR, () =>
      ++attempts === 1 ? jsonResponse(500, { errors: [] }) : jsonResponse(200, { items: ITEMS, expiresAt: EXPIRES }),
    );
    renderAt(`/list/${TOKEN}`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the shopping list.");
    expect(screen.queryByText("This link has expired")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(ROWS);
  });

  it("says loading while the list loads", async () => {
    mockApi(VISITOR, () => new Promise<Response>(() => {}));
    renderAt(`/list/${TOKEN}`);
    expect(await screen.findByText("Loading the shopping list…")).toBeInTheDocument();
  });
});

describe("PLAN-9 a shopping list link is live", () => {
  /** The server's current list for the link; tests change it between loads. */
  let current: ShoppingItem[];
  /** How the next load fails instead, if it does: the link has expired (404), or the request never reaches the server. */
  let failure: "expired" | "network" | undefined;

  async function openLive(items: ShoppingItem[] = ITEMS) {
    current = items;
    failure = undefined;
    const fetchMock = mockApi(VISITOR, (url) => {
      if (url.pathname !== `/shopping-lists/${TOKEN}`) return undefined;
      if (failure === "expired") return jsonResponse(404, { errors: [{ code: "sharedList.notFound", message: "Gone." }] });
      if (failure === "network") return Promise.reject(new TypeError("Failed to fetch"));
      return jsonResponse(200, { items: current, expiresAt: EXPIRES });
    });
    renderAt(`/list/${TOKEN}`);
    await screen.findByRole("heading", { level: 1, name: "Shopping list" });
    return fetchMock;
  }

  function loads(fetchMock: FetchMock): number {
    return fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === `/shopping-lists/${TOKEN}`).length;
  }

  /** The person comes back to the page: the tab becomes visible again. */
  async function comeBack(fetchMock: FetchMock) {
    const before = loads(fetchMock);
    act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(loads(fetchMock)).toBe(before + 1));
  }

  const BEEF: ShoppingItem = { text: "1 kg beef", recipeId: "0b6a3c2e-0000-4000-8000-000000000023", recipeName: "Beef Stew" };

  it("loads the list again when the person comes back, bringing in a line added meanwhile", async () => {
    const fetchMock = await openLive();
    await screen.findByRole("list", { name: "Shopping list" });
    current = [BEEF, ...ITEMS];

    await comeBack(fetchMock);

    await waitFor(() => expect(lines()).toEqual([["1 kg beef", "Beef Stew"], ...ROWS]));
    expect(screen.getByText("5 items from 3 recipes")).toBeInTheDocument();
  });

  it("keeps a tick on its line while that line is still on the list, even with lines added around it", async () => {
    const user = userEvent.setup();
    const fetchMock = await openLive();
    await user.click(await screen.findByRole("checkbox", { name: "1 can tomatoes, Shakshuka" }));
    current = [BEEF, ...ITEMS.filter((i) => i.recipeId !== CHILI_ID)];

    await comeBack(fetchMock);

    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(screen.getByRole("checkbox", { name: "1 can tomatoes, Shakshuka" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "1 kg beef, Beef Stew" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).not.toBeChecked();
  });

  it("drops a tick when its line leaves the list, so the line comes back unticked", async () => {
    const user = userEvent.setup();
    const fetchMock = await openLive();
    await user.click(await screen.findByRole("checkbox", { name: "6 eggs, Shakshuka" }));
    current = ITEMS.filter((i) => i.recipeId !== SHAKSHUKA_ID);

    await comeBack(fetchMock);
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "6 eggs, Shakshuka" })).not.toBeInTheDocument());

    current = ITEMS;
    await comeBack(fetchMock);
    expect(await screen.findByRole("checkbox", { name: "6 eggs, Shakshuka" })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(0);
  });

  it("shows the expired page, without the old list, when the link has expired by the time the person comes back", async () => {
    const user = userEvent.setup();
    const fetchMock = await openLive();
    await user.click(await screen.findByRole("checkbox", { name: "6 eggs, Shakshuka" }));
    failure = "expired";

    await comeBack(fetchMock);

    expect(await screen.findByRole("heading", { level: 1, name: "This link has expired" })).toBeInTheDocument();
    expect(screen.getByText("Shopping list links work for 7 days. Ask for a new one.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Shopping list" })).not.toBeInTheDocument();
    expect(screen.queryByText("6 eggs")).not.toBeInTheDocument();
    expect(screen.queryByText(/This link works until/)).not.toBeInTheDocument();
  });

  it("keeps the list and its ticks when a reload fails for another reason, with a short note", async () => {
    const user = userEvent.setup();
    const fetchMock = await openLive();
    await user.click(await screen.findByRole("checkbox", { name: "6 eggs, Shakshuka" }));
    failure = "network";

    await comeBack(fetchMock);

    expect(await screen.findByText("Couldn't refresh the list, so it may be out of date. Check the connection.")).toBeInTheDocument();
    expect(lines()).toEqual(ROWS);
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("This link has expired")).not.toBeInTheDocument();

    // The next successful reload clears the note.
    failure = undefined;
    await comeBack(fetchMock);
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh the list/)).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "6 eggs, Shakshuka" })).toBeChecked();
  });

  it("says there is nothing to shop for right now when the plan is empty, and shows items when they come", async () => {
    const fetchMock = await openLive([]);
    expect(await screen.findByText("Nothing to shop for right now.")).toBeInTheDocument();
    expect(screen.getByText("This link works until Sat, Nov 14.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Shopping list" })).not.toBeInTheDocument();
    expect(screen.queryByText(/items? from/)).not.toBeInTheDocument();
    expect(screen.queryByText("This link has expired")).not.toBeInTheDocument();

    current = ITEMS;
    await comeBack(fetchMock);

    await screen.findByRole("list", { name: "Shopping list" });
    expect(lines()).toEqual(ROWS);
    expect(screen.queryByText("Nothing to shop for right now.")).not.toBeInTheDocument();
  });
});

describe("X-1 /list/:token is a public page (PLAN-9)", () => {
  it("is reachable by a visitor, without the editor-only sign-in message", async () => {
    mockApi(VISITOR, (url) =>
      url.pathname === `/shopping-lists/${TOKEN}` ? jsonResponse(200, { items: ITEMS, expiresAt: EXPIRES }) : undefined,
    );
    const { router } = renderAt(`/list/${TOKEN}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Shopping list" })).toBeInTheDocument();
    expect(screen.queryByText("Sign in to see this")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/list/${TOKEN}`);
  });
});
