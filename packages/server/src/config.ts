/**
 * Server configuration, read from the environment.
 *
 * `APP_ENV` names the environment. Only when it is `development` or `test` may settings be left out or blank; they then default
 * to the Cosmos DB emulator and Azurite from docker-compose.yml and the Vite dev server's origin. In every other case,
 * including when `APP_ENV` is not set, every setting is required and `loadConfig` throws at startup naming the missing ones, so
 * a deployed app never silently uses the emulators. `npm run dev` and the Vitest configs set `APP_ENV` for local use.
 *
 * `EDITORS` is the one optional setting everywhere: an empty list is valid and means nobody can edit (X-7).
 */
export interface CosmosConfig {
  endpoint: string;
  key: string;
  database: string;
  container: string;
}

/** Blob Storage for photos (docs/architecture.md, "Photos"): a private container, read only through the API (X-1). */
export interface StorageConfig {
  connectionString: string;
  photoContainer: string;
}

/** The identity providers Container Apps' built-in authentication is set up with (docs/architecture.md, "Sign-in"). */
export const PROVIDERS = ["aad", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A signed-in identity: the provider plus that provider's permanent account ID, never an email address (X-7). */
export interface Identity {
  provider: Provider;
  accountId: string;
}

export interface Config {
  cosmos: CosmosConfig;
  storage: StorageConfig;
  /** True when `APP_ENV` is `development` or `test`. */
  local: boolean;
  /** True when running on Azure Container Apps, which sets `CONTAINER_APP_NAME` in every container. */
  onContainerApps: boolean;
  /**
   * True only on Container Apps with `TRUST_AUTH_HEADERS` set to exactly `true`. The `X-MS-CLIENT-PRINCIPAL-*` headers can't be
   * forged only while the built-in authentication layer is switched on; the infrastructure script sets the setting in the same
   * step that turns it on (docs/architecture.md, "Sign-in"). Otherwise the headers are ignored and everyone is a visitor.
   */
  trustAuthHeaders: boolean;
  /** The editor list (X-7). */
  editors: readonly Identity[];
  /** The client's origin, the only origin CORS allows (docs/architecture.md, "Sign-in"). */
  clientOrigin: string;
}

/** The emulator's address in docker-compose.yml; it serves plain HTTP. */
export const COSMOS_EMULATOR_ENDPOINT = "http://localhost:8081";

/**
 * The Cosmos DB emulator's fixed, publicly documented key. It is the same for every emulator install and grants access to
 * nothing else, so it is not a secret.
 */
export const COSMOS_EMULATOR_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

/**
 * Azurite's fixed, publicly documented development account (devstoreaccount1) at the address in docker-compose.yml. Like the
 * Cosmos DB emulator key, it is the same for every install and grants access to nothing else, so it is not a secret.
 */
export const AZURITE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";

/** The Vite dev server's origin, the default `CLIENT_ORIGIN` in development and test. */
export const DEV_CLIENT_ORIGIN = "http://localhost:5173";

/** The `APP_ENV` values in which missing settings fall back to the local defaults. */
const LOCAL_ENVIRONMENTS: readonly string[] = ["development", "test"];

type Env = Readonly<Record<string, string | undefined>>;

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Parses `provider:accountId`, e.g. `google:1098`. Returns undefined for an unknown provider or a missing or blank account ID.
 * Provider names are matched exactly, as Container Apps sends them.
 */
export function parseIdentity(text: string): Identity | undefined {
  const colon = text.indexOf(":");
  if (colon < 0) return undefined;
  const provider = text.slice(0, colon).trim();
  const accountId = text.slice(colon + 1).trim();
  if (!isProvider(provider) || accountId === "" || /\s/.test(accountId)) return undefined;
  return { provider, accountId };
}

/** Parses the `EDITORS` setting (X-7): comma-separated `provider:accountId` entries; spaces and empty entries are ignored. */
export function parseEditors(text: string | undefined): Identity[] {
  const entries = (text ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const editors: Identity[] = [];
  const malformed: string[] = [];
  for (const entry of entries) {
    const identity = parseIdentity(entry);
    if (identity === undefined) malformed.push(entry);
    else editors.push(identity);
  }
  if (malformed.length > 0) {
    throw new Error(
      `Malformed EDITORS entries: ${malformed.map((e) => JSON.stringify(e)).join(", ")}. ` +
        `Each entry must be provider:accountId, where provider is ${PROVIDERS.join(" or ")}, e.g. "google:1098,aad:9f3c".`,
    );
  }
  return editors;
}

function parseOrigin(value: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (url === undefined || url.origin !== value) {
    throw new Error(
      `CLIENT_ORIGIN must be an origin such as https://recipes.example.net (scheme, host and optional port, no path or ` +
        `trailing slash); got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const appEnv = env.APP_ENV?.trim() ?? "";
  const local = LOCAL_ENVIRONMENTS.includes(appEnv);
  const onContainerApps = (env.CONTAINER_APP_NAME?.trim() ?? "") !== "";
  // The local defaults and the development sign-in stub must never run in a deployed app (docs/architecture.md, "Sign-in").
  if (local && onContainerApps) {
    throw new Error(
      `APP_ENV=${appEnv} is not allowed on Container Apps (CONTAINER_APP_NAME is set). Development and test mode are for ` +
        "local use only; remove APP_ENV or set it to the deployed environment's name.",
    );
  }
  const missing: string[] = [];

  function setting(name: string, localDefault: string): string {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") return value;
    if (!local) missing.push(name);
    return localDefault;
  }

  const cosmos: CosmosConfig = {
    endpoint: setting("COSMOS_ENDPOINT", COSMOS_EMULATOR_ENDPOINT),
    key: setting("COSMOS_KEY", COSMOS_EMULATOR_KEY),
    database: setting("COSMOS_DATABASE", "recipebox"),
    container: setting("COSMOS_CONTAINER", "recipes"),
  };
  const storage: StorageConfig = {
    connectionString: setting("STORAGE_CONNECTION_STRING", AZURITE_CONNECTION_STRING),
    photoContainer: setting("STORAGE_PHOTO_CONTAINER", "photos"),
  };
  const clientOrigin = setting("CLIENT_ORIGIN", DEV_CLIENT_ORIGIN);
  if (missing.length > 0) {
    throw new Error(
      `Missing required settings: ${missing.join(", ")}. ` +
        "Set them, or set APP_ENV=development or APP_ENV=test to use the local defaults.",
    );
  }
  return {
    cosmos,
    storage,
    local,
    onContainerApps,
    trustAuthHeaders: onContainerApps && env.TRUST_AUTH_HEADERS === "true",
    editors: parseEditors(env.EDITORS),
    clientOrigin: parseOrigin(clientOrigin),
  };
}
