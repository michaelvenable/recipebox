// Values that bootstrap.bicep and main.bicep must agree on.

// The custom role on the photo container (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). bootstrap.bicep creates
// it, because creating a role definition needs rights the deploy identity doesn't have; main.bicep assigns it. Both derive its
// name (a GUID) from the subscription, so it stays the same on every run.
@export()
func photoRoleDefinitionName(subscriptionId string) string => guid(subscriptionId, 'recipebox-photo-container-data')

// Built-in role allowed to be assigned by the deploy identity besides the custom photo role.
@export()
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
