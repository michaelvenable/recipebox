import { describe, expect, it } from "vitest";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
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
