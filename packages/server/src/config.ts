/**
 * Server configuration, read from the environment.
 *
 * `APP_ENV` names the environment. Only when it is `development` or `test` may settings be left out or blank; they then default
 * to the Cosmos DB emulator and Azurite from docker-compose.yml, reached with the emulators' fixed keys (`COSMOS_KEY` and
 * `STORAGE_CONNECTION_STRING` may override them), and the Vite dev server's origin. In every other case, including when
 * `APP_ENV` is not set, the app is deployed: it reaches Cosmos DB and Blob Storage only with the user-assigned managed identity
 * (`AZURE_CLIENT_ID`, `COSMOS_ENDPOINT`, `STORAGE_BLOB_ENDPOINT`), every setting it uses is required, and `loadConfig` throws at
 * startup naming the missing ones, so a deployed app never silently uses the emulators. It also throws if `COSMOS_KEY` or
 * `STORAGE_CONNECTION_STRING` is set, so a key can't quietly be used in production (docs/architecture.md, "Access to Cosmos DB
 * and Blob Storage"). `npm run dev`, `npm run cleanup:dev` and the Vitest configs set `APP_ENV` for local use.
 *
 * `EDITORS` is the one optional setting everywhere: an empty list is valid and means nobody can edit (X-7).
 */

/**
 * Deployed access to Cosmos DB or Blob Storage: the one user-assigned managed identity, named by its client ID
 * (`AZURE_CLIENT_ID`). Key access is switched off on both accounts (docs/architecture.md, "Access to Cosmos DB and Blob
 * Storage").
 */
export interface ManagedIdentityAccess {
  kind: "managedIdentity";
  clientId: string;
}

/** Local access to the Cosmos DB emulator with a key. Only in development and test. */
export interface CosmosKeyAccess {
  kind: "key";
  key: string;
}

export interface CosmosConfig {
  endpoint: string;
  /** A key locally, the managed identity when deployed; always exactly one of them. */
  access: CosmosKeyAccess | ManagedIdentityAccess;
  database: string;
  container: string;
}

/** Local access to Azurite with a connection string, which also names the endpoint. Only in development and test. */
export interface StorageConnectionStringAccess {
  kind: "connectionString";
  connectionString: string;
}

/** Deployed access to Blob Storage: the managed identity at the account's Blob endpoint (`STORAGE_BLOB_ENDPOINT`). */
export interface StorageManagedIdentityAccess extends ManagedIdentityAccess {
  blobEndpoint: string;
}

/** Blob Storage for photos (docs/architecture.md, "Photos"): a private container, read only through the API (X-1). */
export interface StorageConfig {
  /** A connection string locally, the managed identity when deployed; always exactly one of them. */
  access: StorageConnectionStringAccess | StorageManagedIdentityAccess;
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
  /**
   * True when running on Azure Container Apps: in an app, which sets `CONTAINER_APP_NAME` in every container, or in a job, such
   * as the trash cleanup, which sets `CONTAINER_APP_JOB_NAME`.
   */
  onContainerApps: boolean;
  /**
   * True only in a Container App (`CONTAINER_APP_NAME`; a job serves no requests) with `TRUST_AUTH_HEADERS` set to exactly
   * `true`. The `X-MS-CLIENT-PRINCIPAL-*` headers can't be forged only while the built-in authentication layer is switched on;
   * the infrastructure script sets the setting in the same step that turns it on (docs/architecture.md, "Sign-in"). Otherwise
   * the headers are ignored and everyone is a visitor.
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

/**
 * Key-based settings, accepted only in development and test. Deployed, key access is switched off on both accounts and the app
 * uses the managed identity (docs/architecture.md, "Access to Cosmos DB and Blob Storage").
 */
const LOCAL_ONLY_SETTINGS = ["COSMOS_KEY", "STORAGE_CONNECTION_STRING"] as const;

/** Set by Azure Container Apps in every app container and every job container, respectively. */
const CONTAINER_APPS_VARIABLES = ["CONTAINER_APP_NAME", "CONTAINER_APP_JOB_NAME"] as const;

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

/**
 * The URL if `value` is exactly an origin: scheme, host and optional port, with no path, query, fragment, credentials or
 * trailing slash. Otherwise undefined.
 */
function asOrigin(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.origin === value ? url : undefined;
}

function parseOrigin(value: string): string {
  if (asOrigin(value) === undefined) {
    throw new Error(
      `CLIENT_ORIGIN must be an origin such as https://recipes.example.net (scheme, host and optional port, no path or ` +
        `trailing slash); got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Checks a deployed Cosmos DB or Blob Storage endpoint: `https://<account>.<domain>` exactly, so a mistyped setting can't send
 * the managed identity's token to another host (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). The account
 * must be a single DNS label, so look-alikes such as `xdocuments.azure.com` or `documents.azure.com.evil.net` are refused. No
 * port is accepted, not even `:443`: the origin form is what the scripts set, and one exact form leaves nothing to interpret.
 */
function parseAzureEndpoint(name: string, value: string, domain: string): string {
  const url = asOrigin(value);
  const host = url?.hostname ?? "";
  const account = host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : "";
  if (url === undefined || url.protocol !== "https:" || url.port !== "" || !/^[a-z0-9-]+$/.test(account)) {
    throw new Error(
      `${name} must be an https origin on ${domain}, such as https://<account>.${domain} (no port, path or trailing ` +
        `slash); got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const appEnv = env.APP_ENV?.trim() ?? "";
  const local = LOCAL_ENVIRONMENTS.includes(appEnv);
  const containerAppsVariables = CONTAINER_APPS_VARIABLES.filter((name) => (env[name]?.trim() ?? "") !== "");
  const onContainerApps = containerAppsVariables.length > 0;
  // The local defaults, the emulators and the development sign-in stub must never run in a deployed app or job
  // (docs/architecture.md, "Sign-in" and "Trash cleanup").
  if (local && onContainerApps) {
    throw new Error(
      `APP_ENV=${appEnv} is not allowed on Container Apps (${containerAppsVariables.join(" and ")} ` +
        `${containerAppsVariables.length > 1 ? "are" : "is"} set). Development and test mode are for local use only; ` +
        "remove APP_ENV or set it to the deployed environment's name.",
    );
  }
  // Deployed, Cosmos DB and Blob Storage are reached only with the managed identity, so a key set by mistake is refused rather
  // than ignored (docs/architecture.md, "Access to Cosmos DB and Blob Storage").
  const keySettings = local ? [] : LOCAL_ONLY_SETTINGS.filter((name) => (env[name]?.trim() ?? "") !== "");
  if (keySettings.length > 0) {
    throw new Error(
      `${keySettings.join(" and ")} must not be set outside development and test. Deployed, Cosmos DB and Blob Storage ` +
        `are reached only with the managed identity named by AZURE_CLIENT_ID; remove ${keySettings.length > 1 ? "them" : "it"}.`,
    );
  }
  const missing: string[] = [];

  function setting(name: string, localDefault: string): string {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") return value;
    if (!local) missing.push(name);
    return localDefault;
  }

  const cosmosEndpoint = setting("COSMOS_ENDPOINT", COSMOS_EMULATOR_ENDPOINT);
  const cosmosDatabase = setting("COSMOS_DATABASE", "recipebox");
  const cosmosContainer = setting("COSMOS_CONTAINER", "recipes");
  // Read only when deployed; locally the connection string names the endpoint and no identity is used.
  const blobEndpoint = local ? "" : setting("STORAGE_BLOB_ENDPOINT", "");
  const photoContainer = setting("STORAGE_PHOTO_CONTAINER", "photos");
  const clientId = local ? "" : setting("AZURE_CLIENT_ID", "");
  const clientOrigin = setting("CLIENT_ORIGIN", DEV_CLIENT_ORIGIN);
  if (missing.length > 0) {
    throw new Error(
      `Missing required settings: ${missing.join(", ")}. ` +
        "Set them, or set APP_ENV=development or APP_ENV=test to use the local defaults.",
    );
  }
  // Locally the emulators serve plain http on localhost, so only deployed endpoints are checked.
  if (!local) {
    parseAzureEndpoint("COSMOS_ENDPOINT", cosmosEndpoint, "documents.azure.com");
    parseAzureEndpoint("STORAGE_BLOB_ENDPOINT", blobEndpoint, "blob.core.windows.net");
  }
  const cosmos: CosmosConfig = {
    endpoint: cosmosEndpoint,
    access: local
      ? { kind: "key", key: setting("COSMOS_KEY", COSMOS_EMULATOR_KEY) }
      : { kind: "managedIdentity", clientId },
    database: cosmosDatabase,
    container: cosmosContainer,
  };
  const storage: StorageConfig = {
    access: local
      ? { kind: "connectionString", connectionString: setting("STORAGE_CONNECTION_STRING", AZURITE_CONNECTION_STRING) }
      : { kind: "managedIdentity", clientId, blobEndpoint },
    photoContainer,
  };
  return {
    cosmos,
    storage,
    local,
    onContainerApps,
    trustAuthHeaders: (env.CONTAINER_APP_NAME?.trim() ?? "") !== "" && env.TRUST_AUTH_HEADERS === "true",
    editors: parseEditors(env.EDITORS),
    clientOrigin: parseOrigin(clientOrigin),
  };
}
