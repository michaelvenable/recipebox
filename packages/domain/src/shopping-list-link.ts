import { domainError, type DomainError } from "./errors.js";
import type { ShoppingItem } from "./finding.js";
import { Instant } from "./instant.js";
import { fail, ok, type Result } from "./result.js";

/** How long a sent shopping list link works (PLAN-9). Fixed; changing it is out of scope. */
export const LINK_DAYS = 7;

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

/**
 * The stored Cosmos document (domain-model.md, "Shopping list link snapshot"). PLAN-9: only the link's code and when it was
 * made are stored, nothing of the list.
 */
export interface ShoppingListLinkSnapshot {
  /** The token; also the document id. */
  id: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * A sent shopping list link (PLAN-9). It is live: it holds no lines, and whoever opens it sees the current shopping list
 * (`shoppingList`, PLAN-8), so the link itself is only a code and a time. It works for 7 days after `createdAt`, by the
 * server's clock (X-12).
 */
export class ShoppingListLink {
  private constructor(
    private readonly shareToken: ShareToken,
    private readonly created: Instant,
  ) {
    Object.freeze(this);
  }

  /**
   * A new link. `items` is the shopping list at this moment (`shoppingList`); only whether it is empty matters: an empty plan
   * has nothing to send (`shoppingList.empty`). The lines are not kept. `at` is the server's current time (X-12).
   */
  static create(token: ShareToken, items: readonly ShoppingItem[], at: Instant): Result<ShoppingListLink> {
    if (items.length === 0) {
      return fail(domainError("shoppingList.empty", "The plan is empty, so there's no shopping list to send."));
    }
    return ok(new ShoppingListLink(token, at));
  }

  get token(): ShareToken {
    return this.shareToken;
  }

  get createdAt(): Instant {
    return this.created;
  }

  /** `createdAt` + 7 days. Derived, never stored, so it can't drift from `createdAt`. */
  get expiresAt(): Instant {
    return this.created.plusDays(LINK_DAYS);
  }

  /** PLAN-9: the link works while `now` (the server's clock, X-12) is before `expiresAt`; at or after it, it has expired. */
  isAvailable(now: Instant): boolean {
    return now.isBefore(this.expiresAt);
  }

  toSnapshot(): ShoppingListLinkSnapshot {
    return { id: this.shareToken.value, createdAt: this.created.toIso() };
  }

  /**
   * Rebuilds a link from its stored document, re-validating through the value objects. Throws on invalid data: bad data in the
   * database is a bug, not user input (domain-model.md). The stored document must be exactly the snapshot.
   */
  static fromSnapshot(s: ShoppingListLinkSnapshot): ShoppingListLink {
    const keys = Object.keys(s).sort();
    if (keys.length !== 2 || keys[0] !== "createdAt" || keys[1] !== "id") {
      throw invalidSnapshot(`unexpected fields ${JSON.stringify(keys)}`);
    }
    const token = orThrow("id", ShareToken.create(s.id));
    const created = orThrow("createdAt", Instant.fromIso(s.createdAt));
    if (created.toIso() !== s.createdAt) throw invalidSnapshot("createdAt is not in its canonical form");
    return new ShoppingListLink(token, created);
  }
}

function orThrow<T>(part: string, result: Result<T>): T {
  if (!result.ok) throw invalidSnapshot(`invalid ${part}: ${describe(result.errors)}`);
  return result.value;
}

function describe(errors: readonly DomainError[]): string {
  return errors.map((e) => e.code).join(", ");
}

// The token is left out of the message: it is the link's password, and errors are logged.
function invalidSnapshot(reason: string): Error {
  return new Error(`Invalid stored shopping list link: ${reason}`);
}
