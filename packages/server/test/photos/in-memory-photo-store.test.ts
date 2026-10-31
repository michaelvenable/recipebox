import { describe, expect, it } from "vitest";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
import { TestClock } from "../recipes/recipe-route-helpers.js";
import { photoStoreContract } from "./photo-store-contract.js";

photoStoreContract("InMemoryPhotoStore", async () => new InMemoryPhotoStore());

describe("InMemoryPhotoStore copies", () => {
  it("keeps the stored image unchanged when a buffer given to or returned by it is changed", async () => {
    const store = new InMemoryPhotoStore();
    const bytes = Buffer.from("photo");
    await store.put("a.jpg", bytes, "image/jpeg");
    bytes.write("XXXXX");
    const read = await store.get("a.jpg");
    read!.bytes.write("YYYYY");

    expect((await store.get("a.jpg"))?.bytes.toString()).toBe("photo");
  });
});

describe("InMemoryPhotoStore last-modified times", () => {
  it("takes them from its clock when an image is stored, and again when it is stored again", async () => {
    const clock = new TestClock("2026-10-01T09:00:00.000Z");
    const store = new InMemoryPhotoStore(clock.now);
    await store.put("a.jpg", Buffer.from("a"), "image/jpeg");
    clock.set("2026-10-02T10:00:00.000Z");
    await store.put("b.jpg", Buffer.from("b"), "image/jpeg");
    clock.set("2026-10-03T11:00:00.000Z");
    await store.put("b.jpg", Buffer.from("b2"), "image/jpeg");

    const listed = (await store.list()).map((image) => [image.name, image.lastModified.toIso()]).sort();

    expect(listed).toEqual([
      ["a.jpg", "2026-10-01T09:00:00.000Z"],
      ["b.jpg", "2026-10-03T11:00:00.000Z"],
    ]);
  });
});
