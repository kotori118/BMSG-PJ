/**
 * User-scoped SETTINGS preferences.
 * Personal preferences are stored on the existing BMSG_ Universe_Log Users row.
 */
const UNIVERSE_USER_PREFERENCE_COLUMNS_ = Object.freeze({
  FAVORITE_MEMBER_ID: 'FavoriteMemberID',
  MEMBER_COLOR_MODE: 'MemberColorMode',
  FAVORITE_GROUP_START_MODE: 'FavoriteGroupStartMode'
});

function getUniverseSettingsBootstrap(userId) {
  const uid = normalizeUniverseStateUserId_(userId);
  const members = buildUniversePreferenceMemberCatalog_();
  return {
    ok: true,
    data: {
      preferences: readUniverseUserPreferences_(uid, members),
      members: members
    }
  };
}

function saveUniverseUserPreferences(payload) {
  payload = payload || {};
  const uid = normalizeUniverseStateUserId_(payload.userId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const members = buildUniversePreferenceMemberCatalog_();
    const memberById = {};
    members.forEach(function(member) { memberById[member.memberId] = member; });

    const favoriteMemberId = String(payload.favoriteMemberId || '').trim();
    const favoriteMember = favoriteMemberId ? memberById[favoriteMemberId] : null;
    if (favoriteMemberId && !favoriteMember) throw new Error('推しメンが見つかりません。');

    let memberColorMode = parseUniversePreferenceBoolean_(payload.memberColorMode);
    let favoriteGroupStartMode = parseUniversePreferenceBoolean_(payload.favoriteGroupStartMode);
    if (!favoriteMember) {
      memberColorMode = false;
      favoriteGroupStartMode = false;
    } else {
      if (!favoriteMember.colorHex) memberColorMode = false;
      if (!favoriteMember.supportsGroupStart) favoriteGroupStartMode = false;
    }

    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS);
    const row = readSheetObjectsWithRows_(sheet).find(function(item) {
      return String(item.UserID || '').trim().toUpperCase() === uid;
    });
    if (!row) throw new Error('Userが見つかりません。');

    const record = {};
    record[UNIVERSE_USER_PREFERENCE_COLUMNS_.FAVORITE_MEMBER_ID] = favoriteMemberId;
    record[UNIVERSE_USER_PREFERENCE_COLUMNS_.MEMBER_COLOR_MODE] = memberColorMode;
    record[UNIVERSE_USER_PREFERENCE_COLUMNS_.FAVORITE_GROUP_START_MODE] = favoriteGroupStartMode;
    updateByHeaders_(sheet, row.__rowNumber, record);

    return {
      ok: true,
      data: {
        preferences: normalizeUniverseUserPreferenceRecord_(uid, record, favoriteMember),
        members: members
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function readUniverseUserPreferences_(userId, members) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS);
  const row = readSheetObjects_(sheet).find(function(item) {
    return String(item.UserID || '').trim().toUpperCase() === userId;
  });
  if (!row) throw new Error('Userが見つかりません。');

  const favoriteMemberId = String(row[UNIVERSE_USER_PREFERENCE_COLUMNS_.FAVORITE_MEMBER_ID] || '').trim();
  const catalog = Array.isArray(members) ? members : buildUniversePreferenceMemberCatalog_();
  const favoriteMember = catalog.find(function(member) { return member.memberId === favoriteMemberId; }) || null;
  return normalizeUniverseUserPreferenceRecord_(userId, {
    FavoriteMemberID: favoriteMemberId,
    MemberColorMode: row[UNIVERSE_USER_PREFERENCE_COLUMNS_.MEMBER_COLOR_MODE],
    FavoriteGroupStartMode: row[UNIVERSE_USER_PREFERENCE_COLUMNS_.FAVORITE_GROUP_START_MODE]
  }, favoriteMember);
}

function normalizeUniverseUserPreferenceRecord_(userId, record, favoriteMember) {
  const memberColorMode = Boolean(favoriteMember && favoriteMember.colorHex && parseUniversePreferenceBoolean_(record.MemberColorMode));
  const favoriteGroupStartMode = Boolean(favoriteMember && favoriteMember.supportsGroupStart && parseUniversePreferenceBoolean_(record.FavoriteGroupStartMode));
  return {
    userId: userId,
    favoriteMemberId: favoriteMember ? favoriteMember.memberId : '',
    favoriteMemberName: favoriteMember ? favoriteMember.displayName : '',
    favoriteMemberColor: favoriteMember ? favoriteMember.colorHex : '',
    favoriteGroupId: favoriteMember ? favoriteMember.groupId : '',
    favoriteGroupName: favoriteMember ? favoriteMember.groupName : '',
    supportsGroupStart: Boolean(favoriteMember && favoriteMember.supportsGroupStart),
    memberColorMode: memberColorMode,
    favoriteGroupStartMode: favoriteGroupStartMode
  };
}

function buildUniversePreferenceMemberCatalog_() {
  const groups = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS).forEach(function(row) {
    const groupId = String(row.GroupID || '').trim();
    if (groupId) groups[groupId] = String(row.GroupName || '').trim();
  });

  return readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).map(function(row) {
    const memberId = String(row.MemberID || '').trim();
    const groupId = String(row.GroupID || '').trim();
    const color = String(row.ColorHex || '').trim();
    return {
      memberId: memberId,
      displayName: String(row.DisplayName || memberId).trim(),
      colorHex: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
      groupId: groupId,
      groupName: groupId && groups[groupId] ? groups[groupId] : '',
      supportsGroupStart: Boolean(groupId && groups[groupId]),
      displayOrder: Number(row.DisplayOrder || 9999)
    };
  }).filter(function(member) {
    return Boolean(member.memberId && member.displayName);
  }).sort(function(a, b) {
    return a.displayOrder - b.displayOrder || a.displayName.localeCompare(b.displayName, 'ja');
  });
}

function parseUniversePreferenceBoolean_(value) {
  if (value === true || value === false) return value;
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
