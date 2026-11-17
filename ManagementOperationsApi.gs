/** Routed advanced editors: only explicit library operations are exposed. */
function getManagementOperationsBootstrap(userId){
  catalogManagementSiteAccess_(userId);
  return BMSGDB.getCatalogMaintenanceBootstrapForUniverse({userId:userId});
}
function runManagementOperation(payload){
  payload=payload||{};catalogManagementSiteAccess_(payload.userId);
  const writers={guestCreate:'registerSongLyricsGuestForUniverse',guest:'maintainCatalogGuestForUniverse',group:'maintainCatalogGroupForUniverse',field:'updateCatalogProfileFieldForUniverse',image:'maintainCatalogImageForUniverse',artist:'correctCatalogSongArtistForUniverse',backup:'createCatalogBackupsForUniverse',prepare:'prepareCatalogManagementForUniverse',repair:'repairCatalogDatabaseForUniverse',restore:'restoreCatalogMasterDataForUniverse'};
  const name=writers[payload.operation];if(!name)throw new Error('この操作には対応していません。');
  const result=catalogManagementCallWriter_(name,payload);
  if(result&&result.ok){catalogManagementRefreshProfileFieldCaches_();clearUniverseImageRepairCaches_();}
  return result;
}
function getManagementAuditHistory(payload){
  payload=payload||{};catalogManagementSiteAccess_(payload.userId);
  return BMSGDB.getCatalogAuditHistoryForUniverse(payload);
}
