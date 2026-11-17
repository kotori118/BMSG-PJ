/** All Universe users share management; readiness is read-only. */
function getManagementPageAccess(userId) {
  const uid=catalogManagementSiteAccess_(userId);
  const schema=BMSGDB.getCatalogManagementReadinessForUniverse({userId:uid});
  return {registered:true,catalog:true,initialSetupRequired:!schema.ready};
}
