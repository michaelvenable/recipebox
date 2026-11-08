# Infrastructure

Bicep for RecipeBox in Azure, as described in `docs/architecture.md`, and the owner's steps to set it up. GitHub Actions
(`.github/workflows/deploy.yml`) deploys everything on each push to `master`; the steps below are the parts done once, by hand.

| File                            | What it is                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `bootstrap.bicep`               | Run once by the owner: resource groups, the custom photo role, the GitHub deploy identity.  |
| `main.bicep`                    | Everything else, deployed by the workflow into `rg-recipebox-prod`.                         |
| `modules/api-app.bicep`         | The API container app; `main.bicep` may apply it twice in one deployment.                   |
| `modules/deploy-identity.bicep` | The deploy identity and its GitHub sign-in rule.                                            |
| `modules/deploy-access.bicep`   | The deploy identity's roles on `rg-recipebox-prod`.                                         |
| `shared.bicep`                  | Values both templates must agree on.                                                        |

What `main.bicep` creates, all in `southcentralus` except the Static Web App (`centralus`; the Free plan isn't offered in
`southcentralus`):

| Resource                   | Name                        | Notes                                                                |
| -------------------------- | --------------------------- | -------------------------------------------------------------------- |
| User-assigned identity     | `id-recipebox`              | The API and both jobs; data roles only.                              |
| Cosmos DB (free tier)      | `cosmos-recipebox-<suffix>` | DB `recipebox` (1000 RU/s): `recipes`, `shopping-lists`, `imports`.  |
| Storage account            | `strecipebox<suffix>`       | Private container `photos`; soft delete 7 days; queue `imports`.     |
|                            |                             | Lifecycle rule: `photos/imports/` blobs deleted after a day.         |
| Azure AI Foundry           | `aif-recipebox-<suffix>`    | Keys off. Deployment `gpt-5.4-mini` (2026-03-17), DataZoneStandard,  |
|                            |                             | 50,000 tokens a minute.                                              |
| Key Vault                  | `kv-recipebox-<suffix>`     | Sign-in provider client secrets, added by hand.                      |
| Log Analytics              | `log-recipebox`             | 30 days; 0.15 GB a day cap.                                          |
| Container Apps environment | `cae-recipebox`             | Consumption only.                                                    |
| Container app              | `ca-recipebox-api`          | The API; 1 CPU, 2 GiB; 0 to 1 replica.                               |
| Container Apps job         | `caj-recipebox-cleanup`     | Daily trash cleanup at 09:00 UTC.                                    |
| Container Apps job         | `caj-recipebox-import`      | Recipe import: one execution per queued import, at most 5 at once.   |
| Static Web App (Free)      | `swa-recipebox`             | The client.                                                          |

`<suffix>` is derived from the resource group and stays the same on every deployment.

The commands in this README are written for PowerShell, where a backtick continues a line; in bash, use a backslash. In Git
Bash on Windows, also put `MSYS_NO_PATHCONV=1` before any command with a `--scope /subscriptions/...` argument (as in step 6),
or Git Bash turns the scope into a Windows file path.

## 1. Bootstrap (once)

Needs an account that is Owner (or User Access Administrator and Contributor) on the subscription, and the Azure CLI.

The `az provider register` line registers the resource providers the templates use. They are already registered on "Recipe
Box"; on a new subscription this is needed once, with your own sign-in, because the deploy identity can't register providers.

```
az login --tenant fbbd2f68-561d-464d-9599-e8050edbfa20
az account set --subscription c0b1d89e-4d9b-4e4c-a8ca-3e59fa697013
foreach ($p in "Microsoft.App", "Microsoft.DocumentDB", "Microsoft.Storage", "Microsoft.Web", "Microsoft.OperationalInsights",
  "Microsoft.ManagedIdentity", "Microsoft.KeyVault", "Microsoft.CognitiveServices") {
  az provider register --namespace $p --wait
}
az deployment sub create --name recipebox-bootstrap --location southcentralus --template-file infra/bootstrap.bicep `
  --query properties.outputs
```

It creates:
- `rg-recipebox-prod`, the app's resource group.
- `rg-recipebox-deploy` with `id-recipebox-github`, the identity GitHub Actions signs in as. It accepts only GitHub tokens for
  `repo:michaelvenable@1676614/recipebox@1448964827:ref:refs/heads/master`, so only workflow runs on `master` can deploy. GitHub
  includes the owner's and repository's numeric IDs in the subject, so a repository recreated under the same name can't deploy.
  It sits in its own resource group so it can't change its own sign-in rule.
- The custom role "RecipeBox Photo Container Data", assignable only within `rg-recipebox-prod`.
- The deploy identity's roles on `rg-recipebox-prod`: Contributor, and Role Based Access Control Administrator limited to
  assigning or removing only the roles `main.bicep` gives the app identity, and only to managed identities or other service
  principals: the photo role, Key Vault Secrets User, Storage Queue Data Message Sender, Storage Queue Data Message Processor,
  Storage Queue Data Reader and Cognitive Services OpenAI User.

Running it again is safe. Note the three outputs for step 2.

Run it again whenever that list of roles changes, before pushing the change that assigns a new role; otherwise the
deployment fails when it tries to assign it. The recipe import added the three queue roles and Cognitive Services OpenAI
User, so on a subscription bootstrapped before it, run the `az deployment sub create` line above once, signed in as above,
before pushing the import's infrastructure to `master`.

## 2. GitHub variables

Variables, not secrets: OpenID Connect needs no secret. With the GitHub CLI, using the outputs from step 1:

```
gh variable set AZURE_CLIENT_ID --repo michaelvenable/recipebox --body <AZURE_CLIENT_ID output>
gh variable set AZURE_TENANT_ID --repo michaelvenable/recipebox --body fbbd2f68-561d-464d-9599-e8050edbfa20
gh variable set AZURE_SUBSCRIPTION_ID --repo michaelvenable/recipebox --body c0b1d89e-4d9b-4e4c-a8ca-3e59fa697013
```

All the variables the workflow reads:

| Variable                  | When                  | Value                                                           |
| ------------------------- | --------------------- | --------------------------------------------------------------- |
| `AZURE_CLIENT_ID`         | Always                | Bootstrap output.                                               |
| `AZURE_TENANT_ID`         | Always                | Bootstrap output.                                               |
| `AZURE_SUBSCRIPTION_ID`   | Always                | Bootstrap output.                                               |
| `BIND_CUSTOM_DOMAINS`     | From step 5           | `true`. Keep it on afterwards.                                  |
| `ENABLE_AUTH`             | From step 6           | `true`.                                                         |
| `MICROSOFT_CLIENT_ID`     | With `ENABLE_AUTH`    | Entra app registration's Application (client) ID.               |
| `MICROSOFT_OPENID_ISSUER` | Optional              | Overrides the default consumers-tenant issuer (step 6).         |
| `GOOGLE_CLIENT_ID`        | For Google sign-in    | Google OAuth web client ID; adds Google sign-in (step 6).       |
| `EDITORS`                 | From step 7           | `provider:accountId` entries, comma-separated (X-7).            |

## 3. First deployment

Push to `master`, or run the workflow by hand: `gh workflow run deploy.yml --repo michaelvenable/recipebox`.

The first run stops at "Check the image can be pulled anonymously": GitHub creates the `recipebox-server` package private, and
Container Apps pulls without credentials. Make it public once: GitHub, your profile, Packages, `recipebox-server`, Package
settings, Change visibility, Public. Then re-run the failed jobs.

The run then deploys everything without custom domains or sign-in. The app answers on its default addresses, shown in the run's
summary. The client is built to call `https://api.recipes.mikevenable.net`, so it can't reach the API until step 5.

If the first deployment reports the API or job failing to start, re-run it: the identity's new roles can take a few minutes to
apply.

## 4. DNS records (Route 53, by hand)

The run's summary lists the three records, also available with:

```
az deployment group list --resource-group rg-recipebox-prod `
  --query "sort_by([], &properties.timestamp)[-1].properties.outputs.dnsRecords.value" -o table
```

| Type  | Name                                | Value                                                                      |
| ----- | ----------------------------------- | -------------------------------------------------------------------------- |
| CNAME | `recipes.mikevenable.net`           | The Static Web App's default hostname (`<name>.azurestaticapps.net`).      |
| CNAME | `api.recipes.mikevenable.net`       | The container app's default hostname (`...azurecontainerapps.io`).         |
| TXT   | `asuid.api.recipes.mikevenable.net` | The domain verification ID. Route 53 needs it in double quotes: `"<id>"`.  |

A TTL of 300 seconds is fine. If `mikevenable.net` has CAA records, they must also allow `digicert.com`, which issues both
managed certificates. Check the records have spread before step 5:

```
nslookup -type=CNAME recipes.mikevenable.net
nslookup -type=CNAME api.recipes.mikevenable.net
nslookup -type=TXT asuid.api.recipes.mikevenable.net
```

## 5. Custom domains (second deployment)

```
gh variable set BIND_CUSTOM_DOMAINS --repo michaelvenable/recipebox --body true
gh workflow run deploy.yml --repo michaelvenable/recipebox
```

This binds both hostnames with free managed certificates. For the API it adds the hostname, waits for the certificate, then
binds it; issuing can take several minutes. Later runs find the certificate issued and keep the binding as it is. Leave the
variable on: with it off, a deployment removes the bindings.

Check `https://recipes.mikevenable.net` loads and `https://api.recipes.mikevenable.net/health` answers `{"status":"ok"}`.

## 6. Sign-in

Until this step everyone is a visitor. Microsoft and Google sign-in are both offered (X-7); Microsoft is set up first and
Google added after it (below). Do it in this order; a deployment with `ENABLE_AUTH=true` fails if the secret is missing.

1. The Microsoft registration, as in `docs/architecture.md` ("Sign-in", "Provider setup", steps 1 and 2), with the redirect URI
   `https://api.recipes.mikevenable.net/.auth/login/aad/callback`.
2. Allow yourself to write the Key Vault's secrets (the vault uses Azure RBAC, so being Owner isn't enough). Find the vault's
   name in the run's summary or with `az keyvault list --resource-group rg-recipebox-prod --query "[].name" -o tsv`, then:

   ```
   az keyvault show --name <vault name> --query id -o tsv
   az ad signed-in-user show --query id -o tsv
   az role assignment create --role "Key Vault Secrets Officer" --scope <vault id> `
     --assignee-object-id <your object id> --assignee-principal-type User
   ```

3. Add the Entra client secret to the vault as `microsoft-provider-authentication-secret`, exactly that name. The portal (Key
   vault, Secrets, Generate/Import) keeps the value out of your shell history.
4. Set the variables and deploy. The Microsoft issuer defaults to the consumers tenant (open item 1 in
   `docs/architecture.md`); set `MICROSOFT_OPENID_ISSUER` only to override it.

   ```
   gh variable set MICROSOFT_CLIENT_ID --repo michaelvenable/recipebox --body <application (client) ID>
   gh variable set ENABLE_AUTH --repo michaelvenable/recipebox --body true
   gh workflow run deploy.yml --repo michaelvenable/recipebox
   ```

The deployment turns on the auth layer (Microsoft, unauthenticated access allowed, `https://recipes.mikevenable.net` as an
allowed redirect target) before it sets `TRUST_AUTH_HEADERS=true` on the API, so identity headers are never trusted without it.
Session length is left at the defaults (open item 2).

Adding Google needs no code change. Do the Google registration (`docs/architecture.md`, "Provider setup", steps 3 and 4,
redirect URI `https://api.recipes.mikevenable.net/.auth/login/google/callback`), add the Google client secret to the vault as
`google-provider-authentication-secret`, then set the variable and deploy:

```
gh variable set GOOGLE_CLIENT_ID --repo michaelvenable/recipebox --body <client ID>
gh workflow run deploy.yml --repo michaelvenable/recipebox
```

With `GOOGLE_CLIENT_ID` set, the deployment adds Google to the auth layer and the Google secret reference to the API, and builds
the client with a "Sign in with Google" button. Without it, the vault needs no Google secret. Add the secret before setting the
variable: the deployment fails if it is missing. The first deployment with Google adds the secret reference to the API before
the auth layer names it, as when sign-in was first turned on; editors may be visitors for a moment while it runs.

Renewing a client secret (the Entra one expires): add a new version of the same secret in the vault. The app picks it up within
30 minutes. The current Entra secret was created 2026-11-07 for 24 months, so it expires about 2028-11; renew it before then.

## 7. Editors

Sign in on the app and open the Account page (X-11); it shows your provider and account ID. Then:

```
gh variable set EDITORS --repo michaelvenable/recipebox --body "aad:<id>"
gh workflow run deploy.yml --repo michaelvenable/recipebox
```

`EDITORS` is configuration (X-7): editors are identified by provider and account ID, never by email. List several separated by
commas, e.g. `aad:<id>,aad:<id>`; once Google is added, `google:<id>` entries work too.

## Failed imports

A failed import (IMP-11) is one log line from `caj-recipebox-import` with `"event": "recipe-import-failed"`, the import's ID,
the reason and, for `service-error`, the reading service's message. Nothing alerts on it (owner decision). To list them, run
this query in `log-recipebox` (portal: the Log Analytics workspace, Logs):

```
ContainerAppConsoleLogs_CL
| where Log_s has "recipe-import-failed"
| extend line = parse_json(Log_s)
| project TimeGenerated, importId = tostring(line.importId), reason = tostring(line.reason), detail = tostring(line.detail)
| order by TimeGenerated desc
```

Or from the command line, with the workspace's ID from
`az monitor log-analytics workspace show --resource-group rg-recipebox-prod --name log-recipebox --query customerId -o tsv`:

```
az monitor log-analytics query --workspace <workspace ID> --timespan P7D `
  --analytics-query "ContainerAppConsoleLogs_CL | where Log_s has 'recipe-import-failed' | project TimeGenerated, Log_s"
```

Log lines arrive a few minutes after they are written.

## Deploying by hand

The workflow is the normal path. To deploy `main.bicep` yourself, pass the same parameters it does, including
`apiCertificateIssued` and `authAlreadyEnabled`, which it reads from Azure before each run (see the comments in `main.bicep`).

## Checking the templates

No test touches Azure. To compile and lint locally:

```
az bicep lint --file infra/main.bicep
az bicep lint --file infra/bootstrap.bicep
```

## Things to know

- Cosmos DB free tier is chosen when the account is created, and a subscription can have only one free-tier account (open item
  4). Continuous 7-day backup has no storage charge; an account can't go back to periodic backup.
- Keys are off on both data accounts. Nobody, including the owner, reads data with keys; use Entra ID roles if you ever need to.
- Deleted Key Vaults are kept for 90 days. Recreating the resource group within that time needs the old vault purged or
  recovered first.
- The $5 budget on the subscription is not managed here.
- The model deployment uses the subscription's DataZoneStandard quota for `gpt-5.4-mini` (50 of the 200 thousand tokens a
  minute available). A deployment fails if the quota isn't there. The model version stays at 2026-03-17 until Azure retires
  it, then moves to the default version.
- A deleted Foundry resource is kept, soft-deleted, for 48 hours with its name reserved. Recreating it within that time needs
  it purged first (`az cognitiveservices account purge`).
