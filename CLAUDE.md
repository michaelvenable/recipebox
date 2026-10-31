# RecipeBox

A recipe app for one household: public recipes, private "to make" list, cooking history and trash. TypeScript everywhere;
React PWA on Azure Static Web Apps, Fastify API on Azure Container Apps, Cosmos DB, Blob Storage.

## Read before working

| File                   | What it is                                                               |
| ---------------------- | ------------------------------------------------------------------------ |
| `docs/specs/README.md` | Spec conventions and cross-cutting requirements (X-1 …)                  |
| `docs/specs/*.md`      | Requirements by area: REC (recipes), PLAN (to-make list), COOK (history) |
| `docs/domain-model.md` | Design of the domain package: classes, rules, snapshot shape             |
| `docs/architecture.md` | Hosting, sign-in, request flow, public vs. private data, testing         |

The specs are the source of truth. If code and spec disagree, the code is wrong or the spec needs the owner's decision.

## Rules

Specs
- Never change a spec as part of a code change. If a spec is wrong, unclear or missing a case, stop and raise it with the owner.
- Cite requirement IDs (e.g. `REC-11`, `X-12`) in tests, in comments that explain a rule, and in commit messages.
- "Out of scope" sections are binding. Don't build or flag what they exclude. Requirements marked (withdrawn) are retired.

Architecture
- Business rules live only in `packages/domain`. The server and client call the domain; they don't re-implement its rules.
- `packages/domain` has no dependencies: no database, HTTP, file system or clock.
- Dependency direction: `client -> shared`; `server -> shared, domain`. The client never imports the server.
- Every change on the server: check the caller is an editor, read the stored recipe, apply one domain method, save the snapshot.
  Never save a document sent by the client.
- Every stored time comes from the server's clock, passed to the domain as an `Instant`. Never use a time from a request (X-12).
- Visitors receive only `PublicRecipe`. To-make status, cooking history and the trash, including photos of trashed recipes, are
  editor-only and must never appear in a visitor response (X-1).
- Editors are identified by provider + permanent account ID from the `EDITORS` setting, never by email (X-7).
- Identity headers (`X-MS-CLIENT-PRINCIPAL-*`) are trusted only when running behind Container Apps authentication.
- Changes are `POST`/`PUT`/`DELETE` with a JSON body; `GET` never changes anything (CSRF protection, see architecture.md).

Code
- TypeScript in strict mode. Domain objects are classes with private state; value objects are immutable and always valid.
- Expected failures (validation, rule violations) return a `Result`; exceptions are only for bugs.
- Match the style of the surrounding code. Keep comments for the why, not the what.

Tests
- Vitest everywhere. Domain tests group rules in `describe` blocks named by spec ID, e.g. `describe("REC-11 tag rules")`.
- Every requirement implemented gets at least one test that would fail if it were broken. Use the specs' examples tables.
- Tests never touch Azure. Use the Cosmos DB emulator, Azurite and the development sign-in stub.

Git
- The main branch is `master`. Don't commit or push unless the owner asks.
- Commit messages say what changed and cite the requirement IDs involved.

## Development workflow

Work is done in small tasks, each a list of requirement IDs. Each task goes through three agents defined in `.claude/agents/`:

1. `author` implements the requirements with tests, until `npm test` and `npm run typecheck` pass.
2. `reviewer` reviews the change against the specs on `master` and reports findings. It has no access to the author's reasoning.
3. `verifier` checks each finding independently, in an isolated worktree, and tries to prove it with a failing test.
4. `author` fixes only the confirmed findings. Then the reviewer looks again. At most two review rounds per task.
5. The owner reviews the result, including any refuted or uncertain findings, and decides whether to commit.

Spec questions raised by any agent go to the owner; agents never resolve them by editing docs.

## Writing docs

- Wrap prose at about 130 characters per line.
- Align Markdown table columns in the raw text, and keep tables within 130 characters.
- Don't bold or italicize words for emphasis. Bold only labels that start a list item, such as requirement IDs.

## Reviewing changes

When reviewing code, check at least:
1. Does it do what the cited requirements say, including their examples? Does it break any other requirement?
2. Are rules in the domain, or have they leaked into routes or components?
3. Could any visitor-facing response contain private data (X-1)?
4. Is any stored time taken from a request instead of the server's clock (X-12)?
5. Is there a test for each requirement touched, and would it fail if the behavior broke?

Report findings with the file, the requirement ID, and a concrete scenario that goes wrong.
