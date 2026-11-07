// One-time setup, run by the owner with their own Azure sign-in (infra/README.md, step 1). Everything here needs rights the
// GitHub Actions deploy identity deliberately doesn't have: creating resource groups and role definitions, and granting roles.
//
//   az deployment sub create --name recipebox-bootstrap --location southcentralus --template-file infra/bootstrap.bicep
//
// Safe to run again; it changes nothing that is already as described.

targetScope = 'subscription'

import { keyVaultSecretsUserRoleId, photoRoleDefinitionName } from 'shared.bicep'

@description('Region of the resource groups and the deploy identity.')
param location string = 'southcentralus'

@description('Resource group for the app (infra/main.bicep).')
param appResourceGroupName string = 'rg-recipebox-prod'

// Separate from the app's group, where the deploy identity is Contributor, so it can't change its own sign-in rules.
@description('Resource group for the deploy identity.')
param deployResourceGroupName string = 'rg-recipebox-deploy'

@description('The GitHub repository that deploys, as owner/name.')
param githubRepository string = 'michaelvenable/recipebox'

@description('The only branch whose workflow runs may deploy.')
param githubBranch string = 'master'

// GitHub puts the owner's and repository's numeric IDs in the token's subject (use_immutable_subject, see
// `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`), so a repository deleted and recreated under the same name
// can't deploy. Read them with `gh api repos/<owner>/<repo> --jq '{id, owner_id: .owner.id}'`.
@description('The GitHub numeric ID of the repository owner.')
param githubOwnerId string = '1676614'

@description('The GitHub numeric ID of the repository.')
param githubRepositoryId string = '1448964827'

var githubOwner = split(githubRepository, '/')[0]
var githubRepositoryName = split(githubRepository, '/')[1]

resource appResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: appResourceGroupName
  location: location
}

resource deployResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: deployResourceGroupName
  location: location
}

// The app identity's role on the photo container (docs/architecture.md, "Access to Cosmos DB and Blob Storage"): read the
// container, and read, write and delete its blobs, but not delete or change the container. The actions are those Microsoft's
// Blob Storage REST reference lists for the calls the server makes (packages/server/src/photos/blob-photo-store.ts):
//   container exists (Get Container Properties)   containers/read                (an action, not a data action)
//   list blobs                                    containers/blobs/read
//   download                                      containers/blobs/read
//   upload (Put Blob; Put Block, Put Block List)  containers/blobs/write, containers/blobs/add/action
//   delete if exists (Delete Blob)                containers/blobs/delete
resource photoRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: photoRoleDefinitionName(subscription().subscriptionId)
  properties: {
    roleName: 'RecipeBox Photo Container Data'
    description: 'Read a blob container and read, write, add and delete its blobs; cannot delete or change the container.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Storage/storageAccounts/blobServices/containers/read'
        ]
        notActions: []
        dataActions: [
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write'
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action'
          'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete'
        ]
        notDataActions: []
      }
    ]
    assignableScopes: [
      appResourceGroup.id
    ]
  }
}

module deployIdentity 'modules/deploy-identity.bicep' = {
  name: 'recipebox-deploy-identity'
  scope: deployResourceGroup
  params: {
    name: 'id-recipebox-github'
    location: location
    subject: 'repo:${githubOwner}@${githubOwnerId}/${githubRepositoryName}@${githubRepositoryId}:ref:refs/heads/${githubBranch}'
  }
}

module deployAccess 'modules/deploy-access.bicep' = {
  name: 'recipebox-deploy-access'
  scope: appResourceGroup
  params: {
    principalId: deployIdentity.outputs.principalId
    assignableRoleIds: [
      photoRole.name
      keyVaultSecretsUserRoleId
    ]
  }
}

// GitHub repository variables (not secrets; OpenID Connect needs none). infra/README.md, step 2.
output AZURE_CLIENT_ID string = deployIdentity.outputs.clientId
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId
