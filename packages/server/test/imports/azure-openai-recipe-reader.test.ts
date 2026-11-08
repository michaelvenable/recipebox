// The deployed reading service (docs/architecture.md, "Recipe import"): the request the `openai` client sends to the model
// deployment, and how a failed or unusable answer surfaces as `service-error` (IMP-11). The client's fetch and the managed
// identity are fakes; nothing here calls Azure.
import type { AccessToken, GetTokenOptions, TokenCredential } from "@azure/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AzureOpenAIRecipeReader,
  COGNITIVE_SERVICES_SCOPE,
  createReadingClient,
  createRecipeReader,
  MAX_COMPLETION_TOKENS,
  READING_SCHEMA_NAME,
  ReadingServiceError,
} from "../../src/imports/azure-openai-recipe-reader.js";
import { READING_INSTRUCTIONS, readingSchema, readingUserMessage } from "../../src/imports/reading-prompt.js";
import { DevelopmentRecipeReader } from "../../src/imports/recipe-reader.js";
import { loadConfig, type ReadingServiceConfig } from "../../src/config.js";
import { DEPLOYED_SETTINGS } from "../app-helpers.js";
import { answer, ImportJobFixture } from "./process-import-helpers.js";

const SERVICE: ReadingServiceConfig = {
  endpoint: "https://aif-recipebox.openai.azure.com",
  deployment: "gpt-5.4-mini",
  clientId: "00000000-0000-0000-0000-000000000009",
};

/** A request the client sent. */
interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** What the fake service answers: a status and a JSON body. */
type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** A chat completion with one choice. */
function completion(choice: { content?: string | null; refusal?: string | null; finish_reason?: string }): unknown {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "gpt-5.4-mini",
    choices: [
      {
        index: 0,
        finish_reason: choice.finish_reason ?? "stop",
        message: { role: "assistant", content: choice.content ?? null, refusal: choice.refusal ?? null },
      },
    ],
  };
}

let sent: SentRequest[];
let replies: Reply[];
let tokens: { scopes: string | string[]; options: GetTokenOptions | undefined }[];
let credentialFor: ReturnType<typeof vi.fn<(clientId: string) => TokenCredential>>;

const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  sent.push({
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: JSON.parse(await request.text()) as Record<string, unknown>,
  });
  init?.signal?.throwIfAborted();
  const reply = replies.shift() ?? { status: 200, body: completion({ content: answer() }) };
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json", ...reply.headers },
  });
};

beforeEach(() => {
  sent = [];
  replies = [];
  tokens = [];
  const credential: TokenCredential = {
    getToken: (scopes, options): Promise<AccessToken> => {
      tokens.push({ scopes, options });
      return Promise.resolve({ token: "identity-token", expiresOnTimestamp: Date.now() + 3_600_000 });
    },
  };
  credentialFor = vi.fn<(clientId: string) => TokenCredential>(() => credential);
});

function reader(): AzureOpenAIRecipeReader {
  return new AzureOpenAIRecipeReader(createReadingClient(SERVICE, { credentialFor, fetch: fakeFetch }), SERVICE.deployment);
}

const PAGES = [Buffer.from("front of the card"), Buffer.from("back of the card")];

/** The error `read` fails with. */
async function failure(reading: Promise<string>): Promise<ReadingServiceError> {
  const error = await reading.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReadingServiceError);
  return error as ReadingServiceError;
}

describe("IMP-6 reading with the model deployment (docs/architecture.md, Recipe import)", () => {
  it("returns the answer's JSON text", async () => {
    replies.push({ status: 200, body: completion({ content: answer({ name: "Banana Bread" }) }) });

    expect(JSON.parse(await reader().read(PAGES, [], new AbortController().signal))).toMatchObject({ name: "Banana Bread" });
  });

  it("sends one chat completion to the v1 endpoint with the deployment as the model", async () => {
    await reader().read(PAGES, ["baking"], new AbortController().signal);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.url).toBe("https://aif-recipebox.openai.azure.com/openai/v1/chat/completions");
    expect(sent[0]?.body.model).toBe("gpt-5.4-mini");
    expect(sent[0]?.body.max_completion_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(MAX_COMPLETION_TOKENS).toBe(16_000);
  });

  it("sends the instructions as the system message, then the tags in use and every page, in order, at high detail", async () => {
    await reader().read(PAGES, ["baking", "dinner"], new AbortController().signal);

    expect(sent[0]?.body.messages).toEqual([
      { role: "system", content: READING_INSTRUCTIONS },
      {
        role: "user",
        content: [
          { type: "text", text: readingUserMessage(["baking", "dinner"]) },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${PAGES[0]?.toString("base64")}`, detail: "high" },
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${PAGES[1]?.toString("base64")}`, detail: "high" },
          },
        ],
      },
    ]);
  });

  it("IMP-8: asks for strict structured output with the schema built for the tags in use", async () => {
    await reader().read(PAGES, ["baking", "dinner"], new AbortController().signal);

    expect(sent[0]?.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: READING_SCHEMA_NAME, strict: true, schema: readingSchema(["baking", "dinner"]) },
    });
  });

  it("IMP-8: with no tags in use, the schema has no tags field", async () => {
    await reader().read(PAGES, [], new AbortController().signal);

    const format = sent[0]?.body.response_format as { json_schema: { schema: { properties: object } } };
    expect(format.json_schema.schema.properties).not.toHaveProperty("tags");
  });
});

describe("docs/architecture.md, Recipe import: the model is reached with the managed identity, never a key", () => {
  it("signs in as the configured identity with a Cognitive Services token", async () => {
    await reader().read(PAGES, [], new AbortController().signal);

    expect(credentialFor).toHaveBeenCalledExactlyOnceWith(SERVICE.clientId);
    expect(tokens.map((t) => [t.scopes].flat())).toEqual([[COGNITIVE_SERVICES_SCOPE]]);
    expect(COGNITIVE_SERVICES_SCOPE).toBe("https://cognitiveservices.azure.com/.default");
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer identity-token");
    expect(sent[0]?.headers.get("api-key")).toBeNull();
  });

  it("reuses the token while it is valid", async () => {
    const read = reader();
    await read.read(PAGES, [], new AbortController().signal);
    await read.read(PAGES, [], new AbortController().signal);

    expect(sent).toHaveLength(2);
    expect(tokens).toHaveLength(1);
  });

  it("ignores OPENAI_API_KEY in the environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "a-key");
    try {
      await reader().read(PAGES, [], new AbortController().signal);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(sent[0]?.headers.get("authorization")).toBe("Bearer identity-token");
  });
});

describe("IMP-11 a failing reading service surfaces as an error with a short detail that never quotes the answer", () => {
  it("an answer cut off at the token limit (finish_reason length)", async () => {
    replies.push({ status: 200, body: completion({ content: '{"found":true,"name":"Banana', finish_reason: "length" }) });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toBe("The reading service's answer was cut off (finish_reason length).");
  });

  it("a refusal", async () => {
    replies.push({ status: 200, body: completion({ refusal: "I can't help with Banana Bread." }) });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toBe("The reading service refused to read the photos.");
  });

  it("an answer stopped by the content filter", async () => {
    replies.push({ status: 200, body: completion({ content: "Banana", finish_reason: "content_filter" }) });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toContain("content filter");
    expect(error.message).not.toContain("Banana");
  });

  it("an empty answer, or none", async () => {
    replies.push({ status: 200, body: completion({ content: "" }) });
    replies.push({ status: 200, body: { ...(completion({}) as object), choices: [] } });

    expect((await failure(reader().read(PAGES, [], new AbortController().signal))).message).toBe(
      "The reading service returned an empty answer.",
    );
    expect((await failure(reader().read(PAGES, [], new AbortController().signal))).message).toBe(
      "The reading service returned no answer.",
    );
  });

  it("an HTTP error, with the service's own message and code", async () => {
    replies.push({
      status: 400,
      body: { error: { code: "invalid_image", message: "One of the images could not be read.", type: "invalid_request_error" } },
    });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toContain("(invalid_image)");
    expect(error.message).toContain("400");
    expect(error.message).toContain("One of the images could not be read.");
  });

  it("a permission error, as when the identity lacks its role on the resource", async () => {
    replies.push({ status: 401, body: { error: { code: "PermissionDenied", message: "Principal does not have access." } } });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toContain("401");
    expect(error.message).toContain("PermissionDenied");
  });

  it("a server error is tried again by the client before it fails", async () => {
    for (let i = 0; i < 3; i++) {
      replies.push({ status: 500, body: { error: { message: "Internal error" } }, headers: { "retry-after-ms": "0" } });
    }

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(sent).toHaveLength(3);
    expect(error.message).toContain("500");
  });

  it("a long service message is shortened to one line", async () => {
    replies.push({ status: 400, body: { error: { message: `Bad\nrequest ${"x".repeat(1000)}` } } });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message.length).toBeLessThanOrEqual(300);
    expect(error.message).not.toContain("\n");
  });

  it("no token for the identity", async () => {
    credentialFor.mockReturnValue({ getToken: () => Promise.reject(new Error("ManagedIdentityCredential: unavailable")) });

    const error = await failure(reader().read(PAGES, [], new AbortController().signal));

    expect(error.message).toContain("ManagedIdentityCredential: unavailable");
    expect(sent).toHaveLength(0);
  });

  it("stops when the job's signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("time is up"));

    const error = await failure(reader().read(PAGES, [], controller.signal));

    expect(error.message).toBe("The request to the reading service was stopped.");
  });

  it("the job logs a cut-off answer as service-error with that detail and no recipe text", async () => {
    const job = new ImportJobFixture();
    const id = await job.startImport();
    replies.push({ status: 200, body: completion({ content: '{"found":true,"name":"Banana', finish_reason: "length" }) });

    expect(await job.process(id, { reader: reader() })).toBe("service-error");

    expect(job.failures()).toEqual([
      expect.objectContaining({
        importId: id.value,
        reason: "service-error",
        detail: "The reading service's answer was cut off (finish_reason length).",
      }),
    ]);
    expect(JSON.stringify(job.lines)).not.toContain("Banana");
  });
});

describe("docs/architecture.md, Recipe import: which reader the import job uses", () => {
  it("the development reader locally", () => {
    expect(createRecipeReader(loadConfig({ APP_ENV: "development" }), {})).toBeInstanceOf(DevelopmentRecipeReader);
  });

  it("the model deployment when deployed, at MODEL_ENDPOINT with MODEL_DEPLOYMENT as the model", async () => {
    const config = loadConfig({ APP_ENV: "production", ...DEPLOYED_SETTINGS });
    const env = { MODEL_ENDPOINT: "https://aif-other.openai.azure.com", MODEL_DEPLOYMENT: "reader-1" };

    const created = createRecipeReader(config, env, { credentialFor, fetch: fakeFetch });
    await created.read(PAGES, [], new AbortController().signal);

    expect(created).toBeInstanceOf(AzureOpenAIRecipeReader);
    expect(sent[0]?.url).toBe("https://aif-other.openai.azure.com/openai/v1/chat/completions");
    expect(sent[0]?.body.model).toBe("reader-1");
    expect(credentialFor).toHaveBeenCalledExactlyOnceWith(DEPLOYED_SETTINGS.AZURE_CLIENT_ID);
  });

  it("refuses to start when deployed without the model settings", () => {
    const config = loadConfig({ APP_ENV: "production", ...DEPLOYED_SETTINGS });

    expect(() => createRecipeReader(config, {})).toThrow(
      "Missing required settings for the import job: MODEL_ENDPOINT, MODEL_DEPLOYMENT.",
    );
  });
});
