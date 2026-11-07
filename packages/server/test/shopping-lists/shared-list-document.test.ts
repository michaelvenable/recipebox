// PLAN-9: "The list is permanently removed within one day after that." Cosmos DB removes each document by its time to live,
// counted in seconds from when it was written, which is when the list was made (cosmos-shared-list-repository.ts).
import { describe, expect, it } from "vitest";
import { REMOVAL_MARGIN_SECONDS, sharedListDocument } from "../../src/shopping-lists/cosmos-shared-list-repository.js";
import { sentList } from "./shared-list-repository-contract.js";

const DAY_SECONDS = 24 * 60 * 60;

describe("PLAN-9 a sent list is permanently removed within one day after it expires", () => {
  it("stores the snapshot with a time to live of the 7 days plus a margin", () => {
    const list = sentList();
    const { ttl, ...snapshot } = sharedListDocument(list);

    expect(snapshot).toEqual(list.toSnapshot());
    expect(ttl).toBe(7 * DAY_SECONDS + REMOVAL_MARGIN_SECONDS);
    expect(Number.isInteger(ttl)).toBe(true);
  });

  it("is never removed before it stops working, and always within a day after", () => {
    expect(REMOVAL_MARGIN_SECONDS).toBeGreaterThan(0);
    expect(REMOVAL_MARGIN_SECONDS).toBeLessThan(DAY_SECONDS);
    const list = sentList();
    const removedAt = list.createdAt.epochMillis + sharedListDocument(list).ttl * 1000;
    expect(removedAt).toBeGreaterThan(list.expiresAt.epochMillis);
    expect(removedAt).toBeLessThan(list.expiresAt.epochMillis + DAY_SECONDS * 1000);
  });
});
