import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { ImportId, type RecipeImport } from "@recipebox/domain";
import type { AppDependencies } from "../../src/app.js";
import { InMemoryImportQueue } from "../../src/imports/in-memory-import-queue.js";
import { InMemoryImportRepository } from "../../src/imports/in-memory-import-repository.js";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import { appWith } from "../app-helpers.js";
import { type FilePart, multipartBody, UPLOAD_HEADERS } from "../photos/photo-route-helpers.js";
import { AS_EDITOR, sequentialIds, TestClock } from "../recipes/recipe-route-helpers.js";

/** An import repository whose writes can be made to fail, as when Cosmos DB is unreachable, and which counts reads. */
export class TestImportRepository extends InMemoryImportRepository {
  reads = 0;
  failAdds = false;
  failSaves = false;

  override async list(): Promise<RecipeImport[]> {
    this.reads += 1;
    return super.list();
  }

  override async add(recipeImport: RecipeImport): Promise<void> {
    if (this.failAdds) throw new Error("Cosmos DB is unavailable");
    return super.add(recipeImport);
  }

  override async save(recipeImport: RecipeImport): Promise<void> {
    if (this.failSaves) throw new Error("Cosmos DB is unavailable");
    return super.save(recipeImport);
  }
}

/** A photo store whose writes can be made to fail: all of them, or every one after the first `putsBeforeFailure`. */
export class TestPhotoStore extends InMemoryPhotoStore {
  failPuts = false;
  putsBeforeFailure: number | undefined;
  puts = 0;

  override async put(name: string, bytes: Buffer, contentType: string): Promise<void> {
    this.puts += 1;
    if (this.failPuts || (this.putsBeforeFailure !== undefined && this.puts > this.putsBeforeFailure)) {
      throw new Error("Blob Storage is unavailable");
    }
    return super.put(name, bytes, contentType);
  }
}

export interface ImportTestApp {
  app: FastifyInstance;
  imports: TestImportRepository;
  queue: InMemoryImportQueue;
  photos: TestPhotoStore;
  recipes: InMemoryRecipeRepository;
  clock: TestClock;
}

export function importId(text: string): ImportId {
  const id = ImportId.create(text);
  if (!id.ok) throw new Error(`Not an import id: ${text}`);
  return id.value;
}

/** The ids the app gives imports, in order of creation: 00000000-0000-4000-9000-000000000001, …002, … */
export const IMPORT_IDS = [1, 2, 3, 4].map((n) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`);
export const [FIRST_IMPORT_ID, SECOND_IMPORT_ID, THIRD_IMPORT_ID] = IMPORT_IDS as [string, string, string];

function sequentialImportIds(): () => ImportId {
  let n = 0;
  return () => importId(`00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`);
}

export async function importApp(
  now = "2026-11-07T09:00:00.000Z",
  photoProcessing: AppDependencies["photoProcessing"] = {},
): Promise<ImportTestApp> {
  const imports = new TestImportRepository();
  const queue = new InMemoryImportQueue();
  const clock = new TestClock(now);
  const photos = new TestPhotoStore(clock.now);
  const recipes = new InMemoryRecipeRepository();
  const app = await appWith({}, false, {
    recipes,
    imports,
    importQueue: queue,
    photos,
    clock: clock.now,
    newRecipeId: sequentialIds(),
    newImportId: sequentialImportIds(),
    photoProcessing,
  });
  return { app, imports, queue, photos, recipes, clock };
}

/** How the client sends an upload: as an editor, with X-Requested-By (docs/api.md, "Conventions"). */
export const AS_EDITOR_UPLOADING = { ...AS_EDITOR, ...UPLOAD_HEADERS };

/**
 * POST /imports with one file, or several in order, as the app sends them (each as a `photo` part, unless a FilePart names
 * another field), unless `headers` says otherwise.
 */
export function startImport(
  app: FastifyInstance,
  files: FilePart | Buffer | readonly (FilePart | Buffer)[],
  headers: Record<string, string> = AS_EDITOR_UPLOADING,
): Promise<LightMyRequestResponse> {
  const list = Array.isArray(files) ? files : [files as FilePart | Buffer];
  const { payload, contentType } = multipartBody(list.map((file) => (Buffer.isBuffer(file) ? { bytes: file } : file)));
  return startImportBody(app, payload, contentType, headers);
}

export function startImportBody(
  app: FastifyInstance,
  payload: Buffer,
  contentType: string,
  headers: Record<string, string> = AS_EDITOR_UPLOADING,
): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: "/imports", headers: { ...headers, "content-type": contentType }, payload });
}

/** Everything an import can leave behind: the records, the stored images and the queued messages. */
export function storedState(setup: ImportTestApp): unknown {
  return { records: setup.imports.documentsStored(), images: setup.photos.names(), messages: setup.queue.messages() };
}

export const NOTHING_STORED = { records: [], images: [], messages: [] };
