// The API container app (docs/architecture.md, "Overview" and "Decisions"). A module so main.bicep can apply it twice in one
// deployment when needed: a hostname must be on the app before its managed certificate can be issued, and the auth layer must
// be on before the app trusts identity headers (main.bicep explains both).

param name string
param location string
param environmentId string

@description('Resource ID of the user-assigned identity the app runs as.')
param identityId string

param image string

@description('Port the API listens on (PORT, packages/server/src/main.ts).')
param targetPort int

@description('Environment variables: name and value.')
param env { name: string, value: string }[]

@description('Container Apps secrets; here only Key Vault references, so no secret value passes through the template.')
param secrets { name: string, keyVaultUrl: string, identity: string }[]

@description('Custom hostnames on the ingress.')
param customDomains { name: string, bindingType: ('Disabled' | 'SniEnabled'), certificateId: string? }[]

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: secrets
      // No corsPolicy: the API answers CORS itself and allows exactly the client's origin (docs/architecture.md, "Sign-in").
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        customDomains: customDomains
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          // 2 GiB for photo decoding headroom (docs/architecture.md, "Photos").
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: env
        }
      ]
      // Scale to zero (docs/architecture.md, "Decisions"); one replica at most as a cost cap.
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output customDomainVerificationId string = app.properties.customDomainVerificationId
