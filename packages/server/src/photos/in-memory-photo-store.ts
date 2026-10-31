import type { Instant } from "@recipebox/domain";
import { type Clock, systemClock } from "../clock.js";
import type { PhotoStore, StoredImage, StoredImageInfo } from "./photo-store.js";

/**
 * A `PhotoStore` for fast tests. It keeps copies of the bytes, so, as with Blob Storage, changing a buffer after storing it or
 * after reading it leaves the stored image unchanged. An image's last-modified time is read from `clock` when it is stored, so
 * tests can control how old an image is.
 */
export class InMemoryPhotoStore implements PhotoStore {
  private readonly images = new Map<string, StoredImage & { lastModified: Instant }>();

  constructor(private readonly clock: Clock = systemClock) {}

  async put(name: string, bytes: Buffer, contentType: string): Promise<void> {
    this.images.set(name, { bytes: Buffer.from(bytes), contentType, lastModified: this.clock() });
  }

  async get(name: string): Promise<StoredImage | undefined> {
    const image = this.images.get(name);
    return image === undefined ? undefined : { bytes: Buffer.from(image.bytes), contentType: image.contentType };
  }

  async delete(name: string): Promise<void> {
    this.images.delete(name);
  }

  async list(): Promise<StoredImageInfo[]> {
    return [...this.images].map(([name, image]) => ({ name, lastModified: image.lastModified }));
  }

  /** Every stored name, sorted; for tests that check which images exist. */
  names(): string[] {
    return [...this.images.keys()].sort();
  }
}
