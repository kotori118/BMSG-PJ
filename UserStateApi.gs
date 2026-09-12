/**
 * User-scoped HOME state: favorites, recent activity, and deterministic daily picks.
 * Uses existing Core / Log repositories; no new sheets are created here.
 */
const UNIVERSE_STATE_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const UNIVERSE_RECENT_LIMIT_ = 10;
const UNIVERSE_HOME_PREVIEW_LIMIT_ = 5;
const UNIVERSE_PAGE_FAVORITES_ = Object.freeze({
  analysis: 'ANALYSIS',
  quiz: 'QUIZ',
  cards: 'TRADING CARD',
  poker: 'POKER',
  cover: 'COVER MAKER'
});
const UNIVERSE_ACTIVITY_ROUTES_ = Object.freeze({
  PLAY_QUIZ: 'quiz',
  PLAY_POKER: 'poker',
  DRAW_CARD: 'cards',
  CREATE_COVER: 'cover'
});

function getUniverseHomeBootstrap(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const recent = normalizeUniverseRecent_(uid);
  const favorites = readUniverseFavorites_(uid);
  return {
    ok: true,
    data: {
      todaySong: getUniverseDailySong_(uid),
      luckyMember: getUniverseDailyMember_(uid),
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
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
    const userRows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === uid;}).sort(function(a,b){return a.__rowNumber-b.__rowNumber;});
    const latest = userRows.length ? userRows[userRows.length-1] : null;
    if (latest && String(latest.ActivityType || '') === activityType && String(latest.TargetID || '') === targetId) {
      updateByHeaders_(sheet, latest.__rowNumber, {OccurredAt:new Date()});
    } else {
      appendByHeaders_(sheet, {ActivityID:Utilities.getUuid(), UserID:uid, ActivityType:activityType, TargetID:targetId, OccurredAt:new Date()});
    }
    return {ok:true, data:{recent:normalizeUniverseRecent_(uid)}};
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

function normalizeUniverseRecent_(userId) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
  const rows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === userId;}).sort(function(a,b){return a.__rowNumber-b.__rowNumber;});
  const kept = [];
  const deleteRows = [];
  rows.forEach(function(row){
    const key = String(row.ActivityType || '') + '|' + String(row.TargetID || '');
    const previous = kept.length ? kept[kept.length-1] : null;
    if (previous && previous.__key === key) {
      deleteRows.push(previous.__rowNumber);
      kept[kept.length-1] = Object.assign({}, row, {__key:key});
    } else {
      kept.push(Object.assign({}, row, {__key:key}));
    }
  });
  if (kept.length > UNIVERSE_RECENT_LIMIT_) {
    kept.slice(0, kept.length - UNIVERSE_RECENT_LIMIT_).forEach(function(row){deleteRows.push(row.__rowNumber);});
  }
  if (deleteRows.length) {
    deleteRows.filter(function(rowNumber,index,array){return array.indexOf(rowNumber)===index;}).sort(function(a,b){return b-a;}).forEach(function(rowNumber){sheet.deleteRow(rowNumber);});
    return readUniverseRecent_(userId);
  }
  return hydrateUniverseRecent_(kept.slice(-UNIVERSE_RECENT_LIMIT_).reverse());
}

function readUniverseRecent_(userId) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
  const rows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === userId;}).sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).slice(0, UNIVERSE_RECENT_LIMIT_);
  return hydrateUniverseRecent_(rows);
}

function readUniverseFavorites_(userId) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USER_FAVORITES);
  const rows = readSheetObjectsWithRows_(sheet).filter(function(row){return String(row.UserID || '') === userId;}).sort(function(a,b){
    return universeDateValue_(b.CreatedAt) - universeDateValue_(a.CreatedAt) || b.__rowNumber-a.__rowNumber;
  });
  const seen = {};
  const unique = rows.filter(function(row){const key=String(row.TargetType||'')+'|'+String(row.TargetID||'');if(seen[key])return false;seen[key]=true;return true;});
  return hydrateUniverseFavorites_(unique);
}

function hydrateUniverseRecent_(rows) {
  const lookup = buildUniverseStateLookup_();
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

function hydrateUniverseFavorites_(rows) {
  const lookup = buildUniverseStateLookup_();
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
  const members = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){
    const id=String(row.MemberID||'');if(id)members[id]={memberId:id,displayName:String(row.DisplayName||id),colorHex:String(row.ColorHex||'#9cecff')};
  });
  const songs = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).forEach(function(row){
    const id=String(row.SongID||'');if(id)songs[id]={songId:id,title:String(row.Title||id),artist:String(row.Artist||'')};
  });
  return {members:members,songs:songs};
}

function getUniverseDailySong_(userId) {
  const rows = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).filter(function(row){return String(row.SongID||'').trim() && String(row.Title||'').trim();});
  if (!rows.length) return null;
  const row = rows[deterministicUniverseIndex_(userId, 'song', rows.length)];
  return {songId:String(row.SongID), title:String(row.Title), artist:String(row.Artist||'')};
}

function getUniverseDailyMember_(userId) {
  const rows = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).filter(function(row){return String(row.MemberID||'').trim() && String(row.DisplayName||'').trim();});
  if (!rows.length) return null;
  const row = rows[deterministicUniverseIndex_(userId, 'member', rows.length)];
  return {memberId:String(row.MemberID), displayName:String(row.DisplayName), colorHex:String(row.ColorHex||'#9cecff')};
}

function deterministicUniverseIndex_(userId, kind, length) {
  const dateKey = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const input = dateKey + '|' + userId + '|' + kind;
  let hash = 2166136261;
  for (let i=0;i<input.length;i++) {hash ^= input.charCodeAt(i);hash = Math.imul(hash, 16777619);}
  return Math.abs(hash >>> 0) % length;
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
