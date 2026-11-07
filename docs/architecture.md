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
- The one exception is a sent shopping list (PLAN-9): anyone with its link gets `SharedShoppingList`, a copy of the shopping
  list's lines and the date the link stops working, and nothing else (see "Sent shopping lists").
- Tests check every visitor-facing endpoint for the absence of private fields. This is a likely place for a leak, so reviewers
  should check it on every change that touches responses.

## Sign-in

Container Apps' built-in authentication runs in front of the API as a separate container. It handles the Microsoft and Google
sign-in pages, manages the session cookie, and passes the signed-in identity to the API in `X-MS-CLIENT-PRINCIPAL-*` headers.
Outside requests cannot set those headers, but only while the auth layer is switched on: with it off, any request could claim to
be an editor. So the API trusts these headers only when it runs on Container Apps and the setting `TRUST_AUTH_HEADERS=true` is
present; the infrastructure script sets it in the same step that turns the auth layer on. Without it, everyone is a visitor.

For now only Microsoft is offered (X-7). Google stays in the design: the server still recognizes `google:` identities, and adding
it later takes the provider setup steps 3–4, its secret in the Key Vault and the `GOOGLE_CLIENT_ID` variable, with no code change.

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
- The one exception is the photo upload, `PUT /recipes/{id}/photo`, which is sent as `multipart/form-data`. That is safe only
  because it is a `PUT`: a cross-site form can only `POST`, and a cross-site `PUT` needs the API's permission first. The server
  refuses to start if the upload exception is put on any other method.
- CORS allows the methods the client actually uses: `GET`, `POST`, `PUT` and `DELETE`.
- `GET` requests never change anything.

Provider setup (done once, by hand):

| Step | Where                          | What                                                                                  |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | Microsoft Entra (Azure portal) | App registration allowing personal Microsoft accounts; ID tokens on; client secret.   |
| 2    | Microsoft Entra                | Add the Microsoft redirect URI (below).                                               |
| 3    | Google Cloud Console (later)   | OAuth consent screen (External, testing mode); add each Google editor as a test user. |
| 4    | Google Cloud Console (later)   | Web OAuth client with the Google redirect URI (below).                                |
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

PLAN-9 lets an editor send the shopping list as a link that works for 7 days without signing in.

- `POST /plan/shopping-list/shares` follows "How a change is applied": editor check, the stored recipes, one domain call
  (`SharedShoppingList.create`) with the server's time and a code the server makes (`crypto.randomBytes`, 128 bits, base64url),
  then the snapshot is saved. The body must be `{}`, so the client can't supply the list, the code or a time.
- Each list is one document in the `shopping-lists` container, partitioned by `/id` (the code). It is written once, with
  `create`, so a list is never replaced.
- Removal: the container has Cosmos DB time to live switched on with no default (`defaultTtl: -1`), and each document carries
  `ttl` = its 7 days plus one hour, counted from the write, which is when the list was made. Cosmos DB stops returning it at
  that point and deletes it in the background, within a day after the link stops working. Until then the domain
  (`isAvailable`, by the server's clock) already refuses it, so the margin only guards against the database's clock running a
  little ahead. The trash cleanup job is not involved.
- `GET /shopping-lists/{token}` needs no sign-in and answers everyone alike. An expired, unknown or malformed code gets the same
  404. The answer has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The code is the only key, so it is kept out of logs: the API's request log writes the path as `/shopping-lists/[redacted]`
  (`http/request-log.ts`). The client's page for it, `/list/{token}`, is served by Static Web Apps with
  `Referrer-Policy: no-referrer` (`staticwebapp.config.json`).
- Locally the container is created on first run like the recipes container (`openStorage`); deployed, it comes from
  `infra/main.bicep` and its name from `COSMOS_SHOPPING_LIST_CONTAINER`. It shares the database's free throughput.

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
| Domain name                  | About $12 per year                        |

## Open items

1. Microsoft issuer: editors sign in with personal Microsoft accounts only, so the issuer is the consumers tenant,
   `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` (owner decision). Confirm with a real sign-in.
2. Session length (X-9): confirm how the built-in auth's session cookie expires and whether active use extends it. If not, the
   client calls `/.auth/refresh` periodically, or the API issues its own sliding session.
3. Microsoft account IDs: confirm which identifier the built-in auth passes for personal Microsoft accounts and that it stays the
   same if the app registration is ever recreated. The Account page makes this easy to check.
4. Cosmos free tier: must be chosen when the account is created; only one free-tier account is allowed per subscription.
