/** An image as stored: its bytes and the content type it is served with. */
export interface StoredImage {
  bytes: Buffer;
  contentType: string;
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
}
