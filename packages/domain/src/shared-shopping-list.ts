import { domainError, type DomainError } from "./errors.js";
import type { ShoppingItem } from "./finding.js";
import { Instant } from "./instant.js";
import { RecipeId } from "./recipe-id.js";
import { RecipeName } from "./recipe-name.js";
import { fail, ok, type Result } from "./result.js";
import { TextEntry } from "./text-entry.js";

/** How long a sent shopping list link works (PLAN-9). Fixed; changing it is out of scope. */
export const SHARED_LIST_DAYS = 7;

// base64url, at least 22 characters: 22 × 6 = 132 bits, so a token made from 128 random bits or more (PLAN-9: "can't be
// guessed"). The upper bound only keeps an absurd address from reaching storage.
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * The random code in a shopping list link (PLAN-9). Made by the server from a secure random source; the domain has no
 * randomness, so like `RecipeId` it is created outside and only checked here.
 */
export class ShareToken {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<ShareToken> {
    if (!TOKEN.test(raw)) {
      return fail(domainError("shareToken.invalid", "A link code must be at least 22 base64url characters."));
    }
    return ok(new ShareToken(raw));
  }

  get value(): string {
    return this.text;
  }

  equals(other: ShareToken): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}

/** One line of a sent shopping list: the ingredient as entered and the recipe it came from, copied when it was sent. */
export interface SharedShoppingLine {
  readonly text: TextEntry;
  readonly recipeId: RecipeId;
  readonly recipeName: RecipeName;
}

/** The stored Cosmos document (domain-model.md, "Shared shopping list snapshot"). */
export interface SharedShoppingListSnapshot {
  /** The token; also the document id. */
  id: string;
  /** In the order they were sent. */
  items: { text: string; recipeId: string; recipeName: string }[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  schemaVersion: 1;
}

/**
 * A shopping list sent as a link (PLAN-9): a copy of the shopping list (PLAN-8) as it was when sent, so later changes to the
 * to-make list or the recipes don't change it. It holds nothing else: no to-make dates or other private data (X-1). It works
 * for 7 days after `createdAt`, by the server's clock (X-12).
 */
export class SharedShoppingList {
  private constructor(
    private readonly shareToken: ShareToken,
    private readonly lines: readonly SharedShoppingLine[],
    private readonly created: Instant,
  ) {
    Object.freeze(this);
  }

  /**
   * Copies `items` (from `shoppingList`, PLAN-8) in their order. `at` is the server's current time (X-12). Fails with
   * `shoppingList.empty` when there is nothing on it: an empty plan has no list to send.
   */
  static create(token: ShareToken, items: readonly ShoppingItem[], at: Instant): Result<SharedShoppingList> {
    if (items.length === 0) {
      return fail(domainError("shoppingList.empty", "The plan is empty, so there's no shopping list to send."));
    }
    const lines = items.map(
      (item): SharedShoppingLine =>
        Object.freeze({ text: item.ingredient, recipeId: item.recipe.id, recipeName: item.recipe.content.name }),
    );
    return ok(new SharedShoppingList(token, Object.freeze(lines), at));
  }

  get token(): ShareToken {
    return this.shareToken;
  }

  get items(): readonly SharedShoppingLine[] {
    return this.lines;
  }

  get createdAt(): Instant {
    return this.created;
  }

  /** `createdAt` + 7 days. Derived, never stored, so it can't drift from `createdAt`. */
  get expiresAt(): Instant {
    return this.created.plusDays(SHARED_LIST_DAYS);
  }

  /** PLAN-9: the link works while `now` (the server's clock, X-12) is before `expiresAt`; at or after it, it has expired. */
  isAvailable(now: Instant): boolean {
    return now.isBefore(this.expiresAt);
  }

  toSnapshot(): SharedShoppingListSnapshot {
    return {
      id: this.shareToken.value,
      items: this.lines.map((line) => ({
        text: line.text.value,
        recipeId: line.recipeId.value,
        recipeName: line.recipeName.value,
      })),
      createdAt: this.created.toIso(),
      schemaVersion: 1,
    };
  }

  /**
   * Rebuilds a sent list from its stored document, re-validating through the value objects. Throws on invalid data: bad data
   * in the database is a bug, not user input (domain-model.md).
   */
  static fromSnapshot(s: SharedShoppingListSnapshot): SharedShoppingList {
    const schemaVersion: unknown = s.schemaVersion;
    if (schemaVersion !== 1) throw invalidSnapshot(`unsupported schemaVersion ${String(schemaVersion)}`);
    const token = orThrow("id", ShareToken.create(s.id));
    if (!Array.isArray(s.items) || s.items.length === 0) throw invalidSnapshot("items must not be empty");
    const lines = s.items.map((item, i): SharedShoppingLine => {
      const text = orThrow(`items[${i}].text`, TextEntry.create(item.text));
      const recipeId = orThrow(`items[${i}].recipeId`, RecipeId.create(item.recipeId));
      const recipeName = orThrow(`items[${i}].recipeName`, RecipeName.create(item.recipeName));
      // Validating would silently clean up text that was never valid to store, so it must already be in validated form.
      if (text.value !== item.text || recipeId.value !== item.recipeId || recipeName.value !== item.recipeName) {
        throw invalidSnapshot(`items[${i}] is not in its validated form`);
      }
      return Object.freeze({ text, recipeId, recipeName });
    });
    const created = orThrow("createdAt", Instant.fromIso(s.createdAt));
    if (created.toIso() !== s.createdAt) throw invalidSnapshot("createdAt is not in its canonical form");
    return new SharedShoppingList(token, Object.freeze(lines), created);
  }
}

function orThrow<T>(part: string, result: Result<T>): T {
  if (!result.ok) throw invalidSnapshot(`invalid ${part}: ${describe(result.errors)}`);
  return result.value;
}

function describe(errors: readonly DomainError[]): string {
  return errors.map((e) => e.code).join(", ");
}

// The token is left out of the message: it is the list's password, and errors are logged.
function invalidSnapshot(reason: string): Error {
  return new Error(`Invalid stored shared shopping list: ${reason}`);
}
