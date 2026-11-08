# Architecture

How RecipeBox is built and deployed, and why. Behavior is defined in `docs/specs/`; the business rules are designed in
`docs/domain-model.md`. This document covers everything around them.

## Overview

```
 Phone / tablet / desktop browser
            |
            |  https://recipes.mikevenable.net                https://api.recipes.mikevenable.net
            v                                                     |
 +-----------------------------+    fetch, with cookie     +------v-------------------------------+
 | Azure Static Web Apps (Free)| ------------------------> | Azure Container Apps (Consumption)   |
 | React + Vite PWA            |                           |  built-in sign-in (Microsoft, Google)|
 +-----------------------------+                           |  Fastify API -> domain package       |
                                                           +------+------------------------+------+
                                                                  |                        |
                                                      +-----------v----------+   +---------v----------+
                                                      | Azure Cosmos DB      |   | Azure Blob Storage |
                                                      | (free tier) recipes  |   | photos (private)   |
                                                      +----------------------+   +--------------------+
                                                                  ^
                                                      +-----------+----------+
                                                      | Container Apps Job   |
                                                      | daily trash cleanup  |
                                                      +----------------------+
```

## Decisions

| Area           | Choice                                                      | Why                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Language       | TypeScript everywhere                                       | One language; the owner can review all of it.  |
| Domain         | Pure TypeScript classes, no dependencies                    | Rules in one reviewable, testable place.       |
| API            | Node 22 + Fastify                                           | Built-in validation; `inject()` for tests.     |
| Contract       | Zod schemas in `packages/shared`                            | Shared types; drift fails the build.           |
| Database       | Cosmos DB, free tier: `recipes`, `shopping-lists` (PLAN-9)  | One recipe per document; free at this size.    |
| Photos         | Blob Storage, private container, served by the API          | API can hide trashed recipes' photos (X-1).    |
| Client hosting | Static Web Apps, Free plan                                  | Free CDN, HTTPS and custom domain.             |
| API hosting    | Container Apps, Consumption plan, scale to zero             | Free grant; a few seconds' cold start is fine. |
| Sign-in        | Container Apps built-in authentication                      | Microsoft and Google built in, at no cost.     |
| Domain names   | `recipes.mikevenable.net` and `api.recipes.mikevenable.net` | Same site, so Safari keeps the cookie.         |
| Trash cleanup  | Container Apps Job, once a day                              | Removes documents and photos (REC-16).         |
| Data access    | A user-assigned managed identity, no keys                   | Nothing to leak or rotate; keys switched off.  |

## Repository layout

```
recipebox/
  packages/
    domain/      # business rules (domain-model.md); zero dependencies
    shared/      # Zod schemas for the HTTP API; imported by server and client
    server/      # Fastify API, Cosmos and Blob adapters, auth, trash cleanup job
    client/      # React + Vite PWA
  docs/
    specs/       # requirements (canonical)
    domain-model.md
    architecture.md
  CLAUDE.md      # conventions for agents
```

npm workspaces: one `npm install` and one `npm test` at the root cover every package. The dependency direction is fixed: `client
-> shared`, `server -> shared, domain`. The domain depends on nothing; the client never imports the server.

## How a change is applied

Every change follows the same steps on the server:

1. Check the caller is an editor (X-6). If not, refuse.
2. Read the current recipe document from Cosmos.
3. Rebuild the `Recipe` with `fromSnapshot`, then call one domain method with the request's input and the server's current time.
4. If the domain returns errors, respond with them; nothing is saved.
5. Save `toSnapshot()` back to Cosmos.

The server never saves a document sent by the client. A request carries only the input for one operation, such as new content for
REC-5 or nothing at all for "mark cooked". Because each change starts from the stored document, an edit saved from a form opened
earlier cannot erase a cooking entry or to-make change made in between. Two requests that land within the same few milliseconds
can still overwrite each other; that is accepted (X-5, withdrawn).

## Public and private data

X-1 makes recipes public and the to-make list, cooking history and trash private. The API enforces this with two response shapes
in `packages/shared`:

- `PublicRecipe`: content, tags and photo link only.
- `EditorRecipe`: everything in `PublicRecipe`, plus to-make status and cooking history.

Rules:
- Visitors only ever receive `PublicRecipe`. A recipe in the trash is "not found" for visitors, and so is its photo.
- Editor-only endpoints (to-make list, rediscovery view, trash) refuse visitors.
- The one exception is a shopping list link (PLAN-9): anyone with it gets `SharedShoppingList`, the current shopping list's
  lines and the date the link stops working, and nothing else (see "Sent shopping lists").
- Tests check every visitor-facing endpoint for the absence of private fields. This is a likely place for a leak, so reviewers
  should check it on every change that touches responses.

## Sign-in

Container Apps' built-in authentication runs in front of the API as a separate container. It handles the Microsoft and Google
sign-in pages, manages the session cookie, and passes the signed-in identity to the API in `X-MS-CLIENT-PRINCIPAL-*` headers.
Outside requests cannot set those headers, but only while the auth layer is switched on: with it off, any request could claim to
be an editor. So the API trusts these headers only when it runs on Container Apps and the setting `TRUST_AUTH_HEADERS=true` is
present; the infrastructure script sets it in the same step that turns the auth layer on. Without it, everyone is a visitor.

Microsoft and Google are both offered (X-7). Google is switched on by configuration: the provider setup steps 3–4, its secret in
the Key Vault and the `GOOGLE_CLIENT_ID` variable. Without that variable, only Microsoft is offered.

- Configuration: "Allow unauthenticated access", so visitors can read public recipes; the API decides what needs an editor.
- Sign-in links point at `https://api.recipes.mikevenable.net/.auth/login/{aad|google}`, with `post_login_redirect_uri` returning
  the editor to the page they were on (X-8). The client's address must be allowed as a redirect target in the auth configuration.
- The client calls the API with `credentials: "include"`. The API's CORS policy allows exactly the client's origin, with
  credentials.
- Both hosts are under one registrable domain, so the browser treats the API's cookie as same-site. Without that, Safari on iPhone
  and iPad would block the cookie and editors could not stay signed in.

Why a cookie rather than a bearer token: current guidance for browser-based OAuth apps (OAuth 2.0 for Browser-Based Applications)
recommends keeping tokens out of the app's JavaScript. The session cookie is `HttpOnly`, so a malicious script on the page could
not read or steal it. Bearer tokens remain the norm for non-browser clients.

Protection against forged requests (CSRF). Because the browser sends the cookie automatically, the API must make sure a change
really comes from the RecipeBox app:
- The session cookie is `Secure` and `SameSite`, so other sites' pages don't send it.
- CORS allows only `https://recipes.mikevenable.net`.
- Every change is a `POST`, `PUT` or `DELETE` with a JSON body (`Content-Type: application/json`); the API rejects anything else.
  A form on another site cannot send such a request without the browser first asking the API's permission, which CORS refuses.
- The exceptions are the uploads, `PUT /recipes/{id}/photo` and `POST /imports`, which are sent as `multipart/form-data`. A
  form on another site can send a multipart `POST` without asking, so every upload must also carry the header
  `X-Requested-By: recipebox`, whatever its method. A form can't add a header, and a script on another site can only send one
  after the browser asks the API, which CORS refuses. An upload without the header gets 403 `request.headerMissing` before its
  body is read. The upload exception is declared per route, and the check is part of it, so no upload route can skip it.
- CORS allows the methods the client actually uses (`GET`, `POST`, `PUT` and `DELETE`) and the `X-Requested-By` header.
- `GET` requests never change anything.

Provider setup (done once, by hand):

| Step | Where                          | What                                                                                  |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | Microsoft Entra (Azure portal) | App registration allowing personal Microsoft accounts; ID tokens on; client secret.   |
| 2    | Microsoft Entra                | Add the Microsoft redirect URI (below).                                               |
| 3    | Google Cloud Console           | OAuth consent screen (External, testing mode); add each Google editor as a test user. |
| 4    | Google Cloud Console           | Web OAuth client with the Google redirect URI (below).                                |
| 5    | Container app, Authentication  | Add the providers (client IDs and secrets); allow unauthenticated access.             |
| 6    | Container app, Authentication  | Allow `https://recipes.mikevenable.net` as a post-sign-in redirect target.            |

Redirect URIs:
- Microsoft: `https://api.recipes.mikevenable.net/.auth/login/aad/callback`
- Google: `https://api.recipes.mikevenable.net/.auth/login/google/callback`

The client secrets are kept in a Key Vault and referenced by the container app's secrets, so no secret value passes through
the repository, Bicep or GitHub; the app's managed identity reads them. The Entra secret expires (at most two years) and must
be renewed in the Key Vault. Everything except steps 1–4 will be scripted with Bicep.

Editors (X-7):
- An editor is identified by the identity provider plus that provider's permanent account ID, never by email address.
- The editor list is the `EDITORS` setting on the container app, e.g. `google:1098…,aad:9f3c…`. It is configuration, not data: the
  app reads it but can never change it.
- The Account page (X-11) shows a signed-in person their provider and ID, so it can be added to `EDITORS`.

Local development and tests have no built-in auth layer. The server therefore accepts identity headers only when running on
Container Apps. Locally, a development-only sign-in stub (enabled by an environment variable, refused in production) lets tests
act as a visitor, an editor or a non-editor. The server refuses to start in development or test mode on Container Apps.

## Photos

- Upload: the client sends the image to the API (REC-7). The upload field accepts only JPEG, PNG and WebP, so iOS converts HEIC
  photos to JPEG before sending them; the server doesn't decode HEIC (sharp's prebuilt build can't read HEVC, and the WebAssembly
  decoder that could is LGPL-3.0 and not worth carrying for this). All metadata, including GPS location, is removed, since
  recipe photos are public. The server checks type and size, applies the camera's rotation, converts the image to
  JPEG, creates a thumbnail, and stores both in Blob Storage.
- Decoding is isolated: each upload is decoded in its own worker thread with a 30-second limit, and the worker is ended
  afterwards. A file that crashes, hangs or exhausts the decoder only ends that worker; the upload is refused with
  `photo.unreadable` and the API keeps serving. Images over 50 megapixels are refused before decoding (48-megapixel phone photos
  fit). The source is decoded once for both sizes. Only one decode runs at a time; up to 8 more uploads wait in a queue, and the
  30-second limit starts when a decode begins. When the queue is full, the upload gets 503 `photo.busy` and can be retried. The
  API container gets 2 GiB of memory for this headroom.
- Display: the client loads photos from the API, never directly from storage. The API checks the recipe isn't in the trash (or the
  caller is an editor) and streams the image with cache headers.
- Replace and remove delete the previous images (REC-7). Permanent removal deletes them with the recipe (REC-16).

## Access to Cosmos DB and Blob Storage

In Azure, the API and the trash cleanup job use one user-assigned managed identity; no keys or connection strings exist.
- Key access is switched off on both accounts (`disableLocalAuth` on Cosmos DB, `allowSharedKeyAccess: false` on Storage).
- The identity has data roles only, granted by the infrastructure script: Cosmos DB Built-in Data Contributor on the account,
  and a custom role on the photo container that can read it and read, write and delete its blobs, but not delete it. It
  cannot create or delete databases, containers or accounts, which matches the rule that only local development creates them.
- One user-assigned identity, rather than one per app and job, so its roles exist before either is first deployed.
- Settings: `COSMOS_ENDPOINT`, `STORAGE_BLOB_ENDPOINT` (e.g. `https://<account>.blob.core.windows.net`) and `AZURE_CLIENT_ID`
  (the identity). The server refuses to start if `COSMOS_KEY` or `STORAGE_CONNECTION_STRING` is set outside development and
  test, so a key can't quietly be used in production. The server refuses to start unless each endpoint is an https origin on
  `documents.azure.com` or `blob.core.windows.net`, so a mistyped setting can't send the identity's token to another host.

Locally, the Cosmos DB emulator and Azurite accept only their fixed, public keys, so development and test keep using them.

## Search and filtering

The collection is small, so the server loads all recipes and uses the domain functions (`findRecipes`, `tagsInUse`, `suggestTags`,
`orderForRediscovery`, `trashContents`). This keeps search behavior defined in exactly one place (domain-model.md, "Known risk to
watch"). If the collection ever grows past a few thousand recipes, move filtering into Cosmos queries with tests proving they
agree with the domain.

## Time

X-12 in short: every stored time comes from the server's clock. The server passes its current time to domain methods as an
`Instant`; no request field is ever used as a time. The client formats stored times in the device's time zone and computes
relative labels ("3 months ago", "10 days left") and whether a recipe was cooked today (COOK-8).

## Trash cleanup

A Container Apps Job runs once a day. It finds recipes whose `removalDueAt` has passed and removes each document, then its photos
from Blob Storage, in that order, so a recipe that still exists never loses its photos. It also deletes photo files more
than a day old that no recipe refers to, which can be left behind when two photo changes to the same recipe overlap (last save
wins, X-5, withdrawn). Running daily satisfies REC-16's "within one day". Restores after the deadline are already refused by the
domain, so a recipe waiting for cleanup can't come back.

Safety rules for the job, because it deletes data permanently:
- It runs with production settings and refuses to start without them; it never creates databases or containers outside local
  development. Development or test mode is refused on Container Apps, including Container Apps Jobs (`CONTAINER_APP_JOB_NAME`).
- A recipe is removed only if it is unchanged since the job read it (a delete conditional on the document's version), so a restore
  that lands at the last moment always wins.
- The orphan sweep considers only names of the form `photos/{recipeId}/...`, skips the sweep if listing recipes or images fails,
  and deletes nothing if it finds more than 10 orphans (a sign of misconfiguration, such as pointing at the wrong database); that
  case is reported as a failure.
- Known limits: if Blob Storage refuses deletes for days, photos of removed recipes pile up; once more than 10, the sweep stops
  deleting and the job reports a failure every day until someone looks. Nothing wrong is deleted. The job must always be
  configured with the production database and the production storage together; pointing it at a copy of the database with
  production storage could remove photos of recipes that are past due only in the copy.

## Sent shopping lists

PLAN-9 lets an editor send the shopping list as a link that works for 7 days without signing in. The link is live: it shows
the current shopping list, so only the link itself is stored.

- `POST /plan/shopping-list/shares` follows "How a change is applied": editor check, the stored recipes, one domain call
  (`ShoppingListLink.create`, which refuses an empty plan) with the server's time and a code the server makes
  (`crypto.randomBytes`, 128 bits, base64url), then the snapshot is saved. The body must be `{}`, so the client can't supply
  the code or a time.
- Each link is one document in the `shopping-lists` container, partitioned by `/id` (the code): `{ id, createdAt, ttl }` and
  nothing of the list. It is written once, with `create`, so a link is never replaced.
- Removal: the container has Cosmos DB time to live switched on with no default (`defaultTtl: -1`), and each document carries
  `ttl` = its 7 days plus one hour, counted from the write, which is when the link was made. Cosmos DB stops returning it at
  that point and deletes it in the background, within a day after the link stops working. Until then the domain
  (`isAvailable`, by the server's clock) already refuses it, so the margin only guards against the database's clock running a
  little ahead. The trash cleanup job is not involved.
- `GET /shopping-lists/{token}` needs no sign-in and answers everyone alike. It reads the link, checks `isAvailable` by the
  server's clock, then builds the list with `shoppingList` from the stored recipes, as `GET /plan/shopping-list` does; an empty
  plan gives an empty list. An expired, unknown or malformed code gets the same 404. The answer has `Cache-Control: no-store`
  and `Referrer-Policy: no-referrer`.
- The code is the only key, so it is kept out of logs: the API's request log writes the path as `/shopping-lists/[redacted]`
  (`http/request-log.ts`). The client's page for it, `/list/{token}`, is served by Static Web Apps with
  `Referrer-Policy: no-referrer` (`staticwebapp.config.json`). That page loads the list again when the person comes back to
  it (window focus or the tab becoming visible) and on reload. A 404 then shows the expired page in place of the list; any
  other failed reload keeps the last list and its ticks, with a note that it couldn't be refreshed.
- Locally the container is created on first run like the recipes container (`openStorage`); deployed, it comes from
  `infra/main.bicep` and its name from `COSMOS_SHOPPING_LIST_CONTAINER`. It shares the database's free throughput.

## Recipe import

IMP-1 to IMP-12: 1 to 4 photos of one recipe become one recipe, read by an AI model in the background. Reading takes 30
seconds to 2 minutes, longer than a request should stay open, and the API scales to zero, so the work runs in a Container
Apps job started by a queue message, not in the API.

```
client --POST /imports (photos)--> API --> Blob imports/{importId}/{n}.jpg, Cosmos import record, Storage queue message
                                                   |
Container Apps job (started by the queue) <--------+
  read photos -> AI model (JSON) -> domain -> save recipe and its photo -> end the import, delete the page photos
```

- Starting (`POST /imports`): editor check (X-6), then at most 4 file parts, then the same type and size checks as a recipe
  photo for each (IMP-2, REC-7). Each image goes through the existing decode worker, one after another, which applies the
  camera's rotation and then the editor's `rotations` turn (IMP-1), removes all metadata and scales it to at most 2048 px on
  the long side, so the model gets upright pages, no location reaches the AI service, and the call stays small. The client
  only shows the turn (a CSS rotation of the preview) and sends the numbers; it never re-encodes a photo.
  They are stored as `imports/{importId}/{n}.jpg` (n from 1, in the order added) in the photo container. If any photo is
  refused or can't be stored, the ones already stored are deleted and no import starts. The photo route serves only recipe
  photos by recipe ID, so these are never served (IMP-12). Like every upload, it must carry the `X-Requested-By` header (see
  "Sign-in"). The request body limit is 4 photos of 15 MB plus the form's overhead.
- Records (IMP-3): each import is one document in a new `imports` container, partitioned by `/id` (the import ID): the
  `RecipeImport` snapshot (domain-model.md), written with `create`. Any number can be in progress at once. Each document also
  carries `ttl` (one day, with Cosmos DB time to live switched on and no default, as for shopping list links), so finished
  imports disappear on their own; `GET /imports` lists what is left.
- Order when starting: the photos, then the record, then the queue message. If the photos or record can't be stored, nothing
  is left behind and the API answers with an error, so the editor stays on the form (IMP-4). If the message can't be queued,
  the record is marked failed, the photos are deleted, and the API answers 500, with the same result for the editor. That is
  logged as an ordinary server error with the import ID, not as `recipe-import-failed`, since nothing was read (IMP-11).
- The job (`caj-recipebox-import`) is event-driven: a KEDA Azure Queue scaler on the `imports` queue, signed in with the
  managed identity, one execution per message, at most 5 at a time, a 10-minute replica timeout and no retries (IMP-11,
  retrying is out of scope).
  It reads the record and the photos (every `imports/{importId}/` blob, in order), sends them to the model in one request,
  and turns the answer into a recipe:
  - The answer is untrusted input, like a request body: it is parsed against the expected shape, then the recipe is made with
    the same domain method as `POST /recipes`, with the server's time. Tags are filtered by a domain function to tags already in
    use, at most 5 (IMP-8). A domain refusal ends the import as `invalid-recipe` (IMP-7). The model's JSON is never stored.
  - The recipe's ID is derived from the import ID and the recipe is written with `create`, so a message delivered twice can't
    add the recipe twice.
  - The dish picture (IMP-9): the model returns which photo it is on (from 1) and a box around it as fractions of that image.
    The job crops that area from that page photo and stores it through the same code as an uploaded recipe photo. A box that
    is missing, names a photo that doesn't exist, or is too small for a thumbnail means no photo.
  - Then the record is set to `done` with the recipe's ID and name, or `failed`, and the page photos are deleted (IMP-12). A
    lifecycle rule on the storage account deletes any `imports/` blob older than one day, which covers a job that stopped
    partway. The trash cleanup's orphan sweep only considers `photos/{recipeId}/...`, so it never touches imports.
- Failures (IMP-11) are one pino line at level `error`: `{ "event": "recipe-import-failed", "importId", "reason", "detail"? }`,
  with no image, recipe text or identity. To find them, query `ContainerAppConsoleLogs_CL` in `log-recipebox` for
  `recipe-import-failed` (`infra/README.md`). No alert rule (owner decision, 2026-11-07).
- The model: `gpt-5.4-mini` (version 2026-03-17), one deployment in an Azure AI Foundry resource in `infra/main.bicep`, SKU
  `DataZoneStandard` (US data zone; the subscription has no global quota for it), called through the OpenAI-compatible v1
  endpoint with the `openai` client and the managed identity (no key), with strict structured output so the answer always
  has the expected shape. The schema is built for each call, and its tags field allows only the tags in use, as an enum. The
  prompt and schema live in one server file; the model is behind an interface, so tests use a fake and never call Azure.
- Model choice (owner decision, 2026-11-07, from a trial on 6 real recipes): upright, `gpt-5.4-mini` read cards almost word
  for word in 6 to 14 seconds, with about 2,000 to 3,000 input and under 1,000 output tokens per recipe. Sideways or upside
  down, it invented or garbled recipes, and asking it to reason harder or to say which way a photo was turned didn't fix that
  reliably. Hence the Rotate button (IMP-1). Its dish-picture boxes found the right picture but cropped loosely. Claude
  models couldn't be compared: the subscription has no Claude quota. If one is used later, its structured output needs
  "or null" written as `anyOf`, not `type: [..., "null"]`.
- The client: `GET /imports` (editor-only, X-1) lists the imports of the last day. The Catalog shows one card per import that
  is `reading` (IMP-5) and, while there is one, checks again every 5 seconds. The device that started an import keeps its
  `importId`; when that import turns `done`, it shows "‹name› imported" with Open (IMP-10). A `failed` import's card just goes
  away.
- Access: the identity also needs Storage Queue Data Message Sender, Processor and Reader on the `imports` queue, and
  Cognitive Services OpenAI User on the Foundry resource to call the model. Reader is for the job's KEDA trigger: its
  default count of waiting messages reads the queue's metadata, which the other two roles don't allow (owner decision,
  2026-11-07). The deploy identity may assign only the roles listed in `bootstrap.bicep`, so the owner reruns the bootstrap
  once to allow these.
- Locally: Azurite provides the queue, and a development-only fake model returns a fixed recipe, so the whole flow runs
  without Azure.

## Backups

Cosmos DB keeps continuous backups for 7 days (point-in-time restore), and Blob Storage keeps deleted photos for 7 days (soft
delete). Both are free at this size. A restore is done by hand from the Azure portal. Removal under REC-16 doesn't reach these
copies; they expire on their own (REC-16).

## Testing

| Level      | Tool                        | What                                                                    |
| ---------- | --------------------------- | ----------------------------------------------------------------------- |
| Domain     | Vitest                      | Every rule, with `describe` blocks named by spec ID.                    |
| API        | Vitest + Fastify `inject()` | Routes on the in-memory repository; visitor/editor checks.              |
| Storage    | Vitest (`npm run test:int`) | Cosmos and Blob code against the emulators; same contract as in-memory. |
| Client     | Vitest + Testing Library    | Components and formatting (local dates, relative labels).               |
| End to end | Playwright (later)          | Main flows at phone and tablet sizes.                                   |

Local services: the Azure Cosmos DB emulator and Azurite (Blob Storage emulator), so no test touches Azure. Route tests use an
in-memory repository that passes the same contract tests as the Cosmos one, so `npm test` stays fast and needs no Docker; the
storage code itself is tested against the emulators with `npm run test:int`.

## Cost

| Service                      | Expected monthly cost                     |
| ---------------------------- | ----------------------------------------- |
| Static Web Apps (Free)       | $0                                        |
| Container Apps (Consumption) | $0 within the monthly free grant          |
| Cosmos DB (free tier)        | $0 within the free throughput and storage |
| Blob Storage                 | A few cents                               |
| AI model (Foundry)           | Pay per import; cents, depending on model |
| Storage queue                | A fraction of a cent                      |
| Domain name                  | About $12 per year                        |

## Open items

1. Microsoft issuer: editors sign in with personal Microsoft accounts only, so the issuer is the consumers tenant,
   `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` (owner decision). Confirm with a real sign-in.
2. Session length (X-9): confirm how the built-in auth's session cookie expires and whether active use extends it. If not, the
   client calls `/.auth/refresh` periodically, or the API issues its own sliding session.
3. Microsoft account IDs: confirm which identifier the built-in auth passes for personal Microsoft accounts and that it stays the
   same if the app registration is ever recreated. The Account page makes this easy to check.
4. Cosmos free tier: must be chosen when the account is created; only one free-tier account is allowed per subscription.
5. Import model (IMP-6): `gpt-5.4-mini` was chosen ("Recipe import"). Compare a stronger model (Claude Sonnet 5.5 or
   GPT-5.4) once the subscription has quota for one, especially on handwritten cards, which the trial didn't include.
