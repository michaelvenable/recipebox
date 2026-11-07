// The identity GitHub Actions deploys with (infra/README.md). It signs in with OpenID Connect, so no secret exists: Entra ID
// accepts a GitHub token only for the exact subject below.

param name string
param location string

@description('The GitHub OIDC subject allowed to sign in, e.g. repo:owner@<id>/repo@<id>:ref:refs/heads/master.')
param subject string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: name
  location: location
}

resource githubCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  parent: identity
  name: 'github-deploy'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: subject
    audiences: ['api://AzureADTokenExchange']
  }
}

output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
