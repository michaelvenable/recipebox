// The deploy identity's rights on the app's resource group: Contributor to create and update resources, and Role Based Access
// Control Administrator limited by a condition to assigning or removing only the given roles, and only for service principals
// (managed identities). Contributor alone can't assign roles; Owner could assign any role, including Owner.

@description('Principal (object) ID of the deploy identity.')
param principalId string

@description('GUIDs of the only role definitions the deploy identity may assign or remove.')
param assignableRoleIds string[]

var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
var rbacAdministratorRoleId = 'f58310d9-a9f6-439a-9e8d-f62e7b41a168'

var roles = join(assignableRoleIds, ', ')

// The "Constrain roles and principal types" delegation condition from Microsoft's examples. A write is checked against the
// request, a delete against the existing assignment; any other action is unaffected.
var assignmentCondition = join(
  [
    '((!(ActionMatches{\'Microsoft.Authorization/roleAssignments/write\'}))'
    'OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${roles}}'
    'AND @Request[Microsoft.Authorization/roleAssignments:PrincipalType]'
    'ForAnyOfAnyValues:StringEqualsIgnoreCase {\'ServicePrincipal\'}))'
    'AND'
    '((!(ActionMatches{\'Microsoft.Authorization/roleAssignments/delete\'}))'
    'OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${roles}}'
    'AND @Resource[Microsoft.Authorization/roleAssignments:PrincipalType]'
    'ForAnyOfAnyValues:StringEqualsIgnoreCase {\'ServicePrincipal\'}))'
  ],
  ' '
)

resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'GitHub Actions deploys RecipeBox (infra/main.bicep).'
  }
}

resource rbacAdministrator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, rbacAdministratorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', rbacAdministratorRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
    description: 'GitHub Actions assigns the app identity its data roles, and only those (infra/main.bicep).'
    condition: assignmentCondition
    conditionVersion: '2.0'
  }
}
