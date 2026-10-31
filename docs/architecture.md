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
| Database       | Cosmos DB, free tier, one `recipes` container               | One recipe per document; free at this size.    |
| Photos         | Blob Storage, private container, served by the API          | API can hide trashed recipes' photos (X-1).    |
| Client hosting | Static Web Apps, Free plan                                  | Free CDN, HTTPS and custom domain.             |
| API hosting    | Container Apps, Consumption plan, scale to zero             | Free grant; a few seconds' cold start is fine. |
| Sign-in        | Container Apps built-in authentication                      | Microsoft and Google built in, at no cost.     |
| Domain names   | `recipes.mikevenable.net` and `api.recipes.mikevenable.net` | Same site, so Safari keeps the cookie.         |
| Trash cleanup  | Container Apps Job, once a day                              | Removes documents and photos (REC-16).         |

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
- Tests check every visitor-facing endpoint for the absence of private fields. This is a likely place for a leak, so reviewers
  should check it on every change that touches responses.

## Sign-in

Container Apps' built-in authentication runs in front of the API as a separate container. It handles the Microsoft and Google
sign-in pages, manages the session cookie, and passes the signed-in identity to the API in `X-MS-CLIENT-PRINCIPAL-*` headers.
Outside requests cannot set those headers.

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
- `GET` requests never change anything.

Provider setup (done once, by hand):

| Step | Where                          | What                                                                                  |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | Microsoft Entra (Azure portal) | App registration allowing personal Microsoft accounts; ID tokens on; client secret.   |
| 2    | Microsoft Entra                | Add the Microsoft redirect URI (below).                                               |
| 3    | Google Cloud Console           | OAuth consent screen (External, testing mode); add each Google editor as a test user. |
| 4    | Google Cloud Console           | Web OAuth client with the Google redirect URI (below).                                |
| 5    | Container app, Authentication  | Add both providers (client IDs and secrets); allow unauthenticated access.            |
| 6    | Container app, Authentication  | Allow `https://recipes.mikevenable.net` as a post-sign-in redirect target.            |

Redirect URIs:
- Microsoft: `https://api.recipes.mikevenable.net/.auth/login/aad/callback`
- Google: `https://api.recipes.mikevenable.net/.auth/login/google/callback`

The client secrets are stored as secrets on the container app, never in the repository. The Entra secret expires (at most two
years) and must be renewed. Everything except steps 1–4 will be scripted with Bicep.

Editors (X-7):
- An editor is identified by the identity provider plus that provider's permanent account ID, never by email address.
- The editor list is the `EDITORS` setting on the container app, e.g. `google:1098…,aad:9f3c…`. It is configuration, not data: the
  app reads it but can never change it.
- The Account page (X-11) shows a signed-in person their provider and ID, so it can be added to `EDITORS`.

Local development and tests have no built-in auth layer. The server therefore accepts identity headers only when running on
Container Apps. Locally, a development-only sign-in stub (enabled by an environment variable, refused in production) lets tests
act as a visitor, an editor or a non-editor.

## Photos

- Upload: the client sends the image to the API (REC-7). The server checks type and size, applies the camera's rotation, converts
  HEIC to JPEG (most browsers can't display HEIC), creates a thumbnail, and stores both in Blob Storage.
- Display: the client loads photos from the API, never directly from storage. The API checks the recipe isn't in the trash (or the
  caller is an editor) and streams the image with cache headers.
- Replace and remove delete the previous images (REC-7). Permanent removal deletes them with the recipe (REC-16).

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

A Container Apps Job runs once a day. It finds recipes whose `removalDueAt` has passed, deletes their photos from Blob Storage,
then deletes the documents. Running daily satisfies REC-16's "within one day". Restores after the deadline are already refused by
the domain, so a recipe waiting for cleanup can't come back.

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
storage code itself is tested against the emulators with `npm run test:int`. *(proposed)*

## Cost

| Service                      | Expected monthly cost                     |
| ---------------------------- | ----------------------------------------- |
| Static Web Apps (Free)       | $0                                        |
| Container Apps (Consumption) | $0 within the monthly free grant          |
| Cosmos DB (free tier)        | $0 within the free throughput and storage |
| Blob Storage                 | A few cents                               |
| Domain name                  | About $12 per year                        |

## Open items

1. Microsoft issuer: confirm the issuer setting that lets personal Microsoft accounts sign in; it differs from the work-account
   default.
2. Session length (X-9): confirm how the built-in auth's session cookie expires and whether active use extends it. If not, the
   client calls `/.auth/refresh` periodically, or the API issues its own sliding session.
3. Microsoft account IDs: confirm which identifier the built-in auth passes for personal Microsoft accounts and that it stays the
   same if the app registration is ever recreated. The Account page makes this easy to check.
4. Cosmos free tier: must be chosen when the account is created; only one free-tier account is allowed per subscription.
