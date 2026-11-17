/** Read-only navigation capabilities. Actual operations keep their existing server gates. */
function getManagementPageAccess(userId) {
  normalizeUniverseStateUserId_(userId);
  return {registered:true,catalog:getCatalogManagementAccess(userId).enabled===true};
}
