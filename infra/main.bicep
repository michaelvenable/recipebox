// RecipeBox in Azure (docs/architecture.md): the API, the daily trash cleanup and the queue-started recipe import on Container
// Apps, Cosmos DB, Blob Storage and Queue Storage, the reading model in Azure AI Foundry, the client on Static Web Apps.
// Deployed by .github/workflows/deploy.yml into the resource group bootstrap.bicep creates; the owner's steps are in
// infra/README.md.
//
// Two switches are off on the first deployment and turned on later, by the owner, through GitHub variables:
// - bindCustomDomains: binds recipes.mikevenable.net and api.recipes.mikevenable.net with free managed certificates. It needs
//   the DNS records from the dnsRecords output in place first (Route 53, by hand). Once on, keep it on.
// - enableAuth: Container Apps' built-in sign-in (docs/architecture.md, "Sign-in"), together with TRUST_AUTH_HEADERS=true. It
//   needs the Microsoft registration and its client secret in the Key Vault first. Google (X-7) is
//   added only when googleClientId is set, and then needs its registration and secret too.

import {
  openAiUserRoleId
  photoRoleDefinitionName
  queueDataReaderRoleId
  queueMessageProcessorRoleId
  queueMessageSenderRoleId
} from 'shared.bicep'

@description('Region for everything except the Static Web App.')
param location string = resourceGroup().location

@description('Region for the Static Web App; the Free plan isn\'t offered in every region.')
param staticWebAppLocation string = 'centralus'

@description('Server image repository (public, so no registry credentials).')
param imageRepository string = 'ghcr.io/michaelvenable/recipebox-server'

@description('Image tag to run: the commit SHA the workflow built.')
param imageTag string

@description('The client\'s hostname (Static Web App).')
param clientHostname string = 'recipes.mikevenable.net'

@description('The API\'s hostname (container app).')
param apiHostname string = 'api.recipes.mikevenable.net'

@description('Bind both custom hostnames with managed certificates. Only after the DNS records from the dnsRecords output exist.')
param bindCustomDomains bool = false

// Read from Azure by the workflow before each deployment; see "API custom domain" below.
@description('Whether the API\'s managed certificate has already been issued.')
param apiCertificateIssued bool = false

@description('Editors (X-7): comma-separated provider:accountId, e.g. "google:1098,aad:9f3c". Empty: nobody can edit.')
param editors string = ''

@description('Turn on Container Apps built-in authentication (Microsoft; Google if set) and TRUST_AUTH_HEADERS together.')
param enableAuth bool = false

// Read from Azure by the workflow before each deployment; see "Sign-in" below.
@description('Whether built-in authentication is already on for the API.')
param authAlreadyEnabled bool = false

@description('Application (client) ID of the Microsoft Entra app registration. Required when enableAuth is true.')
param microsoftClientId string = ''

// Editors sign in with personal Microsoft accounts only, so the default is the consumers tenant (docs/architecture.md, open
// item 1).
@description('OpenID issuer URL for the Microsoft provider.')
param microsoftOpenIdIssuer string = '${environment().authentication.loginEndpoint}9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'

@description('Client ID of the Google OAuth web client. Empty: no Google sign-in, and no Google secret needed in the vault.')
param googleClientId string = ''

@description('When the trash cleanup job runs, as a cron expression in UTC (docs/architecture.md, "Trash cleanup": once a day).')
param cleanupSchedule string = '0 9 * * *'

// 0.15 GB a day stays within the 5 GB a month that Log Analytics doesn't charge for.
@description('Daily Log Analytics ingestion cap in GB, a cost limit.')
param logDailyCapGb string = '0.15'

// Names: Microsoft Cloud Adoption Framework abbreviations. Cosmos DB, Storage and Key Vault names are global, so they carry a
// suffix derived from the resource group, the same on every deployment.
var suffix = take(uniqueString(resourceGroup().id), 8)
var identityName = 'id-recipebox'
var logAnalyticsName = 'log-recipebox'
var environmentName = 'cae-recipebox'
var apiAppName = 'ca-recipebox-api'
var cleanupJobName = 'caj-recipebox-cleanup'
var importJobName = 'caj-recipebox-import'
var cosmosAccountName = 'cosmos-recipebox-${suffix}'
var storageAccountName = 'strecipebox${suffix}'
var keyVaultName = 'kv-recipebox-${suffix}'
// Also its custom subdomain, which is global.
var foundryName = 'aif-recipebox-${suffix}'
var staticWebAppName = 'swa-recipebox'
// Named here and in the workflow, which checks whether it has been issued.
var apiCertificateName = 'cert-api-recipebox'

// What the server expects (packages/server/src/config.ts, recipes/cosmos-recipe-repository.ts, photos/blob-photo-store.ts).
var cosmosDatabaseName = 'recipebox'
var cosmosContainerName = 'recipes'
var cosmosShoppingListContainerName = 'shopping-lists'
var cosmosImportContainerName = 'imports'
var photoContainerName = 'photos'
var importQueueName = 'imports'
// The reading model (docs/architecture.md, "Recipe import": owner decision, 2026-11-07). The deployment is named after the
// model; its name is what the import job sends as the model (MODEL_DEPLOYMENT).
var modelName = 'gpt-5.4-mini'
var modelVersion = '2026-03-17'
var modelDeploymentName = modelName
var apiPort = 3000
var clientOrigin = 'https://${clientHostname}'
var image = '${imageRepository}:${imageTag}'

// Endpoint settings in the exact form config.ts accepts: https://<account>.<domain>, no port, path or trailing slash. Cosmos
// DB's documentEndpoint property has ":443/", so it isn't used.
var cosmosEndpoint = 'https://${cosmosAccount.name}.documents.azure.com'
var blobEndpoint = 'https://${storageAccount.name}.blob.${environment().suffixes.storage}'
var queueEndpoint = 'https://${storageAccount.name}.queue.${environment().suffixes.storage}'
// The OpenAI endpoint of the Foundry resource; the job adds /openai/v1/ (azure-openai-recipe-reader.ts).
var modelEndpoint = 'https://${foundry.properties.customSubDomainName}.openai.azure.com'

// ---------------------------------------------------------------------------------------------------------------------------
// Identity and data (docs/architecture.md, "Access to Cosmos DB and Blob Storage")
// ---------------------------------------------------------------------------------------------------------------------------

// One user-assigned identity for the API and the job, so its roles exist before either is first deployed.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: location
}

// Free tier (open item 4: only one per subscription, chosen at creation). Total throughput is capped at the free 1000 RU/s.
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2025-04-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    capacity: {
      totalThroughputLimit: 1000
    }
    // Keys switched off: only Entra ID (the managed identity) can reach the data, and only ARM can change databases and
    // containers.
    disableLocalAuth: true
    disableKeyBasedMetadataWriteAccess: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    // The 7-day continuous tier has no backup storage charge. An account can't go back from continuous to periodic.
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous7Days'
      }
    }
  }
}

// The free 1000 RU/s, shared by the database's containers.
resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2025-04-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    options: {
      throughput: 1000
    }
  }
}

// One recipe per document, partitioned by /id as ensureRecipeContainer creates it locally. Default indexing.
resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: {
      id: cosmosContainerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
    }
  }
}

// Sent shopping lists (PLAN-9; docs/architecture.md, "Sent shopping lists"), one per document, partitioned by /id (the link's
// code) as ensureShoppingListContainer creates it locally. Time to live is on with no default (-1): only documents with their
// own ttl expire, and the server gives each one its 7 days plus an hour, so Cosmos DB removes it within a day after the link
// stops working. Shares the database's free throughput.
resource cosmosShoppingListContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: cosmosDatabase
  name: cosmosShoppingListContainerName
  properties: {
    resource: {
      id: cosmosShoppingListContainerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
      defaultTtl: -1
    }
  }
}

// Imports (IMP-3; docs/architecture.md, "Recipe import"), one per document, partitioned by /id (the import's id) as
// ensureImportContainer creates it locally. Time to live is on with no default (-1), as for shopping lists: the server gives
// each record a ttl of one day, so finished imports disappear on their own. Shares the database's free throughput.
resource cosmosImportContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-04-15' = {
  parent: cosmosDatabase
  name: cosmosImportContainerName
  properties: {
    resource: {
      id: cosmosImportContainerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
        version: 2
      }
      defaultTtl: -1
    }
  }
}

// Cosmos DB Built-in Data Contributor, a data-plane role: read and write items, read metadata; no database or container
// management.
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2025-04-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, identity.id, 'cosmos-built-in-data-contributor')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: identity.properties.principalId
    scope: cosmosAccount.id
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

// Private: photos are read only through the API, which hides those of trashed recipes (X-1).
resource photoContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: photoContainerName
  properties: {
    publicAccess: 'None'
  }
}

// The custom role from bootstrap.bicep, on the photo container only.
var photoRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  photoRoleDefinitionName(subscription().subscriptionId)
)

resource photoContainerData 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(photoContainer.id, identity.id, photoRoleDefinitionId)
  scope: photoContainer
  properties: {
    roleDefinitionId: photoRoleDefinitionId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    description: 'RecipeBox API, trash cleanup and import job: photos.'
  }
}

// IMP-12: the page photos of an import, `imports/{importId}/{n}.jpg` in the photo container, are deleted by the import job
// when it ends. This rule deletes any left behind by a job that stopped partway, once they are more than a day old (the
// policy runs about once a day, so in practice within a day after that). The prefix includes the container and the trailing
// slash, so it can't match recipe photos, which are `photos/{recipeId}/...` in the same container, nor any other container.
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-import-page-photos'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${photoContainerName}/imports/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterCreationGreaterThan: 1
                }
              }
            }
          }
        }
      ]
    }
  }
  dependsOn: [
    photoContainer
  ]
}

// The queue that starts the import job (docs/architecture.md, "Recipe import"). Messages keep the default time to live.
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {}
}

resource importQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2025-01-01' = {
  parent: queueService
  name: importQueueName
  properties: {
    metadata: {}
  }
}

// The identity's roles on the import queue only (docs/architecture.md, "Recipe import"): the API sends a message for each
// import started; the import job takes and deletes one; the job's KEDA scaler reads how many are waiting, which needs
// Get Queue Metadata (queues/read) and Peek Messages, which neither message role allows.
var queueRoleIds = {
  sender: queueMessageSenderRoleId
  processor: queueMessageProcessorRoleId
  reader: queueDataReaderRoleId
}

resource importQueueRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in items(queueRoleIds): {
    name: guid(importQueue.id, identity.id, role.value)
    scope: importQueue
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role.value)
      principalId: identity.properties.principalId
      principalType: 'ServicePrincipal'
      description: 'RecipeBox API and import job: the imports queue (${role.key}).'
    }
  }
]

// ---------------------------------------------------------------------------------------------------------------------------
// Reading model (docs/architecture.md, "Recipe import")
// ---------------------------------------------------------------------------------------------------------------------------

// An Azure AI Foundry resource with one model deployment. Local auth (keys) is off: the import job signs in with the managed
// identity. The custom subdomain gives the https://<name>.openai.azure.com endpoint the job calls.
resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: foundryName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: foundryName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// DataZoneStandard: US data zone; the subscription has no global quota for this model. 50 = 50,000 tokens a minute, enough
// for 5 imports at once at about 3,000 to 4,000 tokens each (docs/architecture.md, "Recipe import", model choice). The
// version is the one the owner tried; it is kept until Azure retires it, then upgraded to the default.
resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: modelDeploymentName
  sku: {
    name: 'DataZoneStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, identity.id, openAiUserRoleId)
  scope: foundry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    description: 'RecipeBox import job: read recipes with the model deployment.'
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Sign-in provider secrets
// ---------------------------------------------------------------------------------------------------------------------------

// Holds the Microsoft client secret, and Google's if Google is on, which the owner adds by hand (infra/README.md). The container
// app reads them through Key Vault references with the app identity, so no secret value passes through this template or GitHub.
resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
  }
}

var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    description: 'RecipeBox API: sign-in provider client secrets.'
  }
}

// Secret names, the same in Key Vault and on the container app.
var microsoftSecretName = 'microsoft-provider-authentication-secret'
var googleSecretName = 'google-provider-authentication-secret'

// X-7: Google is turned on by setting googleClientId, with no code change. Without it the app has no reference to a Google
// secret, so none has to exist in the vault.
var googleSignIn = !empty(googleClientId)

var microsoftAuthSecret = {
  name: microsoftSecretName
  keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${microsoftSecretName}'
  identity: identity.id
}
var googleAuthSecret = {
  name: googleSecretName
  keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${googleSecretName}'
  identity: identity.id
}
var authSecrets = googleSignIn ? [microsoftAuthSecret, googleAuthSecret] : [microsoftAuthSecret]

// ---------------------------------------------------------------------------------------------------------------------------
// Container Apps
// ---------------------------------------------------------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json(logDailyCapGb)
    }
  }
}

// Consumption only: no workload profiles.
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: environmentName
  location: location
  properties: {
    zoneRedundant: false
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Settings for the API and both jobs (packages/server/src/config.ts). APP_ENV is deliberately unset: deployed mode, where
// every setting is required and keys are refused. CLIENT_ORIGIN is required in deployed mode even though the job doesn't
// serve requests.
var dataSettings = [
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
  { name: 'COSMOS_DATABASE', value: cosmosDatabaseName }
  { name: 'COSMOS_CONTAINER', value: cosmosContainerName }
  { name: 'COSMOS_SHOPPING_LIST_CONTAINER', value: cosmosShoppingListContainerName }
  { name: 'COSMOS_IMPORT_CONTAINER', value: cosmosImportContainerName }
  { name: 'STORAGE_BLOB_ENDPOINT', value: blobEndpoint }
  { name: 'STORAGE_QUEUE_ENDPOINT', value: queueEndpoint }
  { name: 'STORAGE_PHOTO_CONTAINER', value: photoContainerName }
  { name: 'STORAGE_IMPORT_QUEUE', value: importQueueName }
  { name: 'CLIENT_ORIGIN', value: clientOrigin }
]

// EDITORS is left out rather than set empty when there are none; both mean nobody can edit (X-7).
var editorSettings = empty(trim(editors)) ? [] : [{ name: 'EDITORS', value: trim(editors) }]

var apiSettings = concat(dataSettings, editorSettings, [{ name: 'PORT', value: string(apiPort) }])

// The import job also calls the model (loadReadingServiceConfig in config.ts); the API and the cleanup don't.
var importSettings = concat(dataSettings, [
  { name: 'MODEL_ENDPOINT', value: modelEndpoint }
  { name: 'MODEL_DEPLOYMENT', value: modelDeployment.name }
])

// The API trusts X-MS-CLIENT-PRINCIPAL-* headers only with this set, and only while the auth layer is on, since otherwise
// anyone could send them (docs/architecture.md, "Sign-in").
var trustAuthHeadersSetting = [{ name: 'TRUST_AUTH_HEADERS', value: 'true' }]

// API custom domain. A Container Apps managed certificate can only be issued for a hostname already on an app, so the first
// binding takes three steps: add the hostname with binding "Disabled" (apiAppPrepare), issue the certificate (apiCertificate),
// then bind it with SNI (apiApp). Once the certificate is issued, later deployments bind it directly in apiApp and skip the
// first two steps, so the binding never drops. The workflow reads whether it is issued (apiCertificateIssued); if that is
// wrongly false the three steps simply run again.
var apiCertificateId = resourceId(
  'Microsoft.App/managedEnvironments/managedCertificates',
  containerAppsEnvironment.name,
  apiCertificateName
)
var apiDomainBound = [{ name: apiHostname, bindingType: 'SniEnabled', certificateId: apiCertificateId }]
var apiDomainAdded = [{ name: apiHostname, bindingType: 'Disabled' }]
var issueApiCertificate = bindCustomDomains && !apiCertificateIssued

// Sign-in. The auth layer must be on before the app runs with TRUST_AUTH_HEADERS=true, or for a moment anyone could claim to
// be an editor. So apiAppPrepare never sets TRUST_AUTH_HEADERS, whatever authAlreadyEnabled says: it adds the Key Vault
// secret references, authConfig turns the layer on, and only then apiApp sets TRUST_AUTH_HEADERS. authAlreadyEnabled, read by
// the workflow, only decides whether apiAppPrepare is needed for sign-in. If it is wrong, editors are at worst visitors for a
// moment while apiAppPrepare runs; headers are never trusted without the auth layer. The workflow also passes false when
// googleClientId is set but the stored configuration has no Google yet (X-7), so the Google secret reference is on the app
// before authConfig names it.
var turnOnAuth = enableAuth && !authAlreadyEnabled

var prepareApiApp = issueApiCertificate || turnOnAuth

module apiAppPrepare 'modules/api-app.bicep' = if (prepareApiApp) {
  name: 'api-app-prepare'
  params: {
    name: apiAppName
    location: location
    environmentId: containerAppsEnvironment.id
    identityId: identity.id
    image: image
    targetPort: apiPort
    env: apiSettings
    secrets: enableAuth ? authSecrets : []
    customDomains: bindCustomDomains ? (apiCertificateIssued ? apiDomainBound : apiDomainAdded) : []
  }
  dependsOn: [
    cosmosDataContributor
    photoContainerData
    keyVaultSecretsUser
    cosmosContainer
    cosmosShoppingListContainer
    cosmosImportContainer
    importQueueRoles
  ]
}

resource apiCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2025-01-01' = if (issueApiCertificate) {
  parent: containerAppsEnvironment
  name: apiCertificateName
  location: location
  properties: {
    subjectName: apiHostname
    // The hostname is a CNAME to the app (dnsRecords output).
    domainControlValidation: 'CNAME'
  }
  dependsOn: [
    apiAppPrepare
  ]
}

// Refers to the app the modules deploy, so the auth configuration can be its child.
resource apiAppResource 'Microsoft.App/containerApps@2025-01-01' existing = {
  name: apiAppName
}

resource authConfig 'Microsoft.App/containerApps/authConfigs@2025-01-01' = if (enableAuth) {
  parent: apiAppResource
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    // "Allow unauthenticated access": visitors read public recipes; the API decides what needs an editor.
    globalValidation: {
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    // Google only when googleClientId is set (X-7).
    identityProviders: union(
      {
        azureActiveDirectory: {
          enabled: true
          registration: {
            clientId: microsoftClientId
            clientSecretSettingName: microsoftSecretName
            openIdIssuer: microsoftOpenIdIssuer
          }
        }
      },
      googleSignIn
        ? {
            google: {
              enabled: true
              registration: {
                clientId: googleClientId
                clientSecretSettingName: googleSecretName
              }
            }
          }
        : {}
    )
    // Sign-in returns to the API's own /signed-in path, which needs no entry here (X-8); the client's origin is listed for
    // sign-out's post_logout_redirect_uri.
    login: {
      allowedExternalRedirectUrls: [
        clientOrigin
      ]
      // X-9: a session lasts 30 days. The cookie is still a browser-session cookie, deleted when the browser closes whatever
      // this says; the client signs the editor in again automatically to make up for it (X-16; architecture.md, "Sign-in").
      cookieExpiration: {
        convention: 'FixedTime'
        timeToExpiration: '30.00:00:00'
      }
    }
  }
  dependsOn: [
    apiAppPrepare
  ]
}

module apiApp 'modules/api-app.bicep' = {
  name: 'api-app'
  params: {
    name: apiAppName
    location: location
    environmentId: containerAppsEnvironment.id
    identityId: identity.id
    image: image
    targetPort: apiPort
    env: enableAuth ? concat(apiSettings, trustAuthHeadersSetting) : apiSettings
    secrets: enableAuth ? authSecrets : []
    customDomains: bindCustomDomains ? apiDomainBound : []
  }
  dependsOn: [
    cosmosDataContributor
    photoContainerData
    keyVaultSecretsUser
    cosmosContainer
    cosmosShoppingListContainer
    cosmosImportContainer
    importQueueRoles
    apiCertificate
    authConfig
  ]
}

// Daily trash cleanup (docs/architecture.md, "Trash cleanup"; REC-16): the same image with the cleanup command from the
// Dockerfile, the same identity and data settings.
resource cleanupJob 'Microsoft.App/jobs@2025-01-01' = {
  name: cleanupJobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cleanupSchedule
        parallelism: 1
        replicaCompletionCount: 1
      }
      // A run takes seconds for a household's recipes; the limits only bound what a stuck or failing run can cost. One retry
      // covers a passing fault; anything else waits for the next day's run.
      replicaTimeout: 600
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: 'cleanup'
          image: image
          command: [
            'node'
            '--enable-source-maps'
            'dist/cleanup.js'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: dataSettings
        }
      ]
    }
  }
  dependsOn: [
    cosmosDataContributor
    photoContainerData
    cosmosContainer
    cosmosShoppingListContainer
    cosmosImportContainer
  ]
}

// Recipe import (docs/architecture.md, "Recipe import"; IMP-6 to IMP-12): the same image with the import command from the
// Dockerfile, started by KEDA's Azure Queue scaler, which signs in with the same identity (no connection string). One
// execution per message, at most 5 at a time. Each execution takes one message and exits; an import ends within its 10
// minutes (IMP-11), so the replica timeout matches, and a failed import is never retried.
resource importJob 'Microsoft.App/jobs@2025-01-01' = {
  name: importJobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      triggerType: 'Event'
      eventTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 5
          rules: [
            {
              name: 'imports-queue'
              type: 'azure-queue'
              metadata: {
                accountName: storageAccount.name
                queueName: importQueue.name
                queueLength: '1'
              }
              identity: identity.id
            }
          ]
        }
      }
      replicaTimeout: 600
      replicaRetryLimit: 0
    }
    template: {
      containers: [
        {
          name: 'import'
          image: image
          command: [
            'node'
            '--enable-source-maps'
            'dist/import.js'
          ]
          // Pages are at most 2048 px, so the dish picture's decode needs far less than the API's uploads.
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: importSettings
        }
      ]
    }
  }
  dependsOn: [
    cosmosDataContributor
    photoContainerData
    importQueueRoles
    openAiUser
    cosmosContainer
    cosmosImportContainer
  ]
}

// ---------------------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------------------

resource staticWebApp 'Microsoft.Web/staticSites@2024-11-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// Validated by the CNAME to the Static Web App (dnsRecords output); Static Web Apps issues the certificate itself.
resource clientDomain 'Microsoft.Web/staticSites/customDomains@2024-11-01' = if (bindCustomDomains) {
  parent: staticWebApp
  name: clientHostname
  properties: {
    validationMethod: 'cname-delegation'
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------------------

@description('DNS records to add by hand (Route 53) before deploying with bindCustomDomains=true.')
output dnsRecords { type: string, name: string, value: string }[] = [
  { type: 'CNAME', name: clientHostname, value: staticWebApp.properties.defaultHostname }
  { type: 'CNAME', name: apiHostname, value: apiApp.outputs.fqdn }
  { type: 'TXT', name: 'asuid.${apiHostname}', value: apiApp.outputs.customDomainVerificationId }
]

output apiAppName string = apiAppName
output apiDefaultUrl string = 'https://${apiApp.outputs.fqdn}'
output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output keyVaultName string = keyVault.name
output cosmosAccountName string = cosmosAccount.name
output storageAccountName string = storageAccount.name
output cleanupJobName string = cleanupJob.name
output importJobName string = importJob.name
output foundryName string = foundry.name
