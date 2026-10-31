import type { PhotoStore, StoredImage } from "./photo-store.js";

/**
 * A `PhotoStore` for fast tests. It keeps copies of the bytes, so, as with Blob Storage, changing a buffer after storing it or
 * after reading it leaves the stored image unchanged.
 */
export class InMemoryPhotoStore implements PhotoStore {
  private readonly images = new Map<string, StoredImage>();

  async put(name: string, bytes: Buffer, contentType: string): Promise<void> {
    this.images.set(name, { bytes: Buffer.from(bytes), contentType });
  }

  async get(name: string): Promise<StoredImage | undefined> {
    const image = this.images.get(name);
    return image === undefined ? undefined : { bytes: Buffer.from(image.bytes), contentType: image.contentType };
  }

  async delete(name: string): Promise<void> {
    this.images.delete(name);
  }

  /** Every stored name, sorted; for tests that check which images exist. */
  names(): string[] {
    return [...this.images.keys()].sort();
  }
}
