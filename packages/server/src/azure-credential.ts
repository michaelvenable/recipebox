import { ManagedIdentityCredential, type TokenCredential } from "@azure/identity";

/**
 * The credential a deployed app and the cleanup job use for Cosmos DB and Blob Storage: only the user-assigned managed identity
 * with this client ID. Not DefaultAzureCredential, which would fall back to other sign-ins such as environment variables or a
 * developer's Azure CLI login (docs/architecture.md, "Access to Cosmos DB and Blob Storage").
 */
export function managedIdentityCredential(clientId: string): TokenCredential {
  return new ManagedIdentityCredential({ clientId });
}
