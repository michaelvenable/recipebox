import { randomBytes, randomUUID } from "node:crypto";
import { Instant, RecipeId, ShareToken } from "@recipebox/domain";

/**
 * The server's clock (X-12): the only source of every stored time. Passed into the app so tests can set the time; the domain
 * never reads a clock and no request field is ever used as a time.
 */
export type Clock = () => Instant;

/** Creates the id for a new recipe. Passed into the app so tests can control ids. */
export type RecipeIdGenerator = () => RecipeId;

export const systemClock: Clock = () => {
  const now = Instant.fromEpochMillis(Date.now());
  if (!now.ok) throw new Error(`The system clock returned an invalid time: ${Date.now()}`);
  return now.value;
};

export const randomRecipeId: RecipeIdGenerator = () => {
  const id = RecipeId.create(randomUUID());
  if (!id.ok) throw new Error("crypto.randomUUID returned something that is not a UUID");
  return id.value;
};

/** Creates the random code of a new shopping list link (PLAN-9). Passed into the app so tests can control codes. */
export type ShareTokenGenerator = () => ShareToken;

/** Random bytes in a link code: 128 bits from the operating system's secure source, so it can't be guessed (PLAN-9). */
export const SHARE_TOKEN_BYTES = 16;

export const randomShareToken: ShareTokenGenerator = () => {
  const token = ShareToken.create(randomBytes(SHARE_TOKEN_BYTES).toString("base64url"));
  if (!token.ok) throw new Error("crypto.randomBytes gave a link code the domain refuses");
  return token.value;
};
