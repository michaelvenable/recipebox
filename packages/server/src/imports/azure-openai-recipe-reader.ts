// The reading service when deployed (IMP-6; docs/architecture.md, "Recipe import"): the `gpt-5.4-mini` deployment in the
// Azure AI Foundry resource, called through Azure OpenAI's OpenAI-compatible v1 endpoint with the `openai` client and the
// managed identity. No key exists: the resource has local auth switched off (infra/main.bicep).
import { getBearerTokenProvider, type TokenCredential } from "@azure/identity";
import OpenAI, { APIConnectionError, APIError, APIUserAbortError, type ClientOptions } from "openai";
import type { ChatCompletion, ChatCompletionContentPart } from "openai/resources/chat/completions";
import { managedIdentityCredential } from "../azure-credential.js";
import type { Config, ReadingServiceConfig } from "../config.js";
import { loadReadingServiceConfig } from "../config.js";
import { READING_INSTRUCTIONS, readingSchema, readingUserMessage } from "./reading-prompt.js";
import { DevelopmentRecipeReader, type RecipeReader } from "./recipe-reader.js";

/** The token audience for Azure OpenAI with Microsoft Entra ID. */
export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

/**
 * Room for the answer. A recipe needed under 1,000 output tokens in the model trial (docs/architecture.md, "Recipe import");
 * the rest is headroom, so a long recipe isn't cut off. An answer that is cut off anyway fails as `service-error` (IMP-11).
 */
export const MAX_COMPLETION_TOKENS = 16_000;

/** The structured output's name, sent with the schema. */
export const READING_SCHEMA_NAME = "recipe";

/** The longest service message kept in the `service-error` detail (IMP-11), so the log line stays short. */
const DETAIL_MAX_LENGTH = 300;

/**
 * The client for the v1 endpoint, `https://<account>.openai.azure.com/openai/v1/`, signed in with the managed identity: the
 * token is fetched for each request through `getBearerTokenProvider`, which caches it and gets a new one before it expires.
 * `credentialFor` and `fetch` are replaceable in tests, which never call Azure.
 */
export function createReadingClient(
  config: ReadingServiceConfig,
  {
    credentialFor = managedIdentityCredential,
    fetch,
  }: { credentialFor?: (clientId: string) => TokenCredential; fetch?: ClientOptions["fetch"] } = {},
): OpenAI {
  return new OpenAI({
    baseURL: `${config.endpoint}/openai/v1/`,
    apiKey: getBearerTokenProvider(credentialFor(config.clientId), COGNITIVE_SERVICES_SCOPE),
    // The SDK's own retries of a rate limit or a passing server error, within the same import's time (IMP-11). They don't
    // retry a failed import, which is out of scope.
    maxRetries: 2,
    ...(fetch === undefined ? {} : { fetch }),
  });
}

/** A failure of the reading service. Its message is the `service-error` detail (IMP-11) and never holds the answer's text. */
export class ReadingServiceError extends Error {
  override readonly name = "ReadingServiceError";
}

/**
 * Reads a recipe with one chat completion: READING_INSTRUCTIONS as the system message, then one user message with the tags in
 * use and every page photo, in order, as a JPEG data URL at high detail, with the strict schema of reading-prompt.ts as the
 * structured output (IMP-6, IMP-8, IMP-9).
 */
export class AzureOpenAIRecipeReader implements RecipeReader {
  constructor(
    private readonly client: Pick<OpenAI, "chat">,
    private readonly deployment: string,
  ) {}

  async read(images: readonly Buffer[], allowedTags: readonly string[], signal: AbortSignal): Promise<string> {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: readingUserMessage(allowedTags) },
      // The page photos are the API's own output: oriented JPEGs without metadata (docs/architecture.md, "Recipe import").
      ...images.map(
        (image): ChatCompletionContentPart => ({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "high" },
        }),
      ),
    ];
    let completion: ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.deployment,
          messages: [
            { role: "system", content: READING_INSTRUCTIONS },
            { role: "user", content },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: READING_SCHEMA_NAME, strict: true, schema: { ...readingSchema(allowedTags) } },
          },
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        },
        { signal },
      );
    } catch (error) {
      throw new ReadingServiceError(requestFailureDetail(error));
    }
    return answerText(completion);
  }
}

/**
 * The answer's JSON text, or a ReadingServiceError if there is no usable answer. The messages never quote the answer or a
 * refusal, which may hold recipe text (IMP-11).
 */
function answerText(completion: ChatCompletion): string {
  const choice = completion.choices[0];
  if (choice === undefined) throw new ReadingServiceError("The reading service returned no answer.");
  switch (choice.finish_reason) {
    case "stop":
      break;
    case "length":
      throw new ReadingServiceError("The reading service's answer was cut off (finish_reason length).");
    case "content_filter":
      throw new ReadingServiceError("The reading service's content filter stopped the answer (finish_reason content_filter).");
    default:
      throw new ReadingServiceError(
        `The reading service stopped without an answer (finish_reason ${String(choice.finish_reason)}).`,
      );
  }
  const { refusal, content } = choice.message;
  if (refusal !== null && refusal !== undefined && refusal !== "") {
    throw new ReadingServiceError("The reading service refused to read the photos.");
  }
  if (content === null || content === "") throw new ReadingServiceError("The reading service returned an empty answer.");
  return content;
}

/**
 * The detail for a request that failed (IMP-11): the service's own error message, which starts with the HTTP status, and its
 * error code, shortened. A failed request has no answer, so nothing read from the photos can be in it.
 */
function requestFailureDetail(error: unknown): string {
  if (error instanceof APIUserAbortError) return "The request to the reading service was stopped.";
  if (error instanceof APIError && error.status !== undefined) {
    const code = typeof error.code === "string" && error.code !== "" ? ` (${error.code})` : "";
    return shorten(`The reading service answered with an error${code}: ${messageOf(error)}`);
  }
  if (error instanceof APIConnectionError) return shorten(`The reading service could not be reached: ${messageOf(error)}`);
  // Such as the managed identity's token not being available.
  return shorten(`The request to the reading service failed: ${messageOf(error)}`);
}

/** The error's message, with its cause's, which says more for a failed connection or sign-in. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error && error.cause.message !== "" ? ` (${error.cause.message})` : "";
  return `${error.message}${cause}`;
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= DETAIL_MAX_LENGTH ? oneLine : `${oneLine.slice(0, DETAIL_MAX_LENGTH - 1)}…`;
}

/**
 * The import job's reading service: the development reader locally (docs/architecture.md, "Recipe import": "a
 * development-only fake model"), the model deployment when deployed, which then needs MODEL_ENDPOINT and MODEL_DEPLOYMENT
 * (config.ts).
 */
export function createRecipeReader(
  config: Config,
  env: Readonly<Record<string, string | undefined>> = process.env,
  clientOptions: Parameters<typeof createReadingClient>[1] = {},
): RecipeReader {
  const service = loadReadingServiceConfig(config, env);
  if (service === undefined) return new DevelopmentRecipeReader(config);
  return new AzureOpenAIRecipeReader(createReadingClient(service, clientOptions), service.deployment);
}
