const PROFILE_MGMT_GROUPS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','BMSG POSSE']);

/**
 * SETTINGS > プロフィール管理専用API。
 * PROFILE閲覧APIはREAD ONLYのまま維持し、書き込み責務をここへ分離する。
 */
function getProfileManagementBootstrap() {
  const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const members = profileMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const groups = profileMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
  const settings = profileMgmtReadObjects_(SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS))
    .filter(function(row){ return asBoolean_(row.IsActive) && asId_(row.ProfileID); })
    .sort(function(a,b){ return asNumber_(a.DisplayOrder,9999)-asNumber_(b.DisplayOrder,9999); });

  const groupNameById = {};
  groups.forEach(function(row){
    const id = asId_(row.GroupID);
    if (id) groupNameById[id] = String(row.GroupName || '').trim();
  });

  const grouped = {};
  PROFILE_MGMT_GROUPS_.forEach(function(name){ grouped[name] = []; });
  members.forEach(function(row){
    const memberId = asId_(row.MemberID);
    if (!memberId) return;
    const groupName = profileMgmtCategoryForMember_(memberId, row.GroupID, groupNameById);
    if (!grouped[groupName]) return;
    grouped[groupName].push({
      memberId: memberId,
      name: String(row.DisplayName || memberId).trim(),
      displayOrder: asNumber_(row.DisplayOrder,9999)
    });
  });

  return {
    groups: PROFILE_MGMT_GROUPS_.map(function(name){
      return { name:name, members:grouped[name].sort(function(a,b){ return a.displayOrder-b.displayOrder; }) };
    }),
    fields: settings.map(profileMgmtSettingPayload_)
  };
}

function getProfileManagementMember(memberId) {
  const id = asId_(memberId);
  if (!id) throw new Error('メンバーを選択してください。');

  const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const profileTable = profileMgmtReadTable_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.PROFILES), false);
  const row = profileTable.rows.find(function(item){ return asId_(item.record.MemberID) === id; });
  if (!row) throw new Error('プロフィールが見つかりません。');

  const settings = profileMgmtReadObjects_(SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS))
    .filter(function(item){ return asBoolean_(item.IsActive) && asId_(item.ProfileID); })
    .sort(function(a,b){ return asNumber_(a.DisplayOrder,9999)-asNumber_(b.DisplayOrder,9999); });

  const values = {};
  settings.forEach(function(setting){
    const profileId = asId_(setting.ProfileID);
    values[profileId] = profileMgmtValueForClient_(row.record[profileId], setting);
  });

  return { memberId:id, values:values };
}

function saveProfileManagementMember(payload) {
  payload = payload || {};
  const memberId = asId_(payload.memberId);
  const groupName = String(payload.groupName || '').trim();
  if (!memberId) throw new Error('メンバーを選択してください。');
  if (PROFILE_MGMT_GROUPS_.indexOf(groupName) < 0) throw new Error('グループを選択してください。');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const context = profileMgmtResolveMember_(core, memberId);
    if (context.groupName !== groupName) throw new Error('グループとメンバーの組み合わせが一致しません。');

    const settings = profileMgmtReadObjects_(SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS))
      .filter(function(item){ return asBoolean_(item.IsActive) && asId_(item.ProfileID); })
      .sort(function(a,b){ return asNumber_(a.DisplayOrder,9999)-asNumber_(b.DisplayOrder,9999); });

    const sheet = core.getSheetByName(UNIVERSE_CONFIG.SHEETS.PROFILES);
    const table = profileMgmtReadTable_(sheet, false);
    if (table.map.MemberID == null) throw new Error('05_Profiles に MemberID 列がありません。');
    const row = table.rows.find(function(item){ return asId_(item.record.MemberID) === memberId; });
    if (!row) throw new Error('プロフィールが見つかりません。');

    const input = payload.values && typeof payload.values === 'object' ? payload.values : {};
    const updates = [];
    settings.forEach(function(setting){
      const profileId = asId_(setting.ProfileID);
      if (table.map[profileId] == null) throw new Error('05_Profiles に必要な列「' + profileId + '」がありません。');
      updates.push({
        column: table.map[profileId] + 1,
        value: profileMgmtNormalizeForSheet_(input[profileId], setting)
      });
    });

    updates.forEach(function(update){ sheet.getRange(row.rowNumber, update.column).setValue(update.value); });
    SpreadsheetApp.flush();
    profileMgmtClearCaches_(memberId);

    return { ok:true, memberId:memberId, message:'プロフィールを保存しました。' };
  } finally {
    lock.releaseLock();
  }
}

function profileMgmtSettingPayload_(setting) {
  const profileId = asId_(setting.ProfileID);
  return {
    profileId: profileId,
    label: String(setting.FieldName || profileId).trim(),
    dataType: String(setting.DataType || 'TEXT').trim().toUpperCase(),
    isMultiValue: asBoolean_(setting.IsMultiValue),
    displayGroup: String(setting.DisplayGroup || 'PROFILE').trim(),
    displayOrder: asNumber_(setting.DisplayOrder,9999),
    unit: profileId === 'P006' ? 'cm' : ''
  };
}

function profileMgmtValueForClient_(value, setting) {
  if (asBoolean_(setting.IsMultiValue)) {
    return String(value == null ? '' : value)
      .split(/[\n\r、,，|｜／/]+/)
      .map(function(item){ return item.trim(); })
      .filter(String);
  }

  const dataType = String(setting.DataType || 'TEXT').trim().toUpperCase();
  if (value === '' || value === null || typeof value === 'undefined') return '';
  if (dataType === 'DATE') {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    const text = String(value).trim();
    const match = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (match) return match[1] + '-' + ('0'+match[2]).slice(-2) + '-' + ('0'+match[3]).slice(-2);
  }
  return String(value).trim();
}

function profileMgmtNormalizeForSheet_(value, setting) {
  if (asBoolean_(setting.IsMultiValue)) {
    const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\n\r、,，|｜／/]+/);
    return list.map(function(item){ return String(item == null ? '' : item).trim(); }).filter(String).join('\n');
  }

  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const dataType = String(setting.DataType || 'TEXT').trim().toUpperCase();
  if (dataType === 'NUMBER') {
    const number = Number(text);
    if (!Number.isFinite(number)) throw new Error(String(setting.FieldName || setting.ProfileID) + 'は数値で入力してください。');
    return number;
  }
  if (dataType === 'DATE') {
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error(String(setting.FieldName || setting.ProfileID) + 'の日付を確認してください。');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error(String(setting.FieldName || setting.ProfileID) + 'の日付を確認してください。');
    }
    return date;
  }
  return text;
}

function profileMgmtResolveMember_(core, memberId) {
  const members = profileMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const groups = profileMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
  const groupNameById = {};
  groups.forEach(function(row){ groupNameById[asId_(row.GroupID)] = String(row.GroupName || '').trim(); });
  const member = members.find(function(row){ return asId_(row.MemberID) === memberId; });
  if (!member) throw new Error('メンバーが見つかりません。');
  const groupName = profileMgmtCategoryForMember_(memberId, member.GroupID, groupNameById);
  if (PROFILE_MGMT_GROUPS_.indexOf(groupName) < 0) throw new Error('プロフィール管理の対象外メンバーです。');
  return { memberId:memberId, groupName:groupName };
}

function profileMgmtCategoryForMember_(memberId, groupId, groupNameById) {
  if (/^5/.test(String(memberId || ''))) return 'BMSG POSSE';
  const name = groupNameById[asId_(groupId)] || '';
  return PROFILE_MGMT_GROUPS_.slice(0,4).indexOf(name) >= 0 ? name : '';
}

function profileMgmtClearCaches_(memberId) {
  const cache = CacheService.getScriptCache();
  ['PROFILE_MEMBERS_V2_0_1','PROFILE_MEMBER_DETAIL_V1_' + memberId,'PROFILE_MAP_V1','PROFILE_SEARCH_V2'].forEach(function(key){
    try { cache.remove(key); } catch (ignore) {}
  });
}

function profileMgmtReadObjects_(sheet) {
  return profileMgmtReadTable_(sheet, true).rows.map(function(row){ return row.record; });
}

function profileMgmtReadTable_(sheet, displayValues) {
  if (!sheet) throw new Error('必要なシートが見つかりません。');
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return { headers:[], map:{}, rows:[] };
  const range = sheet.getRange(1,1,Math.max(lastRow,1),lastColumn);
  const values = displayValues === false ? range.getValues() : range.getDisplayValues();
  const headers = values[0].map(function(value){ return String(value == null ? '' : value).trim(); });
  const map = {};
  headers.forEach(function(header,index){ if (header) map[header] = index; });
  const rows = values.slice(1).map(function(valuesRow,index){
    const record = {};
    headers.forEach(function(header,column){ if (header) record[header] = valuesRow[column]; });
    return { record:record, rowNumber:index + 2 };
  }).filter(function(row){
    return Object.keys(row.record).some(function(key){ return row.record[key] !== '' && row.record[key] !== null; });
  });
  return { headers:headers, map:map, rows:rows };
}
