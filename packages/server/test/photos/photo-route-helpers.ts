import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Recipe, RecipeId } from "@recipebox/domain";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import type { AppDependencies } from "../../src/app.js";
import { appWith } from "../app-helpers.js";
import { AS_EDITOR, sequentialIds, TestClock } from "../recipes/recipe-route-helpers.js";

/** A repository whose saves can be made to fail, as when Cosmos DB is unreachable, and which counts lookups. */
export class TestRecipeRepository extends InMemoryRecipeRepository {
  failSaves = false;
  lookups = 0;

  override async get(id: RecipeId): Promise<Recipe | undefined> {
    this.lookups += 1;
    return super.get(id);
  }

  override async save(recipe: Recipe): Promise<void> {
    if (this.failSaves) throw new Error("Cosmos DB is unavailable");
    return super.save(recipe);
  }
}

export interface PhotoTestApp {
  app: FastifyInstance;
  repository: TestRecipeRepository;
  photos: InMemoryPhotoStore;
  clock: TestClock;
}

export async function photoApp(
  now = "2026-10-01T09:00:00.000Z",
  photoProcessing: AppDependencies["photoProcessing"] = {},
): Promise<PhotoTestApp> {
  const repository = new TestRecipeRepository();
  const photos = new InMemoryPhotoStore();
  const clock = new TestClock(now);
  const app = await appWith({}, false, {
    recipes: repository,
    photos,
    clock: clock.now,
    newRecipeId: sequentialIds(),
    photoProcessing,
  });
  return { app, repository, photos, clock };
}

export interface FilePart {
  field?: string;
  filename?: string;
  contentType?: string;
  bytes: Buffer;
}

/** A multipart/form-data body, as a browser's FormData would send it. Text fields are given as strings. */
export function multipartBody(parts: readonly (FilePart | { field: string; value: string })[]): {
  payload: Buffer;
  contentType: string;
} {
  const boundary = `----RecipeBoxTest${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("value" in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.field}"\r\n\r\n${part.value}\r\n`));
      continue;
    }
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.field ?? "photo"}"; filename="${part.filename ?? "photo.jpg"}"\r\n` +
          `Content-Type: ${part.contentType ?? "image/jpeg"}\r\n\r\n`,
      ),
    );
    chunks.push(part.bytes, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** PUT /recipes/{id}/photo with one file, as an editor unless `as` says otherwise. */
export function uploadPhoto(
  app: FastifyInstance,
  id: string,
  file: FilePart | Buffer,
  as: Record<string, string> = AS_EDITOR,
): Promise<LightMyRequestResponse> {
  const { payload, contentType } = multipartBody([Buffer.isBuffer(file) ? { bytes: file } : file]);
  return uploadBody(app, id, payload, contentType, as);
}

export function uploadBody(
  app: FastifyInstance,
  id: string,
  payload: Buffer,
  contentType: string,
  as: Record<string, string> = AS_EDITOR,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "PUT",
    url: `/recipes/${id}/photo`,
    headers: { ...as, "content-type": contentType },
    payload,
  });
}
