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

| Resource                       | Name                         | Notes                                                       |
| ------------------------------ | ---------------------------- | ----------------------------------------------------------- |
| User-assigned identity         | `id-recipebox`               | The API and the cleanup job; data roles only.               |
| Cosmos DB (free tier)          | `cosmos-recipebox-<suffix>`  | Database `recipebox` (1000 RU/s), container `recipes`.      |
| Storage account                | `strecipebox<suffix>`        | Private container `photos`; blob soft delete 7 days.        |
| Key Vault                      | `kv-recipebox-<suffix>`      | The two sign-in provider client secrets, added by hand.     |
| Log Analytics                  | `log-recipebox`              | 30 days; 0.15 GB a day cap.                                 |
| Container Apps environment     | `cae-recipebox`              | Consumption only.                                           |
| Container app                  | `ca-recipebox-api`           | The API; 1 CPU, 2 GiB; 0 to 1 replica.                      |
| Container Apps job             | `caj-recipebox-cleanup`      | Daily trash cleanup at 09:00 UTC.                           |
| Static Web App (Free)          | `swa-recipebox`              | The client.                                                 |

`<suffix>` is derived from the resource group and stays the same on every deployment.

## 1. Bootstrap (once)

Needs an account that is Owner (or User Access Administrator and Contributor) on the subscription, and the Azure CLI. The
commands are written for PowerShell, where a backtick continues a line; in bash, use a backslash.

The `az provider register` line registers the resource providers the templates use. They are already registered on "Recipe
Box"; on a new subscription this is needed once, with your own sign-in, because the deploy identity can't register providers.

```
az login --tenant fbbd2f68-561d-464d-9599-e8050edbfa20
az account set --subscription c0b1d89e-4d9b-4e4c-a8ca-3e59fa697013
foreach ($p in "Microsoft.App", "Microsoft.DocumentDB", "Microsoft.Storage", "Microsoft.Web", "Microsoft.OperationalInsights",
  "Microsoft.ManagedIdentity", "Microsoft.KeyVault") { az provider register --namespace $p --wait }
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
  assigning or removing only the photo role and Key Vault Secrets User, only to managed identities or other service principals.

Running it again is safe. Note the three outputs for step 2.

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
| `GOOGLE_CLIENT_ID`        | With `ENABLE_AUTH`    | Google OAuth web client ID.                                     |
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

Until this step everyone is a visitor. Do it in this order; a deployment with `ENABLE_AUTH=true` fails if the secrets are missing.

1. Provider registrations, as in `docs/architecture.md` ("Sign-in", "Provider setup", steps 1 to 4), with the redirect URIs
   `https://api.recipes.mikevenable.net/.auth/login/aad/callback` and
   `https://api.recipes.mikevenable.net/.auth/login/google/callback`.
2. Allow yourself to write the Key Vault's secrets (the vault uses Azure RBAC, so being Owner isn't enough). Find the vault's
   name in the run's summary or with `az keyvault list --resource-group rg-recipebox-prod --query "[].name" -o tsv`, then:

   ```
   az keyvault show --name <vault name> --query id -o tsv
   az ad signed-in-user show --query id -o tsv
   az role assignment create --role "Key Vault Secrets Officer" --scope <vault id> `
     --assignee-object-id <your object id> --assignee-principal-type User
   ```

3. Add the two client secrets to the vault, with exactly these names. The portal (Key vault, Secrets, Generate/Import) keeps the
   values out of your shell history.
   - `microsoft-provider-authentication-secret`: the Entra client secret.
   - `google-provider-authentication-secret`: the Google client secret.
4. Set the variables and deploy. The Microsoft issuer defaults to the consumers tenant (open item 1 in
   `docs/architecture.md`); set `MICROSOFT_OPENID_ISSUER` only to override it.

   ```
   gh variable set MICROSOFT_CLIENT_ID --repo michaelvenable/recipebox --body <application (client) ID>
   gh variable set GOOGLE_CLIENT_ID --repo michaelvenable/recipebox --body <client ID>
   gh variable set ENABLE_AUTH --repo michaelvenable/recipebox --body true
   gh workflow run deploy.yml --repo michaelvenable/recipebox
   ```

The deployment turns on the auth layer (both providers, unauthenticated access allowed, `https://recipes.mikevenable.net` as an
allowed redirect target) before it sets `TRUST_AUTH_HEADERS=true` on the API, so identity headers are never trusted without it.
Session length is left at the defaults (open item 2).

Renewing a client secret (the Entra one expires): add a new version of the same secret in the vault. The app picks it up within
30 minutes.

## 7. Editors

Sign in on the app and open the Account page (X-11); it shows your provider and account ID. Then:

```
gh variable set EDITORS --repo michaelvenable/recipebox --body "aad:<id>,google:<id>"
gh workflow run deploy.yml --repo michaelvenable/recipebox
```

`EDITORS` is configuration (X-7): editors are identified by provider and account ID, never by email.

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
