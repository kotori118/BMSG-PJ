/**
 * SETTINGS > 管理 > データ管理 (staged, fail-closed)
 * The site NEVER writes Core DB rows or allocates Song/Group/Member IDs.
 * It delegates all writes to the pinned BMSG-DB library.
 *
 * Activation requires:
 *   UNIVERSE_CATALOG_ENABLED=true
 *   UNIVERSE_CATALOG_ADMIN_EMAILS=comma-separated Google Account emails
 * (in BOTH BMSG-PJ and the BMSG-DB writer's script property context).
 *
 * A client-side U001/U002/U003 selection is NOT authentication.
 */
function catalogManagementSiteAccess_(userId) {
  const uid=String(userId||'').trim();
  if(UNIVERSE_CONFIG.USER_IDS.indexOf(uid)<0)
    throw new Error('利用ユーザーの選択が必要です。');
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('UNIVERSE_CATALOG_ENABLED')!=='true')
    throw new Error('新しいデータ管理画面はまだ公開されていません。');
  const email=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  const allow=String(props.getProperty('UNIVERSE_CATALOG_ADMIN_EMAILS')||'')
    .split(',').map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
  if(!email||!allow.length||allow.indexOf(email)<0)
    throw new Error('Googleアカウントの管理者権限が確認できません。');
  return uid;
}

function catalogManagementRefreshCaches_() {
  try {
    clearUniverseCacheKeys_([
      UNIVERSE_CACHE_KEYS_.ANALYSIS,
      UNIVERSE_CACHE_KEYS_.SEARCH,
      UNIVERSE_CACHE_KEYS_.HOME_LOOKUP,
      UNIVERSE_CACHE_KEYS_.PROFILE_MEMBERS,
      UNIVERSE_CACHE_KEYS_.PROFILE_MAP,
      UNIVERSE_CACHE_KEYS_.PROFILE_SEARCH,
      UNIVERSE_CACHE_KEYS_.CARD_CATALOG
    ]);
    clearUniverseSongMutationCaches_();
  } catch (e) {
    console.error('Catalog mutation cache cleanup:', e);
  }
}
function catalogManagementCallWriter_(name,payload) {
  payload=payload||{};
  catalogManagementSiteAccess_(payload.userId);
  const result=BMSGDB[name](payload);
  if(result&&result.ok)catalogManagementRefreshCaches_();
  return result;
}

/** Access check for the SETTINGS link (no user-specific data returned). */
function getCatalogManagementAccess(userId) {
  try {
    catalogManagementSiteAccess_(userId);
    return {enabled:true};
  }catch(error){
    return {enabled:false};
  }
}

function getCatalogManagementBootstrap(userId){
  const uid=catalogManagementSiteAccess_(userId);
  return BMSGDB.getCatalogManagementBootstrapForUniverse({userId:uid});
}
function catalogManagementCreateGroup(payload){
  return catalogManagementCallWriter_('createCatalogGroupForUniverse',payload);
}
function catalogManagementUpdateGroup(payload){
  return catalogManagementCallWriter_('updateCatalogGroupForUniverse',payload);
}
function catalogManagementCreateMember(payload){
  return catalogManagementCallWriter_('createCatalogMemberForUniverse',payload);
}
function catalogManagementUpdateMember(payload){
  return catalogManagementCallWriter_('updateCatalogMemberForUniverse',payload);
}
function catalogManagementAddUnitMember(payload){
  return catalogManagementCallWriter_('addCatalogUnitMemberForUniverse',payload);
}
function catalogManagementCreateSongDraft(payload){
  return catalogManagementCallWriter_('createCatalogSongDraftForUniverse',payload);
}
function catalogManagementSaveSongClass(payload){
  return catalogManagementCallWriter_('saveCatalogSoloForUniverse',payload);
}
function getCatalogManagementDeletePreview(payload){
  payload=payload||{};catalogManagementSiteAccess_(payload.userId);
  return BMSGDB.getCatalogSongDeletePreviewForUniverse(payload);
}
function catalogManagementDeleteSong(payload){
  return catalogManagementCallWriter_('deleteCatalogSongForUniverse',payload);
}
function catalogManagementMigrateSchema(payload){
  return catalogManagementCallWriter_('migrateCatalogManagementSchemaForUniverse',payload);
}
