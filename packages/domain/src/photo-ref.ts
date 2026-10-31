import { domainError, type DomainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";

/** Where a recipe's photo is stored. The domain never sees image bytes (REC-7). */
export class PhotoRef {
  private constructor(
    private readonly blob: string,
    private readonly type: string,
  ) {
    Object.freeze(this);
  }

  static create(input: { blobName: string; contentType: string }): Result<PhotoRef> {
    const errors: DomainError[] = [];
    if (input.blobName.trim().length === 0) {
      errors.push(domainError("photo.blobNameRequired", "A photo blob name is required.", "photo.blobName"));
    }
    if (input.contentType.trim().length === 0) {
      errors.push(domainError("photo.contentTypeRequired", "A photo content type is required.", "photo.contentType"));
    }
    return errors.length > 0 ? fail(errors) : ok(new PhotoRef(input.blobName, input.contentType));
  }

  get blobName(): string {
    return this.blob;
  }

  get contentType(): string {
    return this.type;
  }

  equals(other: PhotoRef): boolean {
    return this.blob === other.blob && this.type === other.type;
  }
}
