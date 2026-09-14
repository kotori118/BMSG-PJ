/**
 * Shared cache invalidation for management writes.
 * Keep mutation-to-cache dependencies here so feature APIs do not drift apart.
 */
const UNIVERSE_CACHE_KEYS_ = Object.freeze({
  ANALYSIS: 'analysis_bootstrap_v1',
  SEARCH: 'UNIVERSE_SEARCH_INDEX_V2',
  HOME_LOOKUP: 'universe-state-lookup-v2',
  CARD_CATALOG: 'trading_card_catalog_v2',
  PROFILE_MEMBERS: 'PROFILE_MEMBERS_V2_0_1',
  PROFILE_MAP: 'PROFILE_MAP_V1',
  PROFILE_SEARCH: 'PROFILE_SEARCH_V2',
  PROFILE_DETAIL_PREFIX: 'PROFILE_MEMBER_DETAIL_V1_',
  CREATIVE_CREDITS_PREFIX: 'UNIVERSE_CROSSLINK_CREDITS_V1_'
});

function clearUniverseProfileMutationCaches_(memberId) {
  clearUniverseCacheKeys_([
    UNIVERSE_CACHE_KEYS_.PROFILE_MEMBERS,
    UNIVERSE_CACHE_KEYS_.PROFILE_MAP,
    UNIVERSE_CACHE_KEYS_.PROFILE_SEARCH,
    UNIVERSE_CACHE_KEYS_.PROFILE_DETAIL_PREFIX + asId_(memberId),
    UNIVERSE_CACHE_KEYS_.SEARCH,
    UNIVERSE_CACHE_KEYS_.HOME_LOOKUP
  ]);
}

function clearUniverseImageMutationCaches_(memberId) {
  clearUniverseCacheKeys_([
    UNIVERSE_CACHE_KEYS_.CARD_CATALOG,
    UNIVERSE_CACHE_KEYS_.PROFILE_MEMBERS,
    UNIVERSE_CACHE_KEYS_.PROFILE_DETAIL_PREFIX + asId_(memberId)
  ]);
}

function clearUniverseImageRepairCaches_() {
  const keys = [UNIVERSE_CACHE_KEYS_.CARD_CATALOG, UNIVERSE_CACHE_KEYS_.PROFILE_MEMBERS];
  try {
    readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){
      const memberId = asId_(row.MemberID);
      if (memberId) keys.push(UNIVERSE_CACHE_KEYS_.PROFILE_DETAIL_PREFIX + memberId);
    });
  } catch (error) {
    console.error(error);
  }
  clearUniverseCacheKeys_(keys);
}

function clearUniverseSongMutationCaches_() {
  const keys = [
    UNIVERSE_CACHE_KEYS_.ANALYSIS,
    UNIVERSE_CACHE_KEYS_.SEARCH,
    UNIVERSE_CACHE_KEYS_.HOME_LOOKUP
  ];
  try {
    readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){
      const memberId = asId_(row.MemberID);
      if (memberId) keys.push(UNIVERSE_CACHE_KEYS_.CREATIVE_CREDITS_PREFIX + memberId);
    });
  } catch (error) {
    console.error(error);
  }
  clearUniverseCacheKeys_(keys);
}

function clearUniverseAnalysisMutationCaches_() {
  clearUniverseCacheKeys_([UNIVERSE_CACHE_KEYS_.ANALYSIS]);
}

function clearUniverseCacheKeys_(keys) {
  const unique = Array.from(new Set((keys || []).filter(String)));
  if (!unique.length) return;
  try { CacheService.getScriptCache().removeAll(unique); }
  catch (error) {
    unique.forEach(function(key){
      try { CacheService.getScriptCache().remove(key); } catch (ignore) {}
    });
  }
}
