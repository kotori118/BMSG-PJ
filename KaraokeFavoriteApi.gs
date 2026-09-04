function getKaraokeFavoriteSet(groupId) {
  const core = getKaraokeFavoriteCoreSnapshot_();
  const group = getKaraokeFavoriteEligibleGroup_(groupId, core);
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
  const assignments = {};
  readSheetObjects_(sheet).forEach(function(row) {
    if (asId_(row.GroupID) !== group.groupId) return;
    const uid = validateKaraokeFavoriteUserLoose_(row.UserID);
    const memberId = asId_(row.MemberID);
    if (uid && memberId) assignments[memberId] = uid;
  });
  return { groupId: group.groupId, groupName: group.groupName, assignments: assignments };
}

function getKaraokeFavoriteSettings() {
  const favoriteSheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_FAVORITES);
  const saved = {};
  readSheetObjects_(favoriteSheet).forEach(function(row) {
    const groupId = asId_(row.GroupID);
    const uid = validateKaraokeFavoriteUserLoose_(row.UserID);
    const memberId = asId_(row.MemberID);
    if (!groupId || !uid || !memberId) return;
    if (!saved[groupId]) saved[groupId] = {};
    saved[groupId][memberId] = uid;
  });

  // Favorite Sets are available only for formal Groups that have rows in
  // 04_GroupMembers. No member inference from Songs/Lyrics is allowed.
  const core = getKaraokeFavoriteCoreSnapshot_();
  const categories = getKaraokeFavoriteEligibleGroups_(core).map(function(group) {
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      members: getKaraokeFavoriteMembersForGroup_(group.groupId, core),
      assignments: saved[group.groupId] || {}
    };
  });
  return { categories: categories, users: getKaraokeUsers_() };
}

function saveKaraokeFavoriteSet(payload) {
  payload = payload || {};
  const core = getKaraokeFavoriteCoreSnapshot_();
  const group = getKaraokeFavoriteEligibleGroup_(payload.groupId, core);
  const members = getKaraokeFavoriteMembersForGroup_(group.groupId, core);
  const allowedUsers = KARAOKE_USERS_.slice();
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
    const groupCol = headers.indexOf('GroupID');
    if (groupCol < 0 || headers.indexOf('UserID') < 0 || headers.indexOf('MemberID') < 0) {
      throw new Error('KARAOKE_FavoriteSetsの列構成が正しくありません。');
    }
    for (let i = values.length - 1; i >= 1; i--) {
      if (asId_(values[i][groupCol]) === group.groupId) sheet.deleteRow(i + 1);
    }
    members.forEach(function(member) {
      appendByHeaders_(sheet, {
        GroupID: group.groupId,
        UserID: normalized[member.memberId],
        MemberID: member.memberId
      });
    });
    return { ok: true, groupId: group.groupId, groupName: group.groupName, assignments: normalized };
  });
}

function getKaraokeFavoriteCoreSnapshot_() {
  const spreadsheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  return {
    groups: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.GROUPS),
    members: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.MEMBERS),
    groupMembers: readKaraokeFavoriteSheetObjects_(spreadsheet, UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS)
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

function getKaraokeFavoriteEligibleGroups_(core) {
  const counts = {};
  core.groupMembers.forEach(function(row) {
    const groupId = asId_(row.GroupID);
    const memberId = asId_(row.MemberID);
    if (groupId && memberId) counts[groupId] = (counts[groupId] || 0) + 1;
  });
  return core.groups.map(function(row) {
    return {
      groupId: asId_(row.GroupID),
      groupName: String(row.GroupName || '').trim(),
      order: Number(row.DisplayOrder || 9999)
    };
  }).filter(function(group) {
    return group.groupId && group.groupName && counts[group.groupId] > 0;
  }).sort(function(a, b) {
    return a.order - b.order || a.groupName.localeCompare(b.groupName, 'ja');
  });
}

function getKaraokeFavoriteEligibleGroup_(groupId, core) {
  const id = asId_(groupId);
  const group = getKaraokeFavoriteEligibleGroups_(core).find(function(item) { return item.groupId === id; });
  if (!group) throw new Error('このグループは推しセット対象外です。');
  return group;
}

function getKaraokeFavoriteMembersForGroup_(groupId, core) {
  const id = asId_(groupId);
  const memberMap = core.members.reduce(function(map, row) {
    const memberId = asId_(row.MemberID);
    if (memberId) map[memberId] = row;
    return map;
  }, {});
  const seen = {};
  return core.groupMembers.filter(function(row) {
    return asId_(row.GroupID) === id;
  }).map(function(row) {
    const memberId = asId_(row.MemberID);
    if (!memberId || seen[memberId] || !memberMap[memberId]) return null;
    seen[memberId] = true;
    const member = memberMap[memberId];
    return {
      memberId: memberId,
      name: String(member.DisplayName || memberId),
      color: /^#[0-9a-f]{6}$/i.test(String(member.ColorHex || '')) ? String(member.ColorHex) : '#777777',
      order: Number(row.DisplayOrder || 9999)
    };
  }).filter(Boolean).sort(function(a, b) {
    return a.order - b.order || a.name.localeCompare(b.name, 'ja');
  }).map(function(member) {
    delete member.order;
    return member;
  });
}

function validateKaraokeFavoriteUserLoose_(userId) {
  const uid = asId_(userId);
  return KARAOKE_USERS_.indexOf(uid) >= 0 ? uid : '';
}
