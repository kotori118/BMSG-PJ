/**
 * READ ONLY API for PROFILE.
 */
function getProfileMembers() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'PROFILE_MEMBERS_V2_0_1';
    const cached = cache.get(cacheKey);

    if (cached) return JSON.parse(cached);

    const response = { ok: true, data: buildProfileMembersPayload_() };
    cache.put(cacheKey, JSON.stringify(response), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS);
    return response;
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: {
        code: 'PROFILE_MEMBERS_LOAD_FAILED',
        message: 'プロフィールの読み込みに失敗しました。'
      }
    };
  }
}

/**
 * Fetches one member only when the detail screen is opened.
 * Active settings are read dynamically, so future P016/P017... fields appear
 * without a code change when they are added to both sheets and activated.
 */
function getProfileMemberDetail(memberId) {
  try {
    const normalizedMemberId = asId_(memberId);
    if (!normalizedMemberId) throw new Error('MemberID is required.');

    const cache = CacheService.getScriptCache();
    const cacheKey = 'PROFILE_MEMBER_DETAIL_V1_' + normalizedMemberId;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const response = {
      ok: true,
      data: buildProfileMemberDetailPayload_(normalizedMemberId)
    };
    cache.put(cacheKey, JSON.stringify(response), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS);
    return response;
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: {
        code: 'PROFILE_MEMBER_DETAIL_LOAD_FAILED',
        message: 'プロフィール詳細の読み込みに失敗しました。'
      }
    };
  }
}

/**
 * Loads only the values required by the eight MAP categories.
 * Called lazily when MAP is opened; no Spreadsheet writes are performed.
 */
function getProfileMapData() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'PROFILE_MAP_V1';
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const response = { ok: true, data: buildProfileMapPayload_() };
    cache.put(cacheKey, JSON.stringify(response), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS);
    return response;
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      error: {
        code: 'PROFILE_MAP_LOAD_FAILED',
        message: '相関図の読み込みに失敗しました。'
      }
    };
  }
}

function buildProfileMapPayload_() {
  const profiles = readProfileSheetObjects_(
    UNIVERSE_CONFIG.CORE_DB_ID,
    UNIVERSE_CONFIG.SHEETS.PROFILES
  );

  const members = profiles.map(function(profile) {
    const memberId = asId_(profile.MemberID);
    const birthday = parseProfileBirthday_(profile.P002);

    return {
      memberId: memberId,
      values: {
        generation: birthday ? birthday.year + '年' : '',
        origin: splitProfileMapValue_(profile.P005),
        sibling: splitProfileMapValue_(profile.P008),
        height: normalizeProfileHeight_(profile.P006),
        birthMonth: birthday ? birthday.month + '月' : '',
        zodiac: birthday ? getProfileZodiac_(birthday.month, birthday.day) : '',
        chineseZodiac: birthday ? getProfileChineseZodiac_(birthday.year) : '',
        sports: splitProfileMapValue_(profile.P011)
      }
    };
  }).filter(function(member) {
    return member.memberId;
  });

  return {
    categories: [
      { key: 'generation', label: '世代' },
      { key: 'origin', label: '出身地' },
      { key: 'sibling', label: '兄弟区分' },
      { key: 'height', label: '身長' },
      { key: 'birthMonth', label: '誕生月' },
      { key: 'zodiac', label: '星座' },
      { key: 'chineseZodiac', label: '干支' },
      { key: 'sports', label: 'スポーツ' }
    ],
    members: members
  };
}

function parseProfileBirthday_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;

  const normalized = text.replace(/[年月.\-]/g, '/').replace(/日/g, '');
  const match = normalized.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: year, month: month, day: day };
}

function splitProfileMapValue_(value) {
  return String(value == null ? '' : value)
    .split(/[\n\r、,，|｜／/]+/)
    .map(function(item) { return item.trim(); })
    .filter(String);
}

function normalizeProfileHeight_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? match[0] + 'cm' : text;
}

function getProfileZodiac_(month, day) {
  const boundaries = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
  const signs = ['山羊座', '水瓶座', '魚座', '牡羊座', '牡牛座', '双子座',
    '蟹座', '獅子座', '乙女座', '天秤座', '蠍座', '射手座', '山羊座'];
  return day < boundaries[month - 1] ? signs[month - 1] : signs[month];
}

function getProfileChineseZodiac_(year) {
  const signs = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  return signs[((year - 4) % 12 + 12) % 12];
}

/**
 * Returns active, comparable profile fields for the PROFILE tag search.
 * Values are read only and all selected tags are matched with AND semantics.
 */
function getProfileSearchData() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'PROFILE_SEARCH_V1';
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const response = { ok: true, data: buildProfileSearchPayload_() };
    cache.put(cacheKey, JSON.stringify(response), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS);
    return response;
  } catch (error) {
    console.error(error);
    return { ok: false, error: { code: 'PROFILE_SEARCH_LOAD_FAILED', message: '検索データの読み込みに失敗しました。' } };
  }
}

function buildProfileSearchPayload_() {
  const profiles = readProfileSheetObjects_(UNIVERSE_CONFIG.CORE_DB_ID, UNIVERSE_CONFIG.SHEETS.PROFILES);
  const settings = readProfileSheetObjects_(UNIVERSE_CONFIG.LOG_DB_ID, UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS)
    .filter(function(setting) {
      return asBoolean_(setting.IsActive) && asBoolean_(setting.IsCompareTarget) && asId_(setting.ProfileID);
    })
    .sort(function(a, b) {
      return asNumber_(a.DisplayOrder, 9999) - asNumber_(b.DisplayOrder, 9999);
    });

  const fields = settings.map(function(setting) {
    return {
      profileId: asId_(setting.ProfileID),
      label: String(setting.FieldName || setting.ProfileID).trim(),
      displayGroup: String(setting.DisplayGroup || 'PROFILE').trim(),
      displayOrder: asNumber_(setting.DisplayOrder, 9999)
    };
  });

  const members = profiles.map(function(profile) {
    const memberId = asId_(profile.MemberID);
    const values = {};
    settings.forEach(function(setting) {
      const profileId = asId_(setting.ProfileID);
      values[profileId] = normalizeProfileSearchValues_(profile[profileId], setting.IsMultiValue);
    });
    return { memberId: memberId, values: values };
  }).filter(function(member) { return member.memberId; });

  return { fields: fields, members: members };
}

function normalizeProfileSearchValues_(value, isMultiValue) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return [];
  if (!asBoolean_(isMultiValue)) return [text];
  return text.split(/[\n\r、,，|｜／/]+/)
    .map(function(item) { return item.trim(); })
    .filter(String);
}

function buildProfileMemberDetailPayload_(memberId) {
  const profiles = readProfileSheetObjects_(
    UNIVERSE_CONFIG.CORE_DB_ID,
    UNIVERSE_CONFIG.SHEETS.PROFILES
  );
  const settings = readProfileSheetObjects_(
    UNIVERSE_CONFIG.LOG_DB_ID,
    UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS
  );
  const profile = profiles.find(function(row) {
    return asId_(row.MemberID) === memberId;
  });

  if (!profile) throw new Error('Profile not found: ' + memberId);

  const fields = settings.filter(function(setting) {
    return asBoolean_(setting.IsActive) && asId_(setting.ProfileID);
  }).sort(function(a, b) {
    return asNumber_(a.DisplayOrder, 9999) - asNumber_(b.DisplayOrder, 9999);
  }).map(function(setting) {
    const profileId = asId_(setting.ProfileID);
    const rawValue = profile[profileId];
    return {
      profileId: profileId,
      label: String(setting.FieldName || profileId).trim(),
      displayGroup: String(setting.DisplayGroup || 'PROFILE').trim(),
      displayOrder: asNumber_(setting.DisplayOrder, 9999),
      value: formatProfileDetailValue_(rawValue, setting.DataType, setting.IsMultiValue)
    };
  });

  return { memberId: memberId, fields: fields };
}

function readProfileSheetObjects_(spreadsheetId, sheetName) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value).trim() !== ''; });
  }).map(function(row) {
    return headers.reduce(function(object, header, index) {
      if (header) object[header] = row[index];
      return object;
    }, {});
  });
}

function formatProfileDetailValue_(value, dataType, isMultiValue) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '—';

  if (asBoolean_(isMultiValue)) {
    return text.split(/[,、|｜\n]/).map(function(item) {
      return item.trim();
    }).filter(String).join(' / ') || '—';
  }

  return text;
}

function buildProfileMembersPayload_() {
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groupMembers = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const images = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.IMAGES);

  const groupsById = groups.reduce(function(map, group) {
    const groupId = asId_(group.GroupID);
    if (groupId) map[groupId] = group;
    return map;
  }, {});

  const membershipsByMemberId = groupMembers.reduce(function(map, membership) {
    const memberId = asId_(membership.MemberID);
    const groupId = asId_(membership.GroupID);
    if (!memberId || !groupId) return map;
    if (!map[memberId]) map[memberId] = [];
    map[memberId].push({
      groupId: groupId,
      displayOrder: asNumber_(membership.DisplayOrder, 9999)
    });
    return map;
  }, {});

  const imagesByMemberId = images.reduce(function(map, image) {
    if (String(image.TargetType || '').trim().toLowerCase() !== 'member') return map;
    const memberId = asId_(image.TargetID);
    if (!memberId) return map;

    const candidate = {
      driveFileId: asId_(image.DriveFileID),
      rarity: String(image.Rarity || '').trim().toUpperCase(),
      isProfileMain: asBoolean_(image.IsProfileMain),
      displayOrder: asNumber_(image.DisplayOrder, 9999)
    };
    const current = map[memberId];
    const candidateRank = candidate.isProfileMain ? 0 : candidate.rarity === 'SSR' ? 1 : 2;
    const currentRank = current ? current.isProfileMain ? 0 : current.rarity === 'SSR' ? 1 : 2 : 99;

    if (!current || candidateRank < currentRank ||
        (candidateRank === currentRank && candidate.displayOrder < current.displayOrder)) {
      map[memberId] = candidate;
    }
    return map;
  }, {});

  const mainGroupNames = ['BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA'];
  const mainGroups = groups.filter(function(group) {
    return mainGroupNames.indexOf(String(group.GroupName || '').trim()) >= 0;
  }).sort(function(a, b) {
    return asNumber_(a.DisplayOrder, 9999) - asNumber_(b.DisplayOrder, 9999);
  }).map(function(group) {
    return {
      groupId: asId_(group.GroupID),
      key: profileGroupKey_(group.GroupName),
      name: String(group.GroupName || '').trim(),
      colorHex: String(group.ColorHex || '').trim()
    };
  });

  const mainGroupKeyById = mainGroups.reduce(function(map, group) {
    map[group.groupId] = group.key;
    return map;
  }, {});

  const memberPayload = members.map(function(member) {
    const memberId = asId_(member.MemberID);
    const primaryGroupId = asId_(member.GroupID);
    const memberships = (membershipsByMemberId[memberId] || []).slice().sort(function(a, b) {
      return a.displayOrder - b.displayOrder;
    });
    const image = imagesByMemberId[memberId];
    const groupIds = memberships.map(function(item) { return item.groupId; });
    if (primaryGroupId && groupIds.indexOf(primaryGroupId) < 0) groupIds.unshift(primaryGroupId);

    const groupOrders = memberships.reduce(function(map, item) {
      map[item.groupId] = item.displayOrder;
      return map;
    }, {});

    return {
      memberId: memberId,
      displayName: String(member.DisplayName || '').trim(),
      colorHex: String(member.ColorHex || '').trim(),
      displayOrder: asNumber_(member.DisplayOrder, 9999),
      primaryGroupId: primaryGroupId,
      primaryGroupName: primaryGroupId && groupsById[primaryGroupId]
        ? String(groupsById[primaryGroupId].GroupName || '').trim()
        : 'SOLO',
      groupIds: groupIds,
      groupKeys: groupIds.map(function(groupId) {
        return mainGroupKeyById[groupId] || '';
      }).filter(String),
      groupOrders: groupOrders,
      imageUrl: image && image.driveFileId
        ? 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(image.driveFileId) + '=w600'
        : '',
      imageFallbackUrl: image && image.driveFileId
        ? 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(image.driveFileId)
        : ''
    };
  }).filter(function(member) {
    return member.memberId && member.displayName;
  }).sort(function(a, b) {
    return a.displayOrder - b.displayOrder;
  });

  return {
    groups: mainGroups,
    members: memberPayload,
    counts: { members: memberPayload.length, mainGroups: mainGroups.length }
  };
}

function profileGroupKey_(groupName) {
  return String(groupName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
