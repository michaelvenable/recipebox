// PLAN-9: "Only the link's code and when it was made are stored, and they are permanently removed within one day after the
// link stops working." Cosmos DB removes each document by its time to live, counted in seconds from when it was written,
// which is when the link was made (cosmos-shared-list-repository.ts).
import { describe, expect, it } from "vitest";
import { REMOVAL_MARGIN_SECONDS, sharedListDocument } from "../../src/shopping-lists/cosmos-shared-list-repository.js";
import { madeLink } from "./shared-list-repository-contract.js";

const DAY_SECONDS = 24 * 60 * 60;

describe("PLAN-9 a link's document holds only its code, when it was made and its time to live", () => {
  it("is exactly { id, createdAt, ttl }, with nothing of the list", () => {
    const link = madeLink("2026-11-07T09:00:00Z");
    expect(sharedListDocument(link)).toStrictEqual({
      id: link.token.value,
      createdAt: "2026-11-07T09:00:00.000Z",
      ttl: 7 * DAY_SECONDS + REMOVAL_MARGIN_SECONDS,
    });
    expect(JSON.stringify(sharedListDocument(link))).not.toMatch(/eggs|tomatoes|Shakshuka/);
  });
});

describe("PLAN-9 a link is permanently removed within one day after it expires", () => {
  it("is never removed before it stops working, and always within a day after", () => {
    expect(REMOVAL_MARGIN_SECONDS).toBeGreaterThan(0);
    expect(REMOVAL_MARGIN_SECONDS).toBeLessThan(DAY_SECONDS);
    const link = madeLink("2026-11-07T09:00:00.123Z");
    const { ttl } = sharedListDocument(link);
    expect(Number.isInteger(ttl)).toBe(true);
    const removedAt = link.createdAt.epochMillis + ttl * 1000;
    expect(removedAt).toBeGreaterThan(link.expiresAt.epochMillis);
    expect(removedAt).toBeLessThan(link.expiresAt.epochMillis + DAY_SECONDS * 1000);
  });
});
