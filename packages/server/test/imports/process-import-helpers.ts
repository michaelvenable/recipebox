import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { pino } from "pino";
import { ImportId, Recipe, RecipeImport } from "@recipebox/domain";
import { importPageName } from "../../src/imports/import-page-name.js";
import { InMemoryImportRepository } from "../../src/imports/in-memory-import-repository.js";
import {
  type ImportOutcome,
  type ImportProcessingDependencies,
  processImport,
} from "../../src/imports/process-import.js";
import type { RecipeReader } from "../../src/imports/recipe-reader.js";
import { InMemoryPhotoStore } from "../../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import { instant } from "../app-helpers.js";
import { jpeg } from "../photos/test-images.js";
import { content, recipeId, TestClock } from "../recipes/recipe-route-helpers.js";

/** When the import under test started. Its 10 minutes end at 09:10:00 (IMP-11). */
export const STARTED = "2026-11-07T09:00:00.000Z";

/** One call the job made to the reading service. */
export interface ReaderCall {
  image: Buffer;
  allowedTags: readonly string[];
  signal: AbortSignal;
}

/** A reading service under the test's control: answers with `answer`, which may throw, hang or return any text. */
export class FakeReader implements RecipeReader {
  readonly calls: ReaderCall[] = [];

  constructor(public answer: (call: ReaderCall) => Promise<string>) {}

  read(image: Buffer, allowedTags: readonly string[], signal: AbortSignal): Promise<string> {
    const call = { image, allowedTags, signal };
    this.calls.push(call);
    return this.answer(call);
  }
}

/** A well-formed answer for a recipe (the schema's shape, reading-prompt.ts), with `overrides`. */
export function answer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    found: true,
    name: "Banana Bread",
    ingredients: ["3 ripe bananas", "1/3 cup melted butter"],
    prep: [],
    steps: ["Mash the bananas.", "Bake for 60 minutes."],
    totalTimeMinutes: 75,
    tags: [],
    dishPhoto: null,
    ...overrides,
  });
}

/** A log line as pino writes it. */
export type LogLine = Record<string, unknown> & { level: number; msg?: string };

/** pino's level numbers. */
export const LEVEL = { info: 30, warn: 40, error: 50 } as const;

/** Everything the job uses, in memory, with a real pino logger whose lines are kept. */
export class ImportJobFixture {
  readonly imports = new InMemoryImportRepository();
  readonly recipes = new InMemoryRecipeRepository();
  readonly clock = new TestClock(STARTED);
  readonly photos = new InMemoryPhotoStore(this.clock.now);
  readonly reader = new FakeReader(async () => answer());
  readonly lines: LogLine[] = [];
  readonly logger = pino(
    { base: null },
    new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        for (const text of chunk.toString("utf8").split("\n")) if (text !== "") this.lines.push(JSON.parse(text) as LogLine);
        done();
      },
    }),
  );

  dependencies(overrides: Partial<ImportProcessingDependencies> = {}): ImportProcessingDependencies {
    return {
      imports: this.imports,
      recipes: this.recipes,
      photos: this.photos,
      reader: this.reader,
      clock: this.clock.now,
      logger: this.logger,
      ...overrides,
    };
  }

  /** Starts an import at STARTED, as POST /imports does: its page photo, then its record. */
  async startImport(page?: Buffer): Promise<ImportId> {
    const created = ImportId.create(randomUUID());
    if (!created.ok) throw new Error("not a UUID");
    const id = created.value;
    await this.photos.put(importPageName(id), page ?? (await jpeg()), "image/jpeg");
    await this.imports.add(RecipeImport.start(id, instant(STARTED)));
    return id;
  }

  process(id: ImportId, overrides: Partial<ImportProcessingDependencies> = {}): Promise<ImportOutcome> {
    return processImport(id, this.dependencies(overrides));
  }

  async record(id: ImportId): Promise<RecipeImport> {
    const stored = await this.imports.get(id);
    if (stored === undefined) throw new Error("no record");
    return stored;
  }

  /** Lines at level error. */
  errors(): LogLine[] {
    return this.lines.filter((line) => line.level >= LEVEL.error);
  }

  /** The `recipe-import-failed` lines (IMP-11). */
  failures(): LogLine[] {
    return this.lines.filter((line) => line.event === "recipe-import-failed");
  }

  /** Stores a recipe with `tags`, deleted if `trashed`. */
  async storeRecipe(name: string, tags: string[] = [], trashed = false): Promise<Recipe> {
    const created = Recipe.create(recipeId(randomUUID()), content(name, { tags }));
    if (!created.ok) throw new Error("invalid recipe");
    if (trashed) created.value.delete(instant(STARTED));
    await this.recipes.save(created.value);
    return created.value;
  }
}
