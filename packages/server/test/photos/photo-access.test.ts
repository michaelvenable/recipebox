// Who may change photos (X-6) and how uploads may be sent (CSRF, docs/architecture.md "Sign-in"), for the photo endpoints.
import { describe, expect, it } from "vitest";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  expectErrors,
  seed,
  storedSnapshots,
} from "../recipes/recipe-route-helpers.js";
import { multipartBody, photoApp, type PhotoTestApp, uploadBody, uploadPhoto } from "./photo-route-helpers.js";
import { jpeg, paddedJpeg } from "./test-images.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";

/** A recipe with a photo and a trashed recipe with a photo; lookups are counted from zero afterwards. */
async function appWithPhotos(): Promise<PhotoTestApp & { id: string; trashedId: string }> {
  const setup = await photoApp();
  const live = await seed(setup.repository, content("Pad Thai"));
  const trashed = await seed(setup.repository, content("Trashed Curry"));
  for (const id of [live.id.value, trashed.id.value]) {
    expect((await uploadPhoto(setup.app, id, await jpeg())).statusCode).toBe(200);
  }
  expect((await change(setup.app, "DELETE", `/recipes/${trashed.id.value}`)).statusCode).toBe(204);
  setup.repository.lookups = 0;
  return { ...setup, id: live.id.value, trashedId: trashed.id.value };
}

async function stateOf(setup: PhotoTestApp): Promise<unknown> {
  return { recipes: await storedSnapshots(setup.repository), images: setup.photos.names() };
}

describe("X-6 only editors change photos", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} an upload, before reading the file or looking up the recipe, for any id`, async () => {
      const setup = await appWithPhotos();
      const before = await stateOf(setup);
      const answers = new Set<string>();

      for (const id of [setup.id, setup.trashedId, UNKNOWN_ID]) {
        for (const file of [await jpeg(), paddedJpeg(await jpeg(), 20 * 1024 * 1024)]) {
          const res = await uploadPhoto(setup.app, id, file, as);
          expectErrors(res, status, [code]);
          answers.add(res.body);
        }
      }

      expect(answers.size).toBe(1);
      expect(setup.repository.lookups).toBe(0);
      expect(await stateOf(setup)).toEqual(before);
    });

    it(`refuses ${who} removal, before looking up the recipe, for any id`, async () => {
      const setup = await appWithPhotos();
      const before = await stateOf(setup);
      const answers = new Set<string>();

      for (const id of [setup.id, setup.trashedId, UNKNOWN_ID]) {
        const res = await change(setup.app, "DELETE", `/recipes/${id}/photo`, {}, as);
        expectErrors(res, status, [code]);
        answers.add(res.body);
      }

      expect(answers.size).toBe(1);
      expect(setup.repository.lookups).toBe(0);
      expect(await stateOf(setup)).toEqual(before);
    });
  }
});

describe('architecture "Sign-in": multipart/form-data only on PUT /recipes/{id}/photo', () => {
  it.each([
    ["DELETE", "/recipes/{id}/photo"],
    ["POST", "/recipes"],
    ["POST", "/recipes/{id}/tags"],
    ["DELETE", "/recipes/{id}"],
    ["POST", "/recipes/{id}/cookings"],
    ["POST", "/trash/{id}/restore"],
    ["PUT", "/recipes/{id}/content"],
    ["POST", "/recipes/{id}/add-to-plan"],
    ["POST", "/recipes/{id}/remove-from-plan"],
  ] as const)("refuses multipart/form-data on %s %s with 415, changing nothing", async (method, path) => {
    const setup = await appWithPhotos();
    const before = await stateOf(setup);
    const { payload, contentType } = multipartBody([{ bytes: await jpeg() }]);

    const res = await setup.app.inject({
      method,
      url: path.replace("{id}", setup.id),
      headers: { ...AS_EDITOR, "content-type": contentType },
      payload,
    });

    expectErrors(res, 415, ["request.unsupportedMediaType"]);
    expect(await stateOf(setup)).toEqual(before);
  });

  it.each(["application/x-www-form-urlencoded", "text/plain"])(
    "refuses an upload sent as %s, which a form on another site could send",
    async (contentType) => {
      const setup = await appWithPhotos();
      const before = await stateOf(setup);
      const res = await uploadBody(setup.app, setup.id, await jpeg(), contentType);
      expectErrors(res, 415, ["request.unsupportedMediaType"]);
      expect(await stateOf(setup)).toEqual(before);
    },
  );
});
