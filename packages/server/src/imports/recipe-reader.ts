import type { Config } from "../config.js";

/**
 * The reading service: an AI model that reads a recipe from the page photos of one import (IMP-6; docs/architecture.md, "Recipe
 * import"). Behind this interface so tests use a fake and never call Azure. Implementations send READING_INSTRUCTIONS,
 * readingUserMessage and readingSchema (reading-prompt.ts) with every image, in one request, in the order given.
 */
export interface RecipeReader {
  /**
   * The model's raw answer for `images`, 1 to 4 photos of one recipe in the order they were added: the JSON text it returned.
   * It is untrusted and is parsed by the caller (reading-answer.ts). `allowedTags` are the tags in use (IMP-8). Throws if the
   * service fails, with the service's own message (IMP-11), and stops as soon as `signal` is aborted.
   */
  read(images: readonly Buffer[], allowedTags: readonly string[], signal: AbortSignal): Promise<string>;
}

/**
 * A reader for local development, so the whole import flow runs without Azure (docs/architecture.md, "Recipe import"). It
 * doesn't look at the photos: it answers with one fixed recipe, its photo the whole of the first page, tagged with the first
 * tag in use, if any. Like the development sign-in stub it is refused outside development and test, which in turn are refused
 * on Container Apps (config.ts).
 */
export class DevelopmentRecipeReader implements RecipeReader {
  constructor(config: Pick<Config, "local">) {
    if (!config.local) {
      throw new Error("The development recipe reader is for local use only; set APP_ENV=development or APP_ENV=test.");
    }
  }

  async read(_images: readonly Buffer[], allowedTags: readonly string[], signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return JSON.stringify({
      found: true,
      name: "Development Banana Bread",
      ingredients: ["3 ripe bananas", "1/3 cup melted butter", "3/4 cup sugar", "1 egg", "1 1/2 cups flour"],
      prep: [],
      steps: ["Mash the bananas and stir in the butter.", "Mix in the sugar, egg and flour.", "Bake at 350°F for 60 minutes."],
      totalTimeMinutes: 75,
      servings: null, // a loaf: a yield that isn't people sets no servings (IMP-6)
      tags: allowedTags.slice(0, 1),
      dishPhoto: { photo: 1, left: 0, top: 0, width: 1, height: 1 },
    });
  }
}
