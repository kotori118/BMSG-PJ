/** Read-only navigation capabilities. Actual operations keep their existing server gates. */
function getManagementPageAccess(userId) {
  normalizeUniverseStateUserId_(userId);
  const access=getCatalogManagementAccess(userId);
  return {registered:true,catalog:access.enabled===true,catalogMessage:access.enabled?'':access.message};
}
