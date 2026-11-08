// Values that bootstrap.bicep and main.bicep must agree on.

// The custom role on the photo container (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). bootstrap.bicep creates
// it, because creating a role definition needs rights the deploy identity doesn't have; main.bicep assigns it. Both derive its
// name (a GUID) from the subscription, so it stays the same on every run.
@export()
func photoRoleDefinitionName(subscriptionId string) string => guid(subscriptionId, 'recipebox-photo-container-data')

// Built-in role allowed to be assigned by the deploy identity besides the custom photo role.
@export()
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

// Built-in roles for the import queue and the model (docs/architecture.md, "Recipe import"), checked against
// `az role definition list --name "<role name>"`. The API sends to the queue (Message Sender: messages/add/action); the import
// job takes and deletes messages (Message Processor: messages/read, messages/process/action); the job's KEDA scaler reads the
// queue's length (Reader: queues/read for Get Queue Metadata, messages/read for Peek Messages); the job calls the model
// deployment (Cognitive Services OpenAI User).
@export()
var queueMessageSenderRoleId = 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'

@export()
var queueMessageProcessorRoleId = '8a0f0c08-91a1-4084-bc3d-661d67233fed'

@export()
var queueDataReaderRoleId = '19e7f393-937e-4f77-808e-94535e297925'

@export()
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
