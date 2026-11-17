/** Shared management access uses the existing Universe user selection. */
function catalogManagementSiteAccess_(userId) {
  const uid=String(userId||'').trim();
  if(UNIVERSE_CONFIG.USER_IDS.indexOf(uid)<0)throw new Error('利用ユーザーの選択が必要です。');
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
    return {enabled:false,message:String(error.message||'利用ユーザーを選択してください。')};
  }
}

function getCatalogManagementBootstrap(userId){
  const uid=catalogManagementSiteAccess_(userId);
  return BMSGDB.getCatalogManagementBootstrapForUniverse({userId:uid});
}
/**
 * Profile field metadata is managed by BMSG-DB, never directly by the UI.
 * Site ProfileManagement continues to edit member values independently.
 */
function getCatalogManagementProfileFields(userId) {
  const uid=catalogManagementSiteAccess_(userId);
  return BMSGDB.getCatalogProfileFieldsForUniverse({userId:uid});
}
function catalogManagementRefreshProfileFieldCaches_(){
  const keys=[
    UNIVERSE_CACHE_KEYS_.PROFILE_MEMBERS,
    UNIVERSE_CACHE_KEYS_.PROFILE_MAP,
    UNIVERSE_CACHE_KEYS_.PROFILE_SEARCH,
    UNIVERSE_CACHE_KEYS_.SEARCH,
    UNIVERSE_CACHE_KEYS_.HOME_LOOKUP
  ];
  try{
    readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(member){
      const id=asId_(member.MemberID);
      if(id)keys.push(UNIVERSE_CACHE_KEYS_.PROFILE_DETAIL_PREFIX+id);
    });
  }catch(e){console.error('Profile field cache enumeration:',e);}
  clearUniverseCacheKeys_(keys);
}
function catalogManagementCreateProfileField(payload){
  const result=catalogManagementCallWriter_('createCatalogProfileFieldForUniverse',payload);
  if(result&&result.ok)catalogManagementRefreshProfileFieldCaches_();
  return result;
}
function catalogManagementSetProfileFieldActive(payload){
  const result=catalogManagementCallWriter_('setCatalogProfileFieldActiveForUniverse',payload);
  if(result&&result.ok)catalogManagementRefreshProfileFieldCaches_();
  return result;
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
/**
 * Member maintenance is explicitly feature gated on BMSG-DB. Keep these calls
 * separate from profile value editing and invalidate member/profile caches.
 */
function catalogManagementMoveMemberOrder(payload){
  const result=catalogManagementCallWriter_('moveCatalogMemberDisplayOrderForUniverse',payload);
  if(result&&result.ok)catalogManagementRefreshProfileFieldCaches_();
  return result;
}
function catalogManagementChangePrimaryGroup(payload){
  const result=catalogManagementCallWriter_('changeCatalogMemberPrimaryGroupForUniverse',payload);
  if(result&&result.ok)catalogManagementRefreshProfileFieldCaches_();
  return result;
}
function getCatalogManagementMemberDeletePreview(payload){
  payload=payload||{};
  catalogManagementSiteAccess_(payload.userId);
  return BMSGDB.getCatalogMemberDeletePreviewForUniverse(payload);
}
function catalogManagementDeleteMember(payload){
  const result=catalogManagementCallWriter_('deleteCatalogMemberForUniverse',payload);
  if(result&&result.ok)catalogManagementRefreshProfileFieldCaches_();
  return result;
}

/** UNIT-only membership operations; the BMSG-DB writer enforces the shared lock. */
function catalogManagementRemoveUnitMember(payload){
  return catalogManagementCallWriter_('removeCatalogUnitMemberForUniverse',payload);
}
function catalogManagementMoveUnitMember(payload){
  return catalogManagementCallWriter_('moveCatalogUnitMemberForUniverse',payload);
}
function catalogManagementAddUnitMember(payload){
  return catalogManagementCallWriter_('addCatalogUnitMemberForUniverse',payload);
}
function catalogManagementCreateSongDraft(payload){
  return catalogManagementCallWriter_('createCatalogSongDraftForUniverse',payload);
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
/** Read-only DB integrity scan; no Sheet writes, schema migration or deployment. */
function auditCatalogManagementDatabase(userId) {
  const uid=catalogManagementSiteAccess_(userId);
  return BMSGDB.auditCatalogDatabaseForUniverse({userId:uid});
}
