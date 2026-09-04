const KARAOKE_FAVORITE_CATEGORIES_ = Object.freeze([
  'BE:FIRST','MAZZEL','STARGLOW','HANA','BMSG ALLSTARS','ShowMinorSavage','BMSG POSSE',
  'BMSG EAST','BMSG WEST','BMSG SKY','BMSG GAIA','BMSG MARINE','BMSG STRIKERS','その他UNIT'
]);

function getKaraokeFavoriteSet(categoryKey) {
  const key = validateKaraokeFavoriteCategory_(categoryKey);
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
  const assignments = {};
  readSheetObjects_(sheet).forEach(function(row) {
    if (String(row.CategoryKey || '').trim() !== key) return;
    const uid = validateKaraokeFavoriteUserLoose_(row.UserID);
    const memberId = asId_(row.MemberID);
    if (uid && memberId) assignments[memberId] = uid;
  });
  return { categoryKey: key, assignments: assignments };
}

function getKaraokeFavoriteSettings() {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
  const saved = {};
  readSheetObjects_(sheet).forEach(function(row) {
    const key = String(row.CategoryKey || '').trim();
    if (KARAOKE_FAVORITE_CATEGORIES_.indexOf(key) < 0) return;
    const uid = validateKaraokeFavoriteUserLoose_(row.UserID);
    const memberId = asId_(row.MemberID);
    if (!uid || !memberId) return;
    if (!saved[key]) saved[key] = {};
    saved[key][memberId] = uid;
  });

  return {
    categories: KARAOKE_FAVORITE_CATEGORIES_.map(function(key) {
      return {
        categoryKey: key,
        members: getKaraokeFavoriteMembers_(key),
        assignments: saved[key] || {}
      };
    }),
    users: getKaraokeUsers_()
  };
}

function saveKaraokeFavoriteSet(payload) {
  payload = payload || {};
  const key = validateKaraokeFavoriteCategory_(payload.categoryKey);
  const allowedUsers = KARAOKE_USERS_.slice();
  const members = getKaraokeFavoriteMembers_(key);
  const allowedMembers = members.reduce(function(map, member) {
    map[member.memberId] = true;
    return map;
  }, {});
  const submitted = payload.assignments && typeof payload.assignments === 'object' ? payload.assignments : {};

  const normalized = {};
  Object.keys(submitted).forEach(function(memberId) {
    const id = asId_(memberId);
    const uid = asId_(submitted[memberId]);
    if (!allowedMembers[id] || allowedUsers.indexOf(uid) < 0) throw new Error('推しセットの内容が正しくありません。');
    normalized[id] = uid;
  });
  if (members.some(function(member) { return !normalized[member.memberId]; })) {
    throw new Error('すべてのメンバーを3人のいずれかに設定してください。');
  }

  return withKaraokeLock_(function() {
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
    const values = sheet.getDataRange().getValues();
    if (!values.length) throw new Error('KARAOKE_FavoriteSetsのヘッダーがありません。');
    const headers = values[0].map(function(value) { return String(value).trim(); });
    const categoryCol = headers.indexOf('CategoryKey');
    if (categoryCol < 0 || headers.indexOf('UserID') < 0 || headers.indexOf('MemberID') < 0) {
      throw new Error('KARAOKE_FavoriteSetsの列構成が正しくありません。');
    }
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][categoryCol] || '').trim() === key) sheet.deleteRow(i + 1);
    }
    members.forEach(function(member) {
      appendByHeaders_(sheet, {
        CategoryKey: key,
        UserID: normalized[member.memberId],
        MemberID: member.memberId
      });
    });
    return { ok: true, categoryKey: key, assignments: normalized };
  });
}

function getKaraokeFavoriteMembers_(categoryKey) {
  const key = validateKaraokeFavoriteCategory_(categoryKey);
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groupMembers = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const memberMap = members.reduce(function(map, row) {
    const id = asId_(row.MemberID);
    if (id) map[id] = row;
    return map;
  }, {});

  const group = groups.find(function(row) { return String(row.GroupName || '').trim() === key; });
  let ids = [];
  const orderMap = {};
  if (group) {
    const groupId = asId_(group.GroupID);
    groupMembers.filter(function(row) { return asId_(row.GroupID) === groupId; }).forEach(function(row) {
      const id = asId_(row.MemberID);
      if (!id || !memberMap[id]) return;
      ids.push(id);
      orderMap[id] = Number(row.DisplayOrder || 9999);
    });
  }

  if (!ids.length) {
    ids = getKaraokeFavoriteMembersFromSongs_(key, memberMap);
  }

  const seen = {};
  return ids.filter(function(id) {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  }).map(function(id) {
    const row = memberMap[id];
    return {
      memberId: id,
      name: String(row.DisplayName || id),
      color: /^#[0-9a-f]{6}$/i.test(String(row.ColorHex || '')) ? String(row.ColorHex) : '#777777',
      order: Object.prototype.hasOwnProperty.call(orderMap, id) ? orderMap[id] : Number(row.DisplayOrder || 9999)
    };
  }).sort(function(a, b) {
    return a.order - b.order || a.name.localeCompare(b.name, 'ja');
  }).map(function(member) {
    delete member.order;
    return member;
  });
}

function getKaraokeFavoriteMembersFromSongs_(categoryKey, memberMap) {
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
  const targetSongIds = {};
  songs.forEach(function(song) {
    const artist = String(song.Artist || '').trim();
    const title = String(song.Title || '').trim();
    const key = ['BE:FIRST','MAZZEL','STARGLOW','HANA'].indexOf(artist) >= 0 ? artist : lyricsUnitCategory_(title, artist);
    if (key === categoryKey) targetSongIds[asId_(song.SongID)] = true;
  });
  const found = {};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS).forEach(function(part) {
    if (!targetSongIds[asId_(part.SongID)]) return;
    String(part.Singer || '').split(',').forEach(function(token) {
      const base = token.trim().replace(/_(up|down|sub)$/i, '');
      const ids = memberMap[base] ? [base] : base.split('_');
      ids.forEach(function(id) {
        id = asId_(id);
        if (id && id !== '99' && memberMap[id]) found[id] = true;
      });
    });
  });
  return Object.keys(found);
}

function validateKaraokeFavoriteCategory_(categoryKey) {
  const key = String(categoryKey || '').trim();
  if (KARAOKE_FAVORITE_CATEGORIES_.indexOf(key) < 0) throw new Error('推しセットの分類が正しくありません。');
  return key;
}

function validateKaraokeFavoriteUserLoose_(userId) {
  const uid = asId_(userId);
  return KARAOKE_USERS_.indexOf(uid) >= 0 ? uid : '';
}
