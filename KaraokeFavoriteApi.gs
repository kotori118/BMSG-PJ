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
  const favoriteSheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
  const saved = {};
  readSheetObjects_(favoriteSheet).forEach(function(row) {
    const key = String(row.CategoryKey || '').trim();
    if (KARAOKE_FAVORITE_CATEGORIES_.indexOf(key) < 0) return;
    const uid = validateKaraokeFavoriteUserLoose_(row.UserID);
    const memberId = asId_(row.MemberID);
    if (!uid || !memberId) return;
    if (!saved[key]) saved[key] = {};
    saved[key][memberId] = uid;
  });

  // Read the Core DB only once for the whole settings screen.
  // The previous implementation reopened/read the same sheets for every category,
  // which was especially slow on iPhone Safari through Apps Script Web Apps.
  const core = getKaraokeFavoriteCoreSnapshot_();
  return {
    categories: KARAOKE_FAVORITE_CATEGORIES_.map(function(key) {
      return {
        categoryKey: key,
        members: getKaraokeFavoriteMembersFromSnapshot_(key, core),
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
  const members = getKaraokeFavoriteMembersFromSnapshot_(key, getKaraokeFavoriteCoreSnapshot_());
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

function getKaraokeFavoriteCoreSnapshot_() {
  const spreadsheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  return {
    groups: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.GROUPS),
    members: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.MEMBERS),
    groupMembers: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS),
    songs: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.SONGS),
    lyricsParts: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS)
  };
}

function readKaraokeFavoriteSheetObjects_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Core DB sheet not found: ' + sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== '' && value !== null; });
  }).map(function(row) {
    const record = {};
    headers.forEach(function(header, index) { if (header) record[header] = row[index]; });
    return record;
  });
}

function getKaraokeFavoriteMembersFromSnapshot_(categoryKey, core) {
  const key = validateKaraokeFavoriteCategory_(categoryKey);
  const memberMap = core.members.reduce(function(map, row) {
    const id = asId_(row.MemberID);
    if (id) map[id] = row;
    return map;
  }, {});
  const group = core.groups.find(function(row) { return String(row.GroupName || '').trim() === key; });
  let ids = [];
  const orderMap = {};

  if (group) {
    const groupId = asId_(group.GroupID);
    core.groupMembers.filter(function(row) { return asId_(row.GroupID) === groupId; }).forEach(function(row) {
      const id = asId_(row.MemberID);
      if (!id || !memberMap[id]) return;
      ids.push(id);
      orderMap[id] = Number(row.DisplayOrder || 9999);
    });
  }

  if (!ids.length) ids = getKaraokeFavoriteMembersFromSongsSnapshot_(key, memberMap, core.songs, core.lyricsParts);

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

function getKaraokeFavoriteMembersFromSongsSnapshot_(categoryKey, memberMap, songs, lyricsParts) {
  const targetSongIds = {};
  songs.forEach(function(song) {
    const artist = String(song.Artist || '').trim();
    const title = String(song.Title || '').trim();
    const key = ['BE:FIRST','MAZZEL','STARGLOW','HANA'].indexOf(artist) >= 0 ? artist : lyricsUnitCategory_(title, artist);
    if (key === categoryKey) targetSongIds[asId_(song.SongID)] = true;
  });
  const found = {};
  lyricsParts.forEach(function(part) {
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
