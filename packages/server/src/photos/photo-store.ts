import type { Instant } from "@recipebox/domain";

/** An image as stored: its bytes and the content type it is served with. */
export interface StoredImage {
  bytes: Buffer;
  contentType: string;
}

/** A stored image's name and when it was last stored, by the store's own clock. */
export interface StoredImageInfo {
  name: string;
  lastModified: Instant;
}

/**
 * Stores photo images by name (docs/architecture.md, "Photos"): Blob Storage in main.ts, in memory in route tests. Names are
 * chosen by the caller; a recipe's `PhotoRef` holds the name. The store is private: images reach browsers only through the API,
 * which hides those of recipes in the trash (X-1).
 */
export interface PhotoStore {
  /** Stores the image under `name`, replacing any image already stored there. */
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The image stored under `name`, or undefined if there is none. */
  get(name: string): Promise<StoredImage | undefined>;
  /** Deletes the image stored under `name`. Deleting a name that holds nothing does nothing and is not an error. */
  delete(name: string): Promise<void>;
  /**
   * Every stored image's full name with the time it was last stored, in no particular order. The trash cleanup uses it to find
   * images no recipe refers to (docs/architecture.md, "Trash cleanup").
   */
  list(): Promise<StoredImageInfo[]>;
}
