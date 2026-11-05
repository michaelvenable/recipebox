import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type EditorRecipe, RecipeContentInput } from "@recipebox/shared";
import { planKeys, recipeKeys, rediscoverKeys, tagKeys } from "../src/api/query-keys.js";
import { ME_QUERY_KEY } from "../src/auth/sign-in.js";
import { routes } from "../src/routes.js";
import { API, EDITOR, type FetchMock, VISITOR, jsonResponse, mockApi, renderAt } from "./helpers.js";

const ID = "0b6a3c2e-0000-4000-8000-000000000002";
const NEW_ID = "0b6a3c2e-0000-4000-8000-000000000009";

const PAD_THAI: EditorRecipe = {
  id: ID,
  name: "Pad Thai",
  ingredients: ["200 g flat rice noodles", "3 tbsp tamarind paste", "2 eggs"],
  steps: ["Soak the noodles.", "Fry everything."],
  totalTimeMinutes: 90,
  tags: ["dinner", "noodles"],
  hasPhoto: false,
  cookedAt: [],
  timesCooked: 0,
};

type Answer = Response | Promise<Response> | unknown;

interface FakeApi {
  /** GET /recipes/{id}, by id. */
  recipes?: Record<string, () => Answer>;
  /** Any change (POST, PUT, DELETE), by method and path, with its JSON body parsed, or the FormData of an upload. */
  change?: (method: string, path: string, body: unknown) => Answer;
  suggestions?: (url: URL) => Answer;
}

function respond(answer: Answer): Response | Promise<Response> {
  return answer instanceof Response || answer instanceof Promise ? answer : jsonResponse(200, answer);
}

function mockRecipeApi({ recipes = {}, change, suggestions = () => [] }: FakeApi): FetchMock {
  return mockApi(EDITOR, (url, init) => {
    const method = init.method ?? "GET";
    if (method !== "GET") {
      if (change === undefined) return undefined;
      const body = init.body instanceof FormData ? init.body : JSON.parse(String(init.body));
      return respond(change(method, url.pathname, body));
    }
    if (url.pathname === "/recipes" || url.pathname === "/tags") return jsonResponse(200, []);
    if (url.pathname === "/tag-suggestions") return respond(suggestions(url));
    const match = /^\/recipes\/([^/]+)$/.exec(url.pathname);
    if (match !== null) {
      const recipe = recipes[decodeURIComponent(match[1] ?? "")];
      return recipe === undefined ? jsonResponse(404, { errors: [{ code: "notFound", message: "Not found." }] }) : respond(recipe());
    }
    return undefined;
  });
}

interface SentChange {
  method: string;
  path: string;
  /** The JSON body parsed, or the FormData of an upload. */
  body: unknown;
  contentType: string | undefined;
  credentials: RequestCredentials | undefined;
}

function changes(fetchMock: FetchMock): SentChange[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") !== "GET")
    .map(([input, init]) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return {
        method: init?.method ?? "GET",
        path: new URL(String(input)).pathname,
        body: init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body)),
        contentType: headers["content-type"],
        credentials: init?.credentials,
      };
    });
}

function suggestionRequests(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === "/tag-suggestions")
    .map((url) => url.search);
}

async function openForm(fake: FakeApi, path: string) {
  const fetchMock = mockRecipeApi(fake);
  const rendered = renderAt(path);
  await screen.findByRole("textbox", { name: "Name" });
  return { fetchMock, ...rendered };
}

const openNew = (fake: FakeApi = {}) => openForm(fake, "/recipes/new");
const openEdit = (fake: FakeApi = {}, recipe: EditorRecipe = PAD_THAI) =>
  openForm({ recipes: { [recipe.id]: () => recipe }, ...fake }, `/recipes/${recipe.id}/edit`);

const field = (name: string) => screen.getByRole("textbox", { name });
const button = (name: string) => screen.getByRole("button", { name });
const save = () => userEvent.click(button("Save"));
const entryValues = (noun: "Ingredient" | "Step") =>
  screen.queryAllByRole("textbox", { name: new RegExp(`^${noun} \\d+$`) }).map((box) => (box as HTMLTextAreaElement).value);

function jpeg(name = "photo.jpg"): File {
  return new File(["jpeg bytes"], name, { type: "image/jpeg" });
}

function refused(status: number, code: string, message: string, fieldName?: string): Response {
  return jsonResponse(status, { errors: [fieldName === undefined ? { code, message } : { code, field: fieldName, message }] });
}

beforeEach(() => {
  // jsdom has no object URLs; the preview only needs an address.
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("REC-1 create", () => {
  it("sends the content as typed, exactly a RecipeContentInput with no time (X-12), then opens the new recipe", async () => {
    const { fetchMock, router } = await openNew({
      change: () => jsonResponse(201, { ...PAD_THAI, id: NEW_ID }),
      recipes: { [NEW_ID]: () => ({ ...PAD_THAI, id: NEW_ID }) },
    });
    expect(screen.getByRole("heading", { level: 1, name: "New recipe" })).toBeInTheDocument();
    await userEvent.type(field("Name"), "  Pad Thai ");
    await userEvent.type(field("Ingredient 1"), "2 eggs");
    await userEvent.click(button("+ Add ingredient"));
    await userEvent.type(field("Ingredient 2"), "  ");
    await userEvent.type(field("Step 1"), "Fry.");
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`));
    const sent = changes(fetchMock);
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/recipes",
        // REC-2: trimming and dropping blank entries are the server's.
        body: { name: "  Pad Thai ", ingredients: ["2 eggs", "  "], steps: ["Fry."], tags: [] },
        contentType: "application/json",
        credentials: "include",
      },
    ]);
    expect(RecipeContentInput.parse(sent[0]?.body)).toEqual(sent[0]?.body);
    expect(await screen.findByRole("heading", { level: 1, name: "Pad Thai" })).toBeInTheDocument();
    // The form's top row is gone with the form.
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("shows the server's errors next to their fields, and focuses a summary at the top", async () => {
    const { fetchMock, router } = await openNew({
      change: () =>
        jsonResponse(400, {
          errors: [
            { code: "name.tooLong", field: "name", message: "Name must be at most 200 characters." },
            { code: "entry.tooLong", field: "ingredients[1]", message: "An entry must be at most 1000 characters." },
            { code: "totalTime.outOfRange", field: "totalTimeMinutes", message: "Total time must be from 1 to 1440 minutes." },
            { code: "tag.comma", field: "tags[0]", message: "A tag can't contain a comma. Add each tag separately." },
          ],
        }),
    });
    await userEvent.type(field("Name"), "A long name");
    await userEvent.type(field("Ingredient 1"), "eggs");
    await userEvent.click(button("+ Add ingredient"));
    await userEvent.type(field("Ingredient 2"), "far too long");
    await userEvent.type(field("Step 1"), "Cook.");
    await userEvent.type(field("hours"), "25");
    await userEvent.click(button("+ Tag"));
    await userEvent.type(field("Add a tag"), "dinner, quick{Enter}");
    await save();

    const summary = await screen.findByText("Not saved. Fix the 4 fields marked below.");
    expect(summary.closest("[role=alert]")).toHaveFocus();
    expect(field("Name")).toHaveAttribute("aria-invalid", "true");
    expect(field("Name")).toHaveAccessibleDescription("Name must be at most 200 characters.");
    expect(field("Ingredient 1")).not.toHaveAttribute("aria-invalid");
    expect(field("Ingredient 2")).toHaveAccessibleDescription("An entry must be at most 1000 characters.");
    expect(field("hours")).toHaveAccessibleDescription("Total time must be from 1 to 1440 minutes.");
    expect(field("minutes")).toHaveAccessibleDescription("Total time must be from 1 to 1440 minutes.");
    expect(field("Add a tag")).toHaveAccessibleDescription("“dinner, quick”: A tag can't contain a comma. Add each tag separately.");
    expect(router.state.location.pathname).toBe("/recipes/new");
    expect(changes(fetchMock)).toHaveLength(1);
  });

  it("keeps a row's error with the row when it moves", async () => {
    await openNew({
      change: () => refused(400, "entry.tooLong", "An entry must be at most 1000 characters.", "ingredients[1]"),
    });
    await userEvent.type(field("Name"), "Toast");
    await userEvent.type(field("Ingredient 1"), "Bread");
    await userEvent.click(button("+ Add ingredient"));
    await userEvent.type(field("Ingredient 2"), "Butter, a lot");
    await userEvent.type(field("Step 1"), "Toast it.");
    await save();
    await screen.findByText("Not saved. Fix the field marked below.");

    await userEvent.click(button("Move ingredient 2 up"));
    expect(field("Ingredient 1")).toHaveValue("Butter, a lot");
    expect(field("Ingredient 1")).toHaveAccessibleDescription("An entry must be at most 1000 characters.");
    expect(field("Ingredient 2")).not.toHaveAttribute("aria-describedby");
  });

  it("says what is obviously missing without sending anything: a name, an ingredient and a step", async () => {
    const { fetchMock } = await openNew();
    await userEvent.type(field("Ingredient 1"), "   ");
    await save();

    const summary = await screen.findByText("Not saved. Fix the 3 fields marked below.");
    expect(summary.closest("[role=alert]")).toHaveFocus();
    expect(field("Name")).toHaveAccessibleDescription("Enter a name (up to 200 characters).");
    expect(screen.getByRole("group", { name: "Ingredients" })).toHaveAccessibleDescription(
      "Add at least one ingredient. Blank ones are ignored.",
    );
    expect(screen.getByRole("group", { name: "Steps" })).toHaveAccessibleDescription("Add at least one step. Blank steps are ignored.");
    expect(changes(fetchMock)).toEqual([]);
  });

  it("says when the server can't be reached, keeping what was typed", async () => {
    await openNew({ change: () => Promise.reject(new TypeError("Failed to fetch")) });
    await userEvent.type(field("Name"), "Toast");
    await userEvent.type(field("Ingredient 1"), "Bread");
    await userEvent.type(field("Step 1"), "Toast it.");
    await save();
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Not saved.Couldn't reach the server. Check the connection and try again.");
    expect(summary).toHaveFocus();
    expect(field("Name")).toHaveValue("Toast");
    expect(button("Save")).toBeEnabled();
  });
});

describe("REC-5 edit", () => {
  it("fills the form with the recipe", async () => {
    await openEdit();
    expect(screen.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeInTheDocument();
    expect(field("Name")).toHaveValue("Pad Thai");
    expect(entryValues("Ingredient")).toEqual(PAD_THAI.ingredients);
    expect(entryValues("Step")).toEqual(PAD_THAI.steps);
    expect(field("hours")).toHaveValue("1");
    expect(field("minutes")).toHaveValue("30");
    expect(within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "dinner",
      "noodles",
      "+ Tag",
    ]);
  });

  it("saves the whole content with PUT, tags included, then shows the saved recipe and marks what shows it stale", async () => {
    const savedRecipe = { ...PAD_THAI, name: "Pad Thai Jay" };
    let stored = PAD_THAI;
    const { fetchMock, router, queryClient } = await openEdit({
      recipes: { [ID]: () => stored },
      change: () => (stored = savedRecipe),
    });
    queryClient.setQueryData(recipeKeys.list({ name: "", tags: [] }), []);
    queryClient.setQueryData(planKeys.all, []);
    queryClient.setQueryData(rediscoverKeys.all, []);
    queryClient.setQueryData(tagKeys.all, []);
    await userEvent.type(field("Name"), " Jay");
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    expect(changes(fetchMock)).toEqual([
      {
        method: "PUT",
        path: `/recipes/${ID}/content`,
        body: {
          name: "Pad Thai Jay",
          ingredients: PAD_THAI.ingredients,
          steps: PAD_THAI.steps,
          totalTimeMinutes: 90,
          tags: ["dinner", "noodles"],
        },
        contentType: "application/json",
        credentials: "include",
      },
    ]);
    expect(RecipeContentInput.parse(changes(fetchMock)[0]?.body)).toBeDefined();
    expect(queryClient.getQueryData(recipeKeys.detail(ID))).toEqual(savedRecipe);
    for (const key of [recipeKeys.list({ name: "", tags: [] }), planKeys.all, rediscoverKeys.all, tagKeys.all]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(await screen.findByRole("heading", { level: 1, name: "Pad Thai Jay" })).toBeInTheDocument();
  });

  it("sends no total time once both fields are cleared", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.clear(field("hours"));
    await userEvent.clear(field("minutes"));
    await save();
    await waitFor(() => expect(changes(fetchMock)).toHaveLength(1));
    expect(changes(fetchMock)[0]?.body).not.toHaveProperty("totalTimeMinutes");
  });

  it("uses the recipe's change key, so its view waits for the save and the save for the view (COOK-1)", async () => {
    let answer: (response: Response) => void = () => {};
    const { queryClient } = await openEdit({ change: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await userEvent.type(field("Name"), "!");
    await save();
    expect(queryClient.isMutating({ mutationKey: recipeKeys.change(ID) })).toBe(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    answer(jsonResponse(200, PAD_THAI));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  });

  it("goes straight back to the recipe when nothing changed", async () => {
    const { fetchMock, router } = await openEdit();
    await save();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    expect(changes(fetchMock)).toEqual([]);
  });
});

describe("REC-17, REC-4 a recipe in the trash", () => {
  it("says the recipe is in the trash when the save is refused, keeping the form", async () => {
    const { router } = await openEdit({
      change: () => refused(409, "recipe.inTrash", "This recipe is in the trash. Restore it before changing it."),
    });
    await userEvent.type(field("Name"), " Jay");
    await save();
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Not saved.This recipe is in the trash. Restore it before changing it.");
    expect(summary).toHaveFocus();
    expect(field("Name")).toHaveValue("Pad Thai Jay");
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);
  });

  it("shows not found for a recipe that is in the trash or unknown, which the API answers with 404", async () => {
    mockRecipeApi({});
    renderAt(`/recipes/${ID}/edit`);
    expect(await screen.findByRole("heading", { level: 1, name: "Recipe not found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});

describe("REC-3, REC-5 ingredients and steps", () => {
  it("adds, removes and moves entries, sending them in the order shown", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.click(button("Move ingredient 3 up"));
    expect(entryValues("Ingredient")).toEqual(["200 g flat rice noodles", "2 eggs", "3 tbsp tamarind paste"]);
    expect(button("Move ingredient 2 up")).toHaveFocus();
    await userEvent.click(button("Move ingredient 2 up"));
    expect(entryValues("Ingredient")).toEqual(["2 eggs", "200 g flat rice noodles", "3 tbsp tamarind paste"]);
    // At the top the up button can't be pressed, so focus stays on the row's down button.
    expect(button("Move ingredient 1 down")).toHaveFocus();

    await userEvent.click(button("Remove ingredient 2"));
    expect(entryValues("Ingredient")).toEqual(["2 eggs", "3 tbsp tamarind paste"]);
    expect(field("Ingredient 2")).toHaveFocus();

    await userEvent.click(button("+ Add ingredient"));
    expect(field("Ingredient 3")).toHaveFocus();
    await userEvent.type(field("Ingredient 3"), "1 lime,\ncut into wedges");

    await userEvent.click(button("Move step 1 down"));
    expect(button("Move step 2 up")).toHaveFocus();
    await userEvent.click(button("+ Add step"));
    await userEvent.type(field("Step 3"), "Serve.");
    await save();

    await waitFor(() => expect(changes(fetchMock)).toHaveLength(1));
    expect(changes(fetchMock)[0]?.body).toMatchObject({
      ingredients: ["2 eggs", "3 tbsp tamarind paste", "1 lime,\ncut into wedges"],
      steps: ["Fry everything.", "Soak the noodles.", "Serve."],
    });
  });

  it("disables moving the first entry up and the last one down", async () => {
    await openEdit();
    expect(button("Move ingredient 1 up")).toBeDisabled();
    expect(button("Move ingredient 3 down")).toBeDisabled();
    expect(button("Move ingredient 2 up")).toBeEnabled();
    expect(button("Move ingredient 2 down")).toBeEnabled();
  });

  it("focuses + Add when the last entry is removed", async () => {
    await openNew();
    await userEvent.click(button("Remove step 1"));
    expect(entryValues("Step")).toEqual([]);
    expect(button("+ Add step")).toHaveFocus();
  });
});

describe("REC-1 total time", () => {
  it("sends hours and minutes as minutes", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.clear(field("hours"));
    await userEvent.type(field("hours"), "2");
    await userEvent.clear(field("minutes"));
    await userEvent.type(field("minutes"), "15");
    await save();
    await waitFor(() => expect(changes(fetchMock)).toHaveLength(1));
    expect(changes(fetchMock)[0]?.body).toMatchObject({ totalTimeMinutes: 135 });
  });

  it("asks for numbers rather than sending text that isn't one", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.clear(field("minutes"));
    await userEvent.type(field("minutes"), "half an hour");
    await save();
    expect(await screen.findByText("Not saved. Fix the field marked below.")).toBeInTheDocument();
    expect(field("minutes")).toHaveAccessibleDescription("Enter the time as numbers of hours and minutes.");
    expect(changes(fetchMock)).toEqual([]);
  });
});

describe("REC-10, REC-12 tags in the form", () => {
  it("offers suggestions for a new recipe without a recipe id, and saves the tags with the content", async () => {
    const { fetchMock } = await openNew({
      suggestions: (url) => (url.searchParams.get("typed") === "" ? ["curry", "thai"] : ["thai"]),
      change: () => jsonResponse(201, { ...PAD_THAI, id: NEW_ID }),
      recipes: { [NEW_ID]: () => ({ ...PAD_THAI, id: NEW_ID }) },
    });
    await userEvent.click(button("+ Tag"));
    const suggested = await screen.findByRole("group", { name: "Suggested tags" });
    expect(within(suggested).getAllByRole("button").map((b) => b.textContent)).toEqual(["curry", "thai"]);
    expect(suggestionRequests(fetchMock)).toContain("?typed=");

    await userEvent.click(button("thai"));
    // REC-12: a tag the recipe has is not offered again.
    await waitFor(() =>
      expect(within(screen.getByRole("group", { name: "Suggested tags" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
        "curry",
      ]),
    );
    await userEvent.type(field("Add a tag"), " Quick {Enter}");
    await userEvent.type(field("Add a tag"), "spicy{Enter}");
    await userEvent.click(button("Remove tag spicy"));
    expect(within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "thai",
      "Quick",
    ]);

    await userEvent.type(field("Name"), "Pad Thai");
    await userEvent.type(field("Ingredient 1"), "Noodles");
    await userEvent.type(field("Step 1"), "Cook.");
    await save();
    await waitFor(() => expect(changes(fetchMock)).toHaveLength(1));
    // Lowercasing and sorting are the server's (REC-11).
    expect(changes(fetchMock)[0]?.body).toMatchObject({ tags: ["thai", "Quick"] });
  });

  it("asks for suggestions for an existing recipe with its id", async () => {
    const { fetchMock } = await openEdit({ suggestions: () => ["thai"] });
    await userEvent.click(button("+ Tag"));
    await userEvent.type(field("Add a tag"), "th");
    await waitFor(() => expect(suggestionRequests(fetchMock)).toContain(`?typed=th&recipeId=${ID}`));
  });
});

describe("REC-7 photo", () => {
  it("offers only JPEG, PNG and WebP, so an iPhone converts HEIC photos", async () => {
    await openNew();
    expect(screen.getByLabelText("Add photo")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  });

  it("uploads a picked photo on Save as multipart PUT with one file part and the session cookie", async () => {
    const withPhoto = { ...PAD_THAI, hasPhoto: true };
    let stored = PAD_THAI;
    const { fetchMock, router, queryClient } = await openEdit({
      recipes: { [ID]: () => stored },
      change: () => (stored = withPhoto),
    });
    queryClient.setQueryData(recipeKeys.list({ name: "", tags: [] }), []);
    const file = jpeg();
    await userEvent.upload(screen.getByLabelText("Add photo"), file);
    expect(screen.getByRole("img", { name: "New photo" })).toHaveAttribute("src", "blob:preview");
    expect(changes(fetchMock)).toEqual([]);
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    const sent = changes(fetchMock);
    // The content is unchanged, so only the photo is sent.
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /recipes/${ID}/photo`]);
    expect(sent[0]?.credentials).toBe("include");
    expect(sent[0]?.contentType).toBeUndefined();
    const parts = [...(sent[0]?.body as FormData).entries()];
    expect(parts).toHaveLength(1);
    expect(parts[0]?.[1]).toBe(file);
    expect(queryClient.getQueryData(recipeKeys.detail(ID))).toEqual(withPhoto);
    expect(queryClient.getQueryState(recipeKeys.list({ name: "", tags: [] }))?.isInvalidated).toBe(true);
  });

  it("for a new recipe, uploads the photo once the recipe is created, then opens it", async () => {
    const created = { ...PAD_THAI, id: NEW_ID };
    const { fetchMock, router } = await openNew({
      change: (method) => (method === "POST" ? jsonResponse(201, created) : { ...created, hasPhoto: true }),
      recipes: { [NEW_ID]: () => ({ ...created, hasPhoto: true }) },
    });
    await userEvent.type(field("Name"), "Pad Thai");
    await userEvent.type(field("Ingredient 1"), "Noodles");
    await userEvent.type(field("Step 1"), "Cook.");
    await userEvent.upload(screen.getByLabelText("Add photo"), jpeg());
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`));
    expect(changes(fetchMock).map((c) => `${c.method} ${c.path}`)).toEqual(["POST /recipes", `PUT /recipes/${NEW_ID}/photo`]);
  });

  it.each([
    ["photo.tooLarge", 400, "The photo is larger than 15 MB. Choose a smaller one."],
    ["photo.unsupportedType", 400, "This file isn't a JPEG, PNG or WebP image."],
    ["photo.unreadable", 400, "This image can't be read. It may be damaged or incomplete."],
    ["photo.busy", 503, "Too many photos are being processed. Try again in a moment."],
  ])("keeps the saved content and the picked photo when the upload is refused with %s", async (code, status, message) => {
    const { router } = await openEdit({
      change: (_method, path) => (path.endsWith("/content") ? { ...PAD_THAI, name: "Pad Thai Jay" } : refused(status, code, message)),
    });
    await userEvent.type(field("Name"), " Jay");
    await userEvent.upload(screen.getByLabelText("Add photo"), jpeg());
    await save();

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("The recipe is saved, but the photo isn't.");
    expect(summary).toHaveFocus();
    expect(screen.getByRole("group", { name: "Photo" })).toHaveAccessibleDescription(message);
    expect(screen.getByRole("img", { name: "New photo" })).toBeInTheDocument();
    expect(field("Name")).toHaveValue("Pad Thai Jay");
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);
  });

  it("tries only the photo again on the next Save, after it was busy", async () => {
    let uploads = 0;
    const { fetchMock, router } = await openEdit({
      change: (_method, path) => {
        if (path.endsWith("/content")) return { ...PAD_THAI, name: "Pad Thai Jay" };
        uploads += 1;
        return uploads === 1
          ? refused(503, "photo.busy", "Too many photos are being processed. Try again in a moment.")
          : { ...PAD_THAI, name: "Pad Thai Jay", hasPhoto: true };
      },
    });
    await userEvent.type(field("Name"), " Jay");
    await userEvent.upload(screen.getByLabelText("Add photo"), jpeg());
    await save();
    await screen.findByText("The recipe is saved, but the photo isn't.");
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    expect(changes(fetchMock).map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /recipes/${ID}/content`,
      `PUT /recipes/${ID}/photo`,
      `PUT /recipes/${ID}/photo`,
    ]);
  });

  it("for a new recipe whose photo fails, stays on the form for the created recipe, so Save doesn't create it twice", async () => {
    let uploads = 0;
    const created = { ...PAD_THAI, id: NEW_ID };
    const { fetchMock, router } = await openNew({
      change: (method) => {
        if (method === "POST") return jsonResponse(201, created);
        uploads += 1;
        return uploads === 1 ? refused(503, "photo.busy", "Too many photos are being processed. Try again in a moment.") : created;
      },
      recipes: { [NEW_ID]: () => created },
    });
    await userEvent.type(field("Name"), "Pad Thai");
    await userEvent.type(field("Ingredient 1"), "Noodles");
    await userEvent.type(field("Step 1"), "Cook.");
    await userEvent.upload(screen.getByLabelText("Add photo"), jpeg());
    await save();
    await screen.findByText("The recipe is saved, but the photo isn't.");
    expect(screen.getByRole("heading", { level: 1, name: "Edit recipe" })).toBeInTheDocument();

    await save();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${NEW_ID}`));
    expect(changes(fetchMock).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /recipes",
      `PUT /recipes/${NEW_ID}/photo`,
      `PUT /recipes/${NEW_ID}/photo`,
    ]);
  });

  it.each([
    ["a file over 15 MB", "big.jpg", "image/jpeg", 15 * 1024 * 1024 + 1, "The photo is larger than 15 MB. Choose a smaller one."],
    ["a HEIC photo", "IMG_0001.HEIC", "image/heic", 1000, "HEIC photos can't be used. Choose a JPEG instead."],
    ["a file that isn't an image", "notes.txt", "text/plain", 1000, "Choose a JPEG, PNG or WebP photo."],
  ])("refuses %s before uploading it", async (_what, name, type, size, message) => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    const file = new File(["x"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    // As if chosen some way the picker doesn't filter, such as from Files.
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText("Add photo"), file);

    expect(screen.getByRole("group", { name: "Photo" })).toHaveAccessibleDescription(message);
    expect(screen.queryByRole("img", { name: "New photo" })).not.toBeInTheDocument();
    await save();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(changes(fetchMock)).toEqual([]);
  });

  it("removes the photo with DELETE on Save", async () => {
    const withPhoto = { ...PAD_THAI, hasPhoto: true };
    const { fetchMock, router } = await openEdit({ change: () => PAD_THAI }, withPhoto);
    expect(screen.getByRole("img", { name: "Current photo" })).toHaveAttribute("src", `${API}/recipes/${ID}/photo`);
    await userEvent.click(button("Remove photo"));
    expect(screen.queryByRole("img", { name: "Current photo" })).not.toBeInTheDocument();
    expect(screen.getByText(/The photo will be removed when you save\./)).toBeInTheDocument();
    await save();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    expect(changes(fetchMock)).toEqual([
      { method: "DELETE", path: `/recipes/${ID}/photo`, body: {}, contentType: "application/json", credentials: "include" },
    ]);
  });

  it("keeps the photo after all with Keep the photo, sending nothing", async () => {
    const { fetchMock } = await openEdit({}, { ...PAD_THAI, hasPhoto: true });
    await userEvent.click(button("Remove photo"));
    await userEvent.click(button("Keep the photo"));
    expect(screen.getByRole("img", { name: "Current photo" })).toBeInTheDocument();
    await save();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(changes(fetchMock)).toEqual([]);
  });
});

describe("Edit form: Cancel and Save replace the navigation row (docs/mockups/README.md)", () => {
  it("shows Cancel, the title and Save in place of the navigation, which returns after leaving", async () => {
    const { router } = await openEdit();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Recipes" })).not.toBeInTheDocument();
    const bar = screen.getByRole("banner");
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
    expect(within(bar).getByRole("heading", { level: 1, name: "Edit recipe" })).toBeInTheDocument();

    await userEvent.click(button("Cancel"));
    expect(router.state.location.pathname).toBe(`/recipes/${ID}`);
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("leaves a new recipe without changes for the list", async () => {
    const { router, fetchMock } = await openNew();
    await userEvent.click(button("Cancel"));
    expect(router.state.location.pathname).toBe("/");
    expect(changes(fetchMock)).toEqual([]);
  });

  it("asks before discarding changes on Cancel; Keep editing keeps them, Discard leaves without saving", async () => {
    const { router, fetchMock } = await openEdit();
    await userEvent.type(field("Name"), " Jay");
    await userEvent.click(button("Cancel"));

    const dialog = screen.getByRole("alertdialog", { name: "Discard your changes?" });
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(field("Name")).toHaveValue("Pad Thai Jay");
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);

    await userEvent.click(button("Cancel"));
    await userEvent.click(button("Discard"));
    expect(router.state.location.pathname).toBe(`/recipes/${ID}`);
    expect(changes(fetchMock)).toEqual([]);
  });

  it("counts a picked photo as a change", async () => {
    await openEdit();
    await userEvent.upload(screen.getByLabelText("Add photo"), jpeg());
    await userEvent.click(button("Cancel"));
    expect(screen.getByRole("alertdialog", { name: "Discard your changes?" })).toBeInTheDocument();
  });

  it("asks before leaving with unsaved changes some other way, such as the browser's back button", async () => {
    const { router } = await openEdit();
    await userEvent.type(field("Ingredient 1"), " (wide)");
    await act(() => router.navigate("/"));

    expect(screen.getByRole("alertdialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);
    await userEvent.click(button("Keep editing"));
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);

    await act(() => router.navigate("/"));
    await userEvent.click(button("Discard"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("doesn't stop leaving without changes", async () => {
    const { router } = await openEdit();
    await act(() => router.navigate("/"));
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("has the browser warn on closing or reloading the page only with unsaved changes", async () => {
    await openEdit();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await userEvent.type(field("Name"), " Jay");
    expect(unload()).toBe(true);
  });

  it("goes back to the page the editor came from on Cancel, when there is one in the app", async () => {
    mockRecipeApi({ recipes: { [ID]: () => PAD_THAI } });
    const router = createMemoryRouter(routes, { initialEntries: ["/", `/recipes/${ID}/edit`], initialIndex: 1 });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("textbox", { name: "Name" });
    await userEvent.click(button("Cancel"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.historyAction).toBe("POP");
  });

  it("returns focus to Cancel after Keep editing", async () => {
    await openEdit();
    await userEvent.type(field("Name"), " Jay");
    await userEvent.click(button("Cancel"));
    await userEvent.click(button("Keep editing"));
    expect(button("Cancel")).toHaveFocus();
  });
});

describe("REC-5, REC-10 the form starts from the recipe as saved", () => {
  it("waits for a tag change still being saved from the recipe view, so Save doesn't undo it", async () => {
    let answer: (response: Response) => void = () => {};
    let stored = PAD_THAI;
    const fetchMock = mockRecipeApi({
      recipes: { [ID]: () => stored },
      change: (_method, path) => (path.endsWith("/tags") ? new Promise<Response>((resolve) => (answer = resolve)) : stored),
    });
    const { router } = renderAt(`/recipes/${ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Remove tag noodles" }));
    await userEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(screen.getByText("Loading recipe…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();

    stored = { ...PAD_THAI, tags: ["dinner"] };
    answer(jsonResponse(200, stored));
    await screen.findByRole("textbox", { name: "Name" });
    expect(within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "dinner",
      "+ Tag",
    ]);
    await userEvent.type(field("Name"), "!");
    await save();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    expect(changes(fetchMock).at(-1)?.body).toMatchObject({ name: "Pad Thai!", tags: ["dinner"] });
  });

  it("waits for the recipe to be reloaded rather than starting from a cached copy that may be out of date", async () => {
    let stored = PAD_THAI;
    mockRecipeApi({ recipes: { [ID]: () => stored } });
    renderAt(`/recipes/${ID}`);
    await screen.findByRole("heading", { level: 1, name: "Pad Thai" });
    // Changed on another device meanwhile.
    stored = { ...PAD_THAI, name: "Pad See Ew" };
    await userEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Pad See Ew");
  });

  it("shows not found, not the cached copy, when the recipe was moved to the trash meanwhile (REC-4, REC-17)", async () => {
    let trashed = false;
    mockRecipeApi({
      recipes: { [ID]: () => (trashed ? jsonResponse(404, { errors: [{ code: "notFound", message: "Not found." }] }) : PAD_THAI) },
    });
    renderAt(`/recipes/${ID}`);
    await screen.findByRole("heading", { level: 1, name: "Pad Thai" });
    trashed = true;
    await userEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Recipe not found" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
  });

  it("shows the load error, not the cached copy, when the reload fails", async () => {
    let failing = false;
    mockRecipeApi({ recipes: { [ID]: () => (failing ? jsonResponse(500, { errors: [] }) : PAD_THAI) } });
    renderAt(`/recipes/${ID}`);
    await screen.findByRole("heading", { level: 1, name: "Pad Thai" });
    failing = true;
    await userEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(await screen.findByText("Couldn't load the recipe. Check the connection and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();

    failing = false;
    await userEvent.click(button("Try again"));
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Pad Thai");
  });
});

describe("REC-1, REC-5 leaving while a save is in flight", () => {
  it("can't Cancel, or Discard when leaving some other way, until the save is done", async () => {
    let answer: (response: Response) => void = () => {};
    const { router } = await openEdit({ change: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await userEvent.type(field("Name"), " Jay");
    await save();
    // aria-disabled rather than disabled, so it can still take focus back from the dialog.
    expect(button("Cancel")).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button("Cancel"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);

    await act(() => router.navigate("/"));
    expect(screen.getByRole("alertdialog", { name: "Discard your changes?" })).toBeInTheDocument();
    expect(button("Discard")).toBeDisabled();
    expect(router.state.location.pathname).toBe(`/recipes/${ID}/edit`);
    await userEvent.click(button("Keep editing"));
    expect(button("Cancel")).toHaveFocus();

    await act(() => router.navigate("/"));

    answer(jsonResponse(200, { ...PAD_THAI, name: "Pad Thai Jay" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
  });

  it("never navigates once the form has gone, such as when the session ended during the save", async () => {
    let answer: (response: Response) => void = () => {};
    const { router, queryClient } = await openEdit({ change: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await userEvent.type(field("Name"), " Jay");
    await save();
    act(() => queryClient.setQueryData(ME_QUERY_KEY, VISITOR));
    await screen.findByRole("heading", { level: 1, name: "Sign in to see this" });
    await act(() => router.navigate("/account"));

    answer(jsonResponse(200, { ...PAD_THAI, name: "Pad Thai Jay" }));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(router.state.location.pathname).toBe("/account");
  });
});

describe("REC-7 a replaced or removed photo is shown afresh", () => {
  it("gives the photo a new address after an upload, so the browser doesn't show the old image", async () => {
    let stored = { ...PAD_THAI, hasPhoto: true };
    const { router } = await openEdit({ recipes: { [ID]: () => stored }, change: () => stored }, stored);
    const before = screen.getByRole("img", { name: "Current photo" }).getAttribute("src");
    expect(before).toBe(`${API}/recipes/${ID}/photo`);
    await userEvent.upload(screen.getByLabelText("Replace photo"), jpeg());
    stored = { ...stored };
    await save();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/recipes/${ID}`));
    const after = (await screen.findByRole("img", { name: "Pad Thai photo" })).getAttribute("src");
    expect(after).not.toBe(before);
    expect(after?.startsWith(`${API}/recipes/${ID}/photo?`)).toBe(true);
  });
});

describe("REC-10 a tag typed but not added", () => {
  it("is added on Save rather than lost", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.click(button("+ Tag"));
    await userEvent.type(field("Add a tag"), "spicy");
    await save();
    await waitFor(() => expect(changes(fetchMock)).toHaveLength(1));
    expect(changes(fetchMock)[0]?.body).toMatchObject({ tags: ["dinner", "noodles", "spicy"] });
  });

  it("counts as an unsaved change", async () => {
    await openEdit();
    await userEvent.click(button("+ Tag"));
    await userEvent.type(field("Add a tag"), "spicy");
    await userEvent.click(button("Cancel"));
    expect(screen.getByRole("alertdialog", { name: "Discard your changes?" })).toBeInTheDocument();
  });

  it("ties a refused tag's message to the tag field", async () => {
    await openEdit({ change: () => refused(400, "tag.comma", "A tag can't contain a comma. Add each tag separately.", "tags[2]") });
    await userEvent.click(button("+ Tag"));
    await userEvent.type(field("Add a tag"), "a, b{Enter}");
    await save();
    await screen.findByText("Not saved. Fix the field marked below.");
    expect(field("Add a tag")).toHaveAccessibleDescription("“a, b”: A tag can't contain a comma. Add each tag separately.");
  });
});

describe("REC-1 total time can't be negative", () => {
  it("refuses a negative part rather than netting it off, describing the error on each field", async () => {
    const { fetchMock } = await openEdit({ change: () => PAD_THAI });
    await userEvent.clear(field("hours"));
    await userEvent.type(field("hours"), "-1");
    await save();
    await screen.findByText("Not saved. Fix the field marked below.");
    expect(field("hours")).toHaveAccessibleDescription("Hours and minutes can't be negative.");
    expect(field("minutes")).toHaveAccessibleDescription("Hours and minutes can't be negative.");
    expect(changes(fetchMock)).toEqual([]);
  });
});
