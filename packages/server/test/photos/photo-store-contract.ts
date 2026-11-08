import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { PhotoStore } from "../../src/photos/photo-store.js";

/**
 * Behavior every `PhotoStore` must have, run against each implementation. `createStore` is called before each test and must
 * return a store in which the names the tests use hold nothing.
 */
export function photoStoreContract(name: string, createStore: () => Promise<PhotoStore>): void {
  describe(`${name} (PhotoStore contract)`, () => {
    let store: PhotoStore;

    beforeEach(async () => {
      store = await createStore();
    });

    /** A name like the ones the photo routes use, unique per test. */
    function photoName(): string {
      return `photos/${randomUUID()}/${randomUUID()}.jpg`;
    }

    it("returns the stored bytes and content type", async () => {
      const name = photoName();
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0xfe]);
      await store.put(name, bytes, "image/jpeg");

      const stored = await store.get(name);

      expect(stored?.contentType).toBe("image/jpeg");
      expect(stored?.bytes.equals(bytes)).toBe(true);
    });

    it("returns undefined for a name that holds nothing", async () => {
      await store.put(photoName(), Buffer.from("x"), "image/jpeg");
      expect(await store.get(photoName())).toBeUndefined();
    });

    it("keeps images under different names apart", async () => {
      const photo = photoName();
      const thumbnail = photo.replace(/\.jpg$/, ".thumbnail.jpg");
      await store.put(photo, Buffer.from("photo"), "image/jpeg");
      await store.put(thumbnail, Buffer.from("thumbnail"), "image/webp");

      expect((await store.get(photo))?.bytes.toString()).toBe("photo");
      expect(await store.get(thumbnail)).toEqual({ bytes: Buffer.from("thumbnail"), contentType: "image/webp" });
    });

    it("replaces the image when a name is stored again", async () => {
      const name = photoName();
      await store.put(name, Buffer.from("first"), "image/png");
      await store.put(name, Buffer.from("second"), "image/jpeg");

      expect(await store.get(name)).toEqual({ bytes: Buffer.from("second"), contentType: "image/jpeg" });
    });

    it("deletes an image, leaving others", async () => {
      const kept = photoName();
      const deleted = photoName();
      await store.put(kept, Buffer.from("kept"), "image/jpeg");
      await store.put(deleted, Buffer.from("deleted"), "image/jpeg");

      await store.delete(deleted);

      expect(await store.get(deleted)).toBeUndefined();
      expect((await store.get(kept))?.bytes.toString()).toBe("kept");
    });

    it("treats deleting a name that holds nothing as done, not as an error", async () => {
      const name = photoName();
      await expect(store.delete(name)).resolves.toBeUndefined();
      await store.put(name, Buffer.from("x"), "image/jpeg");
      await store.delete(name);
      await expect(store.delete(name)).resolves.toBeUndefined();
    });

    // The store's last-modified times come from its own clock (Blob Storage's, at whole seconds); this only checks that they
    // are close to now.
    const CLOCK_TOLERANCE_MS = 60_000;

    it("lists stored images by full name with their last-modified time", async () => {
      const photo = photoName();
      const thumbnail = photo.replace(/\.jpg$/, ".thumbnail.jpg");
      const before = Date.now();
      await store.put(photo, Buffer.from("photo"), "image/jpeg");
      await store.put(thumbnail, Buffer.from("thumbnail"), "image/jpeg");
      const after = Date.now();

      const listed = (await store.list()).filter((image) => image.name === photo || image.name === thumbnail);

      expect(listed.map((image) => image.name).sort()).toEqual([photo, thumbnail].sort());
      for (const image of listed) {
        expect(image.lastModified.epochMillis).toBeGreaterThanOrEqual(before - CLOCK_TOLERANCE_MS);
        expect(image.lastModified.epochMillis).toBeLessThanOrEqual(after + CLOCK_TOLERANCE_MS);
      }
    });

    it("lists only the images whose name starts with a prefix, when one is given", async () => {
      const folder = `imports/${randomUUID()}/`;
      const inside = [`${folder}1.jpg`, `${folder}2.jpg`];
      const outside = [photoName(), `imports/${randomUUID()}/1.jpg`, `${folder.slice(0, -1)}.jpg`];
      for (const name of [...inside, ...outside]) await store.put(name, Buffer.from(name), "image/jpeg");

      const names = (await store.list(folder)).map((image) => image.name);

      expect(names.sort()).toEqual(inside);
    });

    it("doesn't list deleted images", async () => {
      const kept = photoName();
      const deleted = photoName();
      await store.put(kept, Buffer.from("kept"), "image/jpeg");
      await store.put(deleted, Buffer.from("deleted"), "image/jpeg");

      await store.delete(deleted);

      const names = (await store.list()).map((image) => image.name);
      expect(names).toContain(kept);
      expect(names).not.toContain(deleted);
    });

    it("stores larger images intact", async () => {
      const name = photoName();
      const bytes = Buffer.alloc(3 * 1024 * 1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
      await store.put(name, bytes, "image/jpeg");

      expect((await store.get(name))?.bytes.equals(bytes)).toBe(true);
    });
  });
}
