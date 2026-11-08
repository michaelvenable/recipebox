import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorRecipe, EditorRecipeSummary, ImportStatus, Me, RecipeSummary } from "@recipebox/shared";
import { IMPORT_POLL_MS } from "../src/imports/imports.js";
import { NOTICE_MS } from "../src/layout/notices.js";
import { EDITOR, type FetchMock, NON_EDITOR, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const STEW_ID = "0b6a3c2e-0000-4000-8000-000000000001";
const PAD_THAI_ID = "0b6a3c2e-0000-4000-8000-000000000002";
const BREAD_ID = "0b6a3c2e-0000-4000-8000-000000000003";
const SCONES_ID = "0b6a3c2e-0000-4000-8000-000000000004";

const UPLOADED = "Photo uploaded. Your recipe will be added to the Catalog in a minute or two.";
const READING = "Reading your photo…";
const HINT = "Usually a minute or two. You can keep using the app.";

function summary(id: string, name: string): EditorRecipeSummary {
  return { id, name, tags: [], hasPhoto: false, onToMakeList: false };
}

function full(id: string, name: string): EditorRecipe {
  return { id, name, ingredients: ["Flour"], steps: ["Bake."], tags: [], hasPhoto: false, cookedAt: [], timesCooked: 0 };
}

function done(importId: string, recipeId: string, recipeName: string): ImportStatus {
  return { importId, status: "done", recipeId, recipeName };
}

interface FakeServer {
  me: Me;
  /** GET /recipes, as editors get it; visitors get the public shape. */
  recipes: EditorRecipeSummary[];
  /** GET /imports, newest first. */
  imports: ImportStatus[];
  /** POST /imports; by default a new import, reading, is added in front of `imports`. */
  upload?: (form: FormData) => Response | Promise<Response>;
  /** Set to hold back the answers of GET /imports: each gets `imports` as it was when asked, once `release` is called. */
  held?: Array<() => void> | undefined;
}

/** Answers the held reads of GET /imports. */
function release(server: FakeServer) {
  const held = server.held ?? [];
  server.held = undefined;
  for (const answer of held) answer();
}

function serve(partial: Partial<FakeServer> = {}): { server: FakeServer; fetchMock: FetchMock } {
  const server: FakeServer = { me: EDITOR, recipes: [summary(STEW_ID, "Beef Stew")], imports: [], ...partial };
  let next = 0;
  const fetchMock = mockApi(server.me, (url, init) => {
    const method = init.method ?? "GET";
    if (method === "POST" && url.pathname === "/imports") {
      if (server.upload !== undefined) return server.upload(init.body as FormData);
      const status: ImportStatus = { importId: `import-${++next}`, status: "reading" };
      server.imports = [status, ...server.imports];
      return jsonResponse(202, status);
    }
    if (method !== "GET") return undefined;
    if (url.pathname === "/recipes") {
      const list: RecipeSummary[] = server.me.isEditor ? server.recipes : server.recipes.map(({ onToMakeList: _, ...rest }) => rest);
      return jsonResponse(200, list);
    }
    if (url.pathname === "/tags") return jsonResponse(200, []);
    if (url.pathname === "/imports") {
      const snapshot = server.imports;
      const held = server.held;
      if (held === undefined) return jsonResponse(200, snapshot);
      return new Promise<Response>((resolve) => held.push(() => resolve(jsonResponse(200, snapshot))));
    }
    const match = /^\/recipes\/([^/]+)$/.exec(url.pathname);
    const recipe = server.recipes.find((r) => r.id === decodeURIComponent(match?.[1] ?? ""));
    if (recipe !== undefined) return jsonResponse(200, full(recipe.id, recipe.name));
    return undefined;
  });
  return { server, fetchMock };
}

function requests(fetchMock: FetchMock, method: string, path: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => (init?.method ?? "GET") === method && new URL(String(input)).pathname === path)
    .map(([, init]) => init ?? {});
}

const importReads = (fetchMock: FetchMock) => requests(fetchMock, "GET", "/imports").length;
const uploads = (fetchMock: FetchMock) => requests(fetchMock, "POST", "/imports");

function jpeg(name = "card.jpg"): File {
  return new File(["jpeg bytes"], name, { type: "image/jpeg" });
}

/** Timers are faked so tests can move on to the next check of GET /imports; they also run on by themselves. */
function fakeTimers() {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

/** The next check of GET /imports (IMP-5), and its answer. */
async function nextCheck() {
  await act(() => vi.advanceTimersByTimeAsync(IMPORT_POLL_MS));
}

const importInput = () => screen.getByLabelText("Import from a photo");
const addInput = () => screen.getByLabelText("Add another photo");
const importButton = () => screen.getByRole("button", { name: "Import recipe" });
const photoList = () => screen.getByRole("list", { name: "Photos of this recipe" });
/** The photos in the panel, by their labels, in order. */
const photoLabels = () => within(photoList()).getAllByRole("img").map((img) => img.getAttribute("alt") ?? img.getAttribute("aria-label"));
const cards = () => screen.queryAllByText(READING);

async function openNew(partial: Partial<FakeServer> = {}) {
  const fake = serve(partial);
  const rendered = renderAt("/recipes/new");
  await screen.findByRole("textbox", { name: "Name" });
  return { ...fake, ...rendered };
}

async function openCatalog(partial: Partial<FakeServer> = {}) {
  const fake = serve(partial);
  const rendered = renderAt("/");
  await screen.findByText("Beef Stew");
  await screen.findByRole("link", { name: fake.server.me.signedIn ? "Account" : "Sign in" });
  return { ...fake, ...rendered };
}

/** Adds `files` to the panel in order: the first with "Import from a photo", the others with "Add another photo". */
async function addPhotos(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  for (const [i, file] of files.entries()) await user.upload(i === 0 ? importInput() : addInput(), file);
}

/** Picks `files`, presses "Import recipe" and waits for the Catalog, as the editor sees it after an upload (IMP-4). */
async function importFrom(user: ReturnType<typeof userEvent.setup>, router: { state: { location: { pathname: string } } }, ...files: File[]) {
  await addPhotos(user, ...(files.length > 0 ? files : [jpeg()]));
  await user.click(importButton());
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
}

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IMP-1 start from the New recipe form", () => {
  it("has a 'Have it on paper?' panel above the fields, then 'or type it in'", async () => {
    await openNew();
    const panel = screen.getByRole("region", { name: "Have it on paper?" });
    expect(within(panel).getByText("Upload a photo of the recipe to begin.")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Import from a photo")).toHaveAttribute("type", "file");
    expect(within(panel).queryByRole("button", { name: "Import recipe" })).not.toBeInTheDocument();
    const divider = screen.getByText("or type it in");
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(panel.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("isn't on the Edit recipe form", async () => {
    serve({ recipes: [summary(PAD_THAI_ID, "Pad Thai")] });
    renderAt(`/recipes/${PAD_THAI_ID}/edit`);
    await screen.findByRole("heading", { level: 1, name: "Edit recipe" });
    expect(screen.queryByText("Have it on paper?")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Import from a photo")).not.toBeInTheDocument();
    expect(screen.queryByText("or type it in")).not.toBeInTheDocument();
  });

  it("shows a picked photo as 'Photo 1', with 'Add another photo' and 'Import recipe', and uploads nothing yet", async () => {
    const { fetchMock, router } = await openNew();
    await addPhotos(userEvent.setup(), jpeg());

    const panel = screen.getByRole("region", { name: "Have it on paper?" });
    expect(within(panel).getByText("Add each side or page of this recipe, in order. Up to 4 photos.")).toBeInTheDocument();
    expect(within(panel).queryByText("Upload a photo of the recipe to begin.")).not.toBeInTheDocument();
    expect(photoLabels()).toEqual(["Photo 1"]);
    expect(within(photoList()).getByRole("img", { name: "Photo 1" })).toHaveAttribute("src", "blob:preview");
    expect(within(panel).getByRole("button", { name: "Remove Photo 1" })).toBeInTheDocument();
    expect(addInput()).toHaveAttribute("type", "file");
    expect(importButton()).toBeEnabled();
    expect(uploads(fetchMock)).toHaveLength(0);
    expect(router.state.location.pathname).toBe("/recipes/new");
  });

  it("adds the next photos one at a time, as Photo 2, Photo 3, in the order added", async () => {
    await openNew();
    await addPhotos(userEvent.setup(), jpeg("front.jpg"), jpeg("back.jpg"), jpeg("insert.jpg"));
    expect(photoLabels()).toEqual(["Photo 1", "Photo 2", "Photo 3"]);
    expect(addInput()).not.toHaveAttribute("multiple");
  });

  it("removes any photo before the import starts; the others are numbered again in order", async () => {
    const user = userEvent.setup();
    const { fetchMock, router } = await openNew();
    const front = jpeg("front.jpg");
    const middle = jpeg("middle.jpg");
    const back = jpeg("back.jpg");
    await addPhotos(user, front, middle, back);

    await user.click(screen.getByRole("button", { name: "Remove Photo 2" }));

    expect(photoLabels()).toEqual(["Photo 1", "Photo 2"]);
    await user.click(importButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect((uploads(fetchMock)[0]!.body as FormData).getAll("photo")).toEqual([front, back]);
  });

  it("goes back to the empty panel when the only photo is removed", async () => {
    const user = userEvent.setup();
    await openNew();
    await addPhotos(user, jpeg());
    await user.click(screen.getByRole("button", { name: "Remove Photo 1" }));
    expect(screen.getByText("Upload a photo of the recipe to begin.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Photos of this recipe" })).not.toBeInTheDocument();
    expect(importInput()).toBeInTheDocument();
  });

  it("IMP-12, X-15: previews are local object URLs, released when a photo is removed or the form is left", async () => {
    const user = userEvent.setup();
    const created = vi.mocked(URL.createObjectURL);
    const revoked = vi.mocked(URL.revokeObjectURL);
    created.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const { router } = await openNew();
    await addPhotos(user, jpeg("front.jpg"), jpeg("back.jpg"));
    expect(created).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Remove Photo 1" }));
    expect(revoked).toHaveBeenCalledWith("blob:first");
    expect(revoked).not.toHaveBeenCalledWith("blob:second");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(revoked).toHaveBeenCalledWith("blob:second");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("IMP-2 accepted photos", () => {
  it("asks for JPEG, PNG or WebP, like the recipe photo field (REC-7), for the first photo and the next", async () => {
    await openNew();
    expect(importInput()).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await addPhotos(userEvent.setup(), jpeg());
    expect(addInput()).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  });

  it.each([
    ["a HEIC file chosen from Files", "IMG_0001.HEIC", "image/heic", 1000, "HEIC photos can't be used. Choose a JPEG instead."],
    ["a file over 15 MB", "big.jpg", "image/jpeg", 15 * 1024 * 1024 + 1, "The photo is larger than 15 MB. Choose a smaller one."],
    ["a file that isn't an image", "notes.txt", "text/plain", 1000, "Choose a JPEG, PNG or WebP photo."],
  ])("refuses %s at once with the REC-7 message, and no import starts", async (_what, name, type, size, message) => {
    const { fetchMock, router } = await openNew();
    const file = new File(["x"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    await userEvent.setup({ applyAccept: false }).upload(importInput(), file);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("list", { name: "Photos of this recipe" })).not.toBeInTheDocument();
    expect(uploads(fetchMock)).toHaveLength(0);
    expect(importReads(fetchMock)).toBe(0);
    expect(router.state.location.pathname).toBe("/recipes/new");
  });

  it("'A HEIC file added after one good photo': refused (REC-7); the first photo stays", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { fetchMock } = await openNew();
    const first = jpeg("front.jpg");
    await addPhotos(user, first);

    await user.upload(addInput(), new File(["x"], "IMG_0002.HEIC", { type: "image/heic" }));

    expect(screen.getByRole("alert")).toHaveTextContent("HEIC photos can't be used. Choose a JPEG instead.");
    expect(photoLabels()).toEqual(["Photo 1"]);
    expect(uploads(fetchMock)).toHaveLength(0);
    await user.click(importButton());
    await waitFor(() => expect(uploads(fetchMock)).toHaveLength(1));
    expect((uploads(fetchMock)[0]!.body as FormData).getAll("photo")).toEqual([first]);
  });

  it("'4 photos added': no more can be added", async () => {
    await openNew();
    await addPhotos(userEvent.setup(), jpeg("1.jpg"), jpeg("2.jpg"), jpeg("3.jpg"), jpeg("4.jpg"));
    expect(photoLabels()).toEqual(["Photo 1", "Photo 2", "Photo 3", "Photo 4"]);
    expect(screen.queryByLabelText("Add another photo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Import from a photo")).not.toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("can add a photo again once one of 4 is removed", async () => {
    const user = userEvent.setup();
    await openNew();
    await addPhotos(user, jpeg("1.jpg"), jpeg("2.jpg"), jpeg("3.jpg"), jpeg("4.jpg"));
    await user.click(screen.getByRole("button", { name: "Remove Photo 4" }));
    await user.upload(addInput(), jpeg("5.jpg"));
    expect(photoLabels()).toEqual(["Photo 1", "Photo 2", "Photo 3", "Photo 4"]);
  });
});

describe("IMP-3 one recipe per upload, any number at once", () => {
  it("sends one photo as a multipart POST /imports with one file part, X-Requested-By and the cookie", async () => {
    const { fetchMock, router } = await openNew();
    expect(importInput()).not.toHaveAttribute("multiple");
    const file = jpeg();
    await importFrom(userEvent.setup(), router, file);
    const sent = uploads(fetchMock);
    expect(sent).toHaveLength(1);
    const init = sent[0]!;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["x-requested-by"]).toBe("recipebox");
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["photo"]);
    expect(form.get("photo")).toBe(file);
  });

  it("'Card front has the ingredients, the back the steps; both added': one upload with both photos, in order", async () => {
    const { fetchMock, router } = await openNew();
    const front = jpeg("front.jpg");
    const back = jpeg("back.jpg");

    await importFrom(userEvent.setup(), router, front, back);

    const sent = uploads(fetchMock);
    expect(sent).toHaveLength(1);
    const form = sent[0]!.body as FormData;
    expect([...form.keys()]).toEqual(["photo", "photo"]);
    expect(form.getAll("photo")).toEqual([front, back]);
    expect(await screen.findAllByText(READING)).toHaveLength(1);
  });

  it("two recipes uploaded one after the other, both read fine: two cards, then both recipes added", async () => {
    const user = fakeTimers();
    const { server, router } = await openNew();
    await importFrom(user, router);
    expect(await screen.findAllByText(READING)).toHaveLength(1);

    await user.click(screen.getByRole("link", { name: "Add recipe" }));
    await screen.findByRole("textbox", { name: "Name" });
    expect(screen.getByText("Upload a photo of the recipe to begin.")).toBeInTheDocument();
    await importFrom(user, router, jpeg("front.jpg"), jpeg("back.jpg"));
    await waitFor(() => expect(cards()).toHaveLength(2));

    server.imports = [done("import-2", SCONES_ID, "Scones"), done("import-1", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew"), summary(SCONES_ID, "Scones")];
    await nextCheck();
    await waitFor(() => expect(cards()).toHaveLength(0));
    const list = screen.getByRole("list", { name: "Recipes" });
    await within(list).findByText("Banana Bread");
    expect(within(list).getByText("Scones")).toBeInTheDocument();
  });
});

describe("IMP-4 back to the Catalog", () => {
  it("shows the button is uploading and can't be pressed again, then goes to the Catalog with the message", async () => {
    let answer: (response: Response) => void = () => {};
    const user = userEvent.setup();
    const { fetchMock, router } = await openNew({ upload: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await addPhotos(user, jpeg(), jpeg("back.jpg"));
    await user.click(importButton());

    const uploading = await screen.findByRole("button", { name: "Uploading photos…" });
    expect(uploading).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Photo 1" })).toBeDisabled();
    expect(addInput()).toBeDisabled();
    await userEvent.setup({ pointerEventsCheck: 0 }).click(uploading);
    expect(uploads(fetchMock)).toHaveLength(1);

    answer(jsonResponse(202, { importId: "import-1", status: "reading" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText(UPLOADED)).toBeInTheDocument();
  });

  it.each([
    [
      "the server refuses the photo",
      () =>
        jsonResponse(400, {
          errors: [{ code: "photo.unsupportedType", field: "photos[0]", message: "This file isn't a JPEG, PNG or WebP image." }],
        }),
      "The photo wasn't uploaded. This file isn't a JPEG, PNG or WebP image.",
    ],
    ["the server fails", () => jsonResponse(500, { errors: [] }), "The photo wasn't uploaded. The server couldn't make the change. Try again."],
    [
      "the server can't be reached",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "The photo wasn't uploaded. Couldn't reach the server. Check the connection and try again.",
    ],
  ])("stays on the form with a message when %s, and no import is in progress", async (_what, upload, message) => {
    const user = userEvent.setup();
    const { fetchMock, router } = await openNew({ upload });
    await addPhotos(user, jpeg());
    await user.click(importButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(router.state.location.pathname).toBe("/recipes/new");
    expect(importButton()).toBeEnabled();
    expect(screen.queryByText(UPLOADED)).not.toBeInTheDocument();
    expect(importReads(fetchMock)).toBe(0);
  });

  it("keeps the photos in the panel when the upload fails, says the photos weren't uploaded, and tries again with them", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { fetchMock, router } = await openNew({
      upload: () => {
        if (fail) return Promise.reject(new TypeError("Failed to fetch"));
        return jsonResponse(202, { importId: "import-1", status: "reading" });
      },
    });
    const front = jpeg("front.jpg");
    const back = jpeg("back.jpg");
    await addPhotos(user, front, back);
    await user.click(importButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photos weren't uploaded. Couldn't reach the server. Check the connection and try again.",
    );
    expect(photoLabels()).toEqual(["Photo 1", "Photo 2"]);

    fail = false;
    await user.click(importButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const sent = uploads(fetchMock);
    expect(sent).toHaveLength(2);
    expect((sent[1]!.body as FormData).getAll("photo")).toEqual([front, back]);
  });

  it("names the photo the server refused when there are several", async () => {
    const user = userEvent.setup();
    await openNew({
      upload: () =>
        jsonResponse(400, {
          errors: [{ code: "photo.unreadable", field: "photos[1]", message: "This image can't be read. It may be damaged or incomplete." }],
        }),
    });
    await addPhotos(user, jpeg("front.jpg"), jpeg("back.jpg"));
    await user.click(importButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photos weren't uploaded. Photo 2: This image can't be read. It may be damaged or incomplete.",
    );
  });

  it("clears the message about a failed upload once a photo is added or removed", async () => {
    const user = userEvent.setup();
    await openNew({ upload: () => jsonResponse(500, { errors: [] }) });
    await addPhotos(user, jpeg("front.jpg"));
    await user.click(importButton());
    await screen.findByRole("alert");

    await user.upload(addInput(), jpeg("back.jpg"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("IMP-5 imports in progress", () => {
  it("shows one card per import reading, above the recipes, and none for imports that have ended", async () => {
    await openCatalog({
      imports: [
        { importId: "import-4", status: "reading" },
        { importId: "import-3", status: "reading" },
        done("import-2", STEW_ID, "Beef Stew"),
        { importId: "import-1", status: "failed" },
      ],
    });
    const list = await screen.findByRole("list", { name: "Imports in progress" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toHaveTextContent(READING);
      expect(item).toHaveTextContent(HINT);
      // Never the uploaded photo (IMP-12).
      expect(within(item).queryByRole("img")).not.toBeInTheDocument();
    }
    const recipes = screen.getByRole("list", { name: "Recipes" });
    expect(list.compareDocumentPosition(recipes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("checks again every 5 seconds while an import is reading, and stops when none is", async () => {
    fakeTimers();
    const { server, fetchMock } = await openCatalog({ imports: [{ importId: "import-1", status: "reading" }] });
    await screen.findByText(READING);
    const first = importReads(fetchMock);
    await nextCheck();
    expect(importReads(fetchMock)).toBe(first + 1);

    server.imports = [{ importId: "import-1", status: "failed" }];
    await nextCheck();
    await waitFor(() => expect(cards()).toHaveLength(0));
    const stopped = importReads(fetchMock);
    await nextCheck();
    await nextCheck();
    expect(importReads(fetchMock)).toBe(stopped);
  });

  it("doesn't check again when no import is reading", async () => {
    fakeTimers();
    const { fetchMock } = await openCatalog({ imports: [done("import-1", STEW_ID, "Beef Stew")] });
    await waitFor(() => expect(importReads(fetchMock)).toBe(1));
    await nextCheck();
    await nextCheck();
    expect(importReads(fetchMock)).toBe(1);
  });

  it.each([
    ["A visitor", VISITOR],
    ["A signed-in non-editor", NON_EDITOR],
  ])("%s opens the Catalog during an import: no card, and nothing about the import is asked for (X-1)", async (_who, me) => {
    fakeTimers();
    const { fetchMock } = await openCatalog({ me, imports: [{ importId: "import-1", status: "reading" }] });
    await nextCheck();
    expect(cards()).toHaveLength(0);
    expect(screen.queryByRole("list", { name: "Imports in progress" })).not.toBeInTheDocument();
    expect(importReads(fetchMock)).toBe(0);
  });

  it("stops checking when one of this device's imports is no longer listed, such as a record past its day", async () => {
    const user = fakeTimers();
    const { server, fetchMock, router } = await openNew();
    await importFrom(user, router);
    await screen.findByText(READING);
    await act(() => router.navigate("/privacy"));
    await screen.findByRole("heading", { level: 1, name: "Privacy" });
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));

    server.imports = [];
    await nextCheck();
    const gone = importReads(fetchMock);
    await nextCheck();
    await nextCheck();
    expect(importReads(fetchMock)).toBe(gone);
    expect(screen.queryByText(/imported$/)).not.toBeInTheDocument();
  });

  it("isn't checked on other pages when this device has no import in progress", async () => {
    fakeTimers();
    const { fetchMock, router } = await openCatalog({ imports: [{ importId: "import-1", status: "reading" }] });
    await screen.findByText(READING);
    await act(() => router.navigate("/privacy"));
    const left = importReads(fetchMock);
    await nextCheck();
    await nextCheck();
    expect(importReads(fetchMock)).toBe(left);
  });
});

describe("IMP-10 done", () => {
  it("shows '‹name› imported' with Open on whatever page the editor is on, and the recipe joins the Catalog", async () => {
    const user = fakeTimers();
    const { server, fetchMock, router } = await openNew();
    await importFrom(user, router);
    await screen.findByText(READING);

    await act(() => router.navigate("/privacy"));
    await screen.findByRole("heading", { level: 1, name: "Privacy" });
    const before = importReads(fetchMock);
    await nextCheck();
    // Still checked away from the Catalog, while this device's import is in progress.
    expect(importReads(fetchMock)).toBe(before + 1);

    server.imports = [done("import-1", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew")];
    await nextCheck();
    expect(await screen.findByText("Banana Bread imported")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/privacy");

    // The check stops once this device's import has ended and the Catalog isn't open.
    const ended = importReads(fetchMock);
    await nextCheck();
    expect(importReads(fetchMock)).toBe(ended);

    await act(() => router.navigate("/"));
    expect(await within(screen.getByRole("list", { name: "Recipes" })).findByText("Banana Bread")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${BREAD_ID}`));
    expect(await screen.findByRole("heading", { level: 1, name: "Banana Bread" })).toBeInTheDocument();
  });

  it("gives each of several imports finishing together its own message, one after another", async () => {
    const user = fakeTimers();
    const { server, router } = await openNew();
    await importFrom(user, router);
    await user.click(screen.getByRole("link", { name: "Add recipe" }));
    await screen.findByRole("textbox", { name: "Name" });
    await importFrom(user, router);
    await waitFor(() => expect(cards()).toHaveLength(2));
    // Let the upload message go first.
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));

    server.imports = [done("import-2", SCONES_ID, "Scones"), done("import-1", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew"), summary(SCONES_ID, "Scones")];
    await nextCheck();
    const first = await screen.findByText(/^(Scones|Banana Bread) imported$/);
    const firstName = first.textContent;
    expect(screen.getAllByText(/ imported$/)).toHaveLength(1);

    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));
    const second = await screen.findByText(/^(Scones|Banana Bread) imported$/);
    expect(second.textContent).not.toBe(firstName);
    expect([firstName, second.textContent].sort()).toEqual(["Banana Bread imported", "Scones imported"]);
  });

  it("waits for a message already shown, rather than replacing it", async () => {
    const user = fakeTimers();
    const { server, router } = await openNew();
    await importFrom(user, router);
    expect(await screen.findByText(UPLOADED)).toBeInTheDocument();

    server.imports = [done("import-1", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew")];
    await nextCheck();
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(screen.getByText(UPLOADED)).toBeInTheDocument();
    expect(screen.queryByText("Banana Bread imported")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(await screen.findByText("Banana Bread imported")).toBeInTheDocument();
  });

  it("keeps watching an import that an answer asked for before its upload finished doesn't list", async () => {
    const user = fakeTimers();
    const { server, fetchMock, router } = await openCatalog({ imports: [{ importId: "elsewhere", status: "reading" }] });
    await screen.findByText(READING);
    server.held = [];
    const before = importReads(fetchMock);
    await nextCheck();
    expect(importReads(fetchMock)).toBe(before + 1);

    await user.click(screen.getByRole("link", { name: "Add recipe" }));
    await screen.findByRole("textbox", { name: "Name" });
    await importFrom(user, router);
    // The answer asked for before the upload, without the new import.
    await act(async () => release(server));
    await nextCheck();

    server.imports = [done("import-1", BREAD_ID, "Banana Bread"), { importId: "elsewhere", status: "reading" }];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew")];
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));
    await nextCheck();
    expect(await screen.findByText("Banana Bread imported")).toBeInTheDocument();
  });

  it("shows an imported message again after another message pushed it aside", async () => {
    const user = fakeTimers();
    const { server, router } = await openNew();
    await importFrom(user, router);
    await screen.findByText(READING);
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));

    server.imports = [done("import-1", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew")];
    await nextCheck();
    expect(await screen.findByText("Banana Bread imported")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Add recipe" }));
    await screen.findByRole("textbox", { name: "Name" });
    await importFrom(user, router);
    expect(await screen.findByText(UPLOADED)).toBeInTheDocument();
    expect(screen.queryByText("Banana Bread imported")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));
    expect(await screen.findByText("Banana Bread imported")).toBeInTheDocument();
    expect(screen.queryByText(UPLOADED)).not.toBeInTheDocument();
  });

  it("shows no message for an import started on another device, but its recipe joins the Catalog", async () => {
    fakeTimers();
    const { server } = await openCatalog({ imports: [{ importId: "elsewhere", status: "reading" }] });
    await screen.findByText(READING);
    server.imports = [done("elsewhere", BREAD_ID, "Banana Bread")];
    server.recipes = [summary(BREAD_ID, "Banana Bread"), summary(STEW_ID, "Beef Stew")];
    await nextCheck();
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(await within(screen.getByRole("list", { name: "Recipes" })).findByText("Banana Bread")).toBeInTheDocument();
    expect(screen.queryByText("Banana Bread imported")).not.toBeInTheDocument();
  });
});

describe("IMP-11 failure, as the client sees it", () => {
  it("removes a failed import's card with no message, and stops checking", async () => {
    const user = fakeTimers();
    const { server, fetchMock, router } = await openNew();
    await importFrom(user, router);
    await screen.findByText(READING);
    act(() => vi.advanceTimersByTime(NOTICE_MS + 100));

    server.imports = [{ importId: "import-1", status: "failed" }];
    await nextCheck();
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(screen.queryByText(/imported$/)).not.toBeInTheDocument();
    expect(document.querySelector(".notice")).toBeNull();
    const stopped = importReads(fetchMock);
    await nextCheck();
    expect(importReads(fetchMock)).toBe(stopped);
  });
});
