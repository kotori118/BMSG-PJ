/**
 * User-scoped HOME state: favorites, recent activity, and deterministic daily picks.
 * Uses existing Core / Log repositories; no new sheets are created here.
 */
const UNIVERSE_STATE_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const UNIVERSE_RECENT_LIMIT_ = 10;
const UNIVERSE_HOME_PREVIEW_LIMIT_ = 5;
const UNIVERSE_STATE_LOOKUP_CACHE_KEY_ = 'universe-state-lookup-v1';
const UNIVERSE_PAGE_FAVORITES_ = Object.freeze({
  analysis: 'ANALYSIS',
  karaoke: 'KARAOKE',
  quiz: 'QUIZ',
  cards: 'TRADING CARD',
  poker: 'POKER',
  cover: 'COVER MAKER',
  metrics: 'PERFORMANCE TIMER'
});
const UNIVERSE_ACTIVITY_ROUTES_ = Object.freeze({
  PLAY_QUIZ: 'quiz',
  PLAY_POKER: 'poker',
  DRAW_CARD: 'cards',
  CREATE_COVER: 'cover'
});

function getUniverseHomeBootstrap(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const lookup = buildUniverseStateLookup_();
  const recent = readUniverseRecent_(uid, lookup);
  const favorites = readUniverseFavorites_(uid, lookup);
  return {
    ok: true,
    data: {
      todaySong: getUniverseDailySong_(uid, lookup),
      luckyMember: getUniverseDailyMember_(uid, lookup),
      recent: recent,
      recentPreview: recent.slice(0, UNIVERSE_HOME_PREVIEW_LIMIT_),
      favorites: favorites,
      favoritePreview: favorites.slice(0, UNIVERSE_HOME_PREVIEW_LIMIT_)
    }
  };
}

function getUniverseFavorites(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const favorites = readUniverseFavorites_(uid);
  return {ok:true, data:{favorites:favorites, preview:favorites.slice(0, UNIVERSE_HOME_PREVIEW_LIMIT_)}};
}

function setUniverseFavorite(payload) {
  payload = payload || {};
  const uid = normalizeUniverseStateUserId_(payload.userId);
  const target = normalizeUniverseFavoriteTarget_(payload.targetType, payload.targetId);
  const shouldFavorite = Boolean(payload.favorite);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USER_FAVORITES);
    const rows = readSheetObjectsWithRows_(sheet).filter(function(row) {
      return String(row.UserID || '') === uid && String(row.TargetType || '') === target.targetType && String(row.TargetID || '') === target.targetId;
    });
    if (shouldFavorite && !rows.length) {
      appendByHeaders_(sheet, {UserID:uid, TargetType:target.targetType, TargetID:target.targetId, CreatedAt:new Date()});
    } else if (!shouldFavorite && rows.length) {
      rows.slice().sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).forEach(function(row){sheet.deleteRow(row.__rowNumber);});
    }
    return {ok:true, data:{favorite:shouldFavorite, favorites:readUniverseFavorites_(uid)}};
  } finally {
    lock.releaseLock();
  }
}

function recordUniverseActivity(payload) {
  payload = payload || {};
  const uid = normalizeUniverseStateUserId_(payload.userId);
  const activityType = String(payload.activityType || '').trim().toUpperCase();
  const targetId = String(payload.targetId || '').trim();
  const allowed = ['VIEW_MEMBER','VIEW_LYRICS','PLAY_QUIZ','PLAY_POKER','DRAW_CARD','CREATE_COVER'];
  if (allowed.indexOf(activityType) < 0 || !targetId) throw new Error('Invalid activity target.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES), {
      ActivityID:Utilities.getUuid(), UserID:uid, ActivityType:activityType,
      TargetID:targetId, OccurredAt:new Date()
    });
    return {ok:true, data:{recent:readUniverseRecent_(uid)}};
  } finally {
    lock.releaseLock();
  }
}

function normalizeUniverseStateUserId_(userId) {
  const uid = String(userId || '').trim().toUpperCase();
  if (UNIVERSE_STATE_USERS_.indexOf(uid) < 0) throw new Error('Invalid UserID.');
  return uid;
}

function normalizeUniverseFavoriteTarget_(targetType, targetId) {
  const type = String(targetType || '').trim().toUpperCase();
  const id = String(targetId || '').trim();
  if (!id || ['MEMBER','LYRICS','PAGE'].indexOf(type) < 0) throw new Error('Invalid favorite target.');
  if (type === 'PAGE' && !UNIVERSE_PAGE_FAVORITES_[id]) throw new Error('This page cannot be favorited.');
  return {targetType:type, targetId:id};
}

function readUniverseRecent_(userId, lookup) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
  const rows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === userId;}).sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).slice(0, UNIVERSE_RECENT_LIMIT_);
  return hydrateUniverseRecent_(rows, lookup);
}

function readUniverseFavorites_(userId, lookup) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USER_FAVORITES);
  const rows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === userId;}).sort(function(a,b){
    return universeDateValue_(b.CreatedAt) - universeDateValue_(a.CreatedAt) || b.__rowNumber-a.__rowNumber;
  });
  const seen = {};
  const unique = rows.filter(function(row){const key=String(row.TargetType||'')+'|'+String(row.TargetID||'');if(seen[key])return false;seen[key]=true;return true;});
  return hydrateUniverseFavorites_(unique, lookup);
}

function hydrateUniverseRecent_(rows, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  return rows.map(function(row){
    const type = String(row.ActivityType || '');
    const targetId = String(row.TargetID || '');
    let label = targetId;
    let route = '';
    let params = {};
    if (type === 'VIEW_MEMBER') {label = lookup.members[targetId] ? lookup.members[targetId].displayName : targetId; route='profile'; params={member:targetId};}
    else if (type === 'VIEW_LYRICS') {label = lookup.songs[targetId] ? lookup.songs[targetId].title : targetId; route='lyrics'; params={song:targetId};}
    else if (UNIVERSE_ACTIVITY_ROUTES_[type]) {route=UNIVERSE_ACTIVITY_ROUTES_[type];label=UNIVERSE_PAGE_FAVORITES_[route] || route.toUpperCase();}
    return {activityId:String(row.ActivityID||''), activityType:type, targetId:targetId, label:label, route:route, params:params, occurredAt:formatUniverseStateDate_(row.OccurredAt)};
  });
}

function hydrateUniverseFavorites_(rows, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  return rows.map(function(row){
    const type=String(row.TargetType||'').toUpperCase();
    const targetId=String(row.TargetID||'');
    let label=targetId, route='', params={};
    if(type==='MEMBER'){label=lookup.members[targetId]?lookup.members[targetId].displayName:targetId;route='profile';params={member:targetId};}
    else if(type==='LYRICS'){label=lookup.songs[targetId]?lookup.songs[targetId].title:targetId;route='lyrics';params={song:targetId};}
    else if(type==='PAGE'){label=UNIVERSE_PAGE_FAVORITES_[targetId]||targetId.toUpperCase();route=targetId;}
    return {targetType:type,targetId:targetId,label:label,route:route,params:params,createdAt:formatUniverseStateDate_(row.CreatedAt)};
  });
}

function buildUniverseStateLookup_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(UNIVERSE_STATE_LOOKUP_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const members = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){
    const id=String(row.MemberID||'').trim();
    if(id)members[id]={memberId:id,displayName:String(row.DisplayName||id),colorHex:normalizeUniverseColor_(row.ColorHex)};
  });
  const songs = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).forEach(function(row){
    const id=String(row.SongID||'').trim();
    if(id)songs[id]={songId:id,title:String(row.Title||id),artist:String(row.Artist||'')};
  });
  const lookup = {members:members,songs:songs};
  cache.put(UNIVERSE_STATE_LOOKUP_CACHE_KEY_, JSON.stringify(lookup), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS || 300);
  return lookup;
}

function getUniverseDailySong_(userId, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  const rows = Object.keys(lookup.songs).map(function(id){return lookup.songs[id];}).filter(function(row){return row.songId && row.title;});
  if (!rows.length) return null;
  return rows[deterministicUniverseIndex_(userId, 'song', rows.length)];
}

function getUniverseDailyMember_(userId, lookup) {
  lookup = lookup || buildUniverseStateLookup_();
  const rows = Object.keys(lookup.members).map(function(id){return lookup.members[id];}).filter(function(row){return row.memberId && row.displayName;});
  if (!rows.length) return null;
  return rows[deterministicUniverseIndex_(userId, 'member', rows.length)];
}

function deterministicUniverseIndex_(userId, kind, length) {
  const dateKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const input = dateKey + '|' + userId + '|' + kind;
  let hash = 2166136261;
  for (let i=0;i<input.length;i++) {hash ^= input.charCodeAt(i);hash = Math.imul(hash, 16777619);}
  return Math.abs(hash >>> 0) % length;
}

function normalizeUniverseColor_(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#9cecff';
}

function universeDateValue_(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatUniverseStateDate_(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
}
