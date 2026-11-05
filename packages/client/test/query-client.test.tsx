import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Me } from "@recipebox/shared";
import { ApiError } from "../src/api/client.js";
import { ME_QUERY_KEY, useViewer } from "../src/auth/sign-in.js";
import { createQueryClient } from "../src/query-client.js";
import { EDITOR, jsonResponse, mockFetch } from "./helpers.js";

function refusal(status: number): ApiError {
  return new ApiError(status, [{ code: "test.refused", message: "Refused." }]);
}

/** Runs a query whose function always throws `error`, with no delay between retries; returns how often it ran. */
async function attemptsUntilFailure(error: unknown): Promise<number> {
  const client = createQueryClient();
  let attempts = 0;
  await expect(
    client.fetchQuery({
      queryKey: ["test"],
      queryFn: () => {
        attempts += 1;
        throw error;
      },
      retryDelay: 0,
    }),
  ).rejects.toBe(error);
  return attempts;
}

describe("Query retries", () => {
  it.each([400, 401, 403, 404, 409])("doesn't retry a %i refusal", async (status) => {
    expect(await attemptsUntilFailure(refusal(status))).toBe(1);
  });

  it.each([500, 502, 503])("retries a %i up to twice", async (status) => {
    expect(await attemptsUntilFailure(refusal(status))).toBe(3);
  });

  it("retries a network failure up to twice", async () => {
    expect(await attemptsUntilFailure(new TypeError("Failed to fetch"))).toBe(3);
  });
});

describe("Changes while the browser says it is offline", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("are sent at once and fail with the network error, rather than waiting silently to be resumed", async () => {
    onlineManager.setOnline(false);
    const client = createQueryClient();
    let attempts = 0;
    const error = new TypeError("Failed to fetch");
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => {
        attempts += 1;
        return Promise.reject(error);
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(attempts).toBe(1);
    expect(mutation.state.isPaused).toBe(false);
  });
});

describe("X-8, X-6, X-9 a refused request reloads who is signed in", () => {
  function signedInClient() {
    const client = createQueryClient();
    client.setQueryData<Me>(ME_QUERY_KEY, EDITOR);
    return client;
  }

  function meIsInvalidated(client: ReturnType<typeof createQueryClient>): boolean {
    return client.getQueryState(ME_QUERY_KEY)?.isInvalidated ?? false;
  }

  it.each([401, 403])("invalidates /me when a query gets %i", async (status) => {
    const client = signedInClient();
    await client.fetchQuery({ queryKey: ["trash"], queryFn: () => Promise.reject(refusal(status)) }).catch(() => {});
    expect(meIsInvalidated(client)).toBe(true);
  });

  it.each([401, 403])("invalidates /me when a change gets %i", async (status) => {
    const client = signedInClient();
    const mutation = client.getMutationCache().build(client, { mutationFn: () => Promise.reject(refusal(status)) });
    await mutation.execute(undefined).catch(() => {});
    expect(meIsInvalidated(client)).toBe(true);
  });

  it.each([401, 403])("settles into the visitor state, fetching /me once, when /me itself gets %i", async (status) => {
    // Capped, so a refetch loop ends the test instead of hanging it: after the cap, /me never answers.
    let meCalls = 0;
    mockFetch(() => {
      meCalls += 1;
      if (meCalls > 50) return new Promise<Response>(() => {});
      return jsonResponse(status, { errors: [{ code: "auth.signInRequired", message: "Sign in to do this." }] });
    });
    function ShowViewer() {
      return <p>{`viewer: ${useViewer().viewer}`}</p>;
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ShowViewer />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("viewer: visitor")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(meCalls).toBe(1);
    expect(screen.getByText("viewer: visitor")).toBeInTheDocument();
  });

  it.each([400, 404, 409, 500])("leaves /me alone for %i", async (status) => {
    const client = signedInClient();
    await client
      .fetchQuery({ queryKey: ["trash"], queryFn: () => Promise.reject(refusal(status)), retry: false })
      .catch(() => {});
    expect(meIsInvalidated(client)).toBe(false);
  });
});
