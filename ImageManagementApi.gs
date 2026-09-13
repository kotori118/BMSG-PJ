const IMAGE_MGMT_GROUPS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','BMSG POSSE']);
const IMAGE_MGMT_RARITIES_ = Object.freeze(['SSR','SR','R','N']);
const IMAGE_MGMT_MIME_EXT_ = Object.freeze({'image/jpeg':'jpg','image/png':'png'});
const IMAGE_MGMT_FOLDER_KEY_ = 'card_image_folder_id';

function getImageManagementBootstrap() {
  const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const members = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const groups = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
  const groupNameById = {};
  groups.forEach(function(row){ groupNameById[asId_(row.GroupID)] = String(row.GroupName || '').trim(); });
  const grouped = {};
  IMAGE_MGMT_GROUPS_.forEach(function(name){ grouped[name] = []; });
  members.forEach(function(row){
    const memberId = asId_(row.MemberID);
    const category = imageMgmtCategoryForMember_(memberId, row.GroupID, groupNameById);
    if (!category || !grouped[category]) return;
    grouped[category].push({
      memberId: memberId,
      name: String(row.DisplayName || memberId).trim(),
      displayOrder: Number(row.DisplayOrder || 9999)
    });
  });
  return {
    groups: IMAGE_MGMT_GROUPS_.map(function(name){
      return {name:name, members:grouped[name].sort(function(a,b){return a.displayOrder-b.displayOrder;})};
    }),
    rarities: IMAGE_MGMT_RARITIES_.slice(),
    acceptedTypes: ['image/jpeg','image/png']
  };
}

function getImageManagementStatus(memberId, rarity) {
  const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const context = imageMgmtResolveMember_(core, memberId);
  const normalizedRarity = imageMgmtNormalizeRarity_(rarity);
  const row = imageMgmtFindImageRow_(core, context.memberId, normalizedRarity);
  const driveFileId = row ? String(row.record.DriveFileID || '').trim() : '';
  const exists = driveFileId ? imageMgmtDriveFileExists_(driveFileId) : false;
  return {
    memberId: context.memberId,
    memberName: context.memberName,
    groupName: context.groupName,
    rarity: normalizedRarity,
    hasImage: !!(driveFileId && exists),
    hasBrokenLink: !!(driveFileId && !exists),
    driveFileId: exists ? driveFileId : '',
    previewUrl: exists ? imageMgmtPreviewUrl_(driveFileId) : ''
  };
}

function saveImageManagementImage(payload) {
  payload = payload || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let newFile = null;
  let targetCell = null;
  let oldFileId = '';
  let dbUpdated = false;
  try {
    const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const context = imageMgmtResolveMember_(core, payload.memberId);
    const rarity = imageMgmtNormalizeRarity_(payload.rarity);
    if (String(payload.groupName || '').trim() !== context.groupName) throw new Error('グループとメンバーの組み合わせが一致しません。');
    const mimeType = String(payload.mimeType || '').trim().toLowerCase();
    if (!IMAGE_MGMT_MIME_EXT_[mimeType]) throw new Error('この画像形式には対応していません。JPEGまたはPNGの画像を選択してください。');
    const base64 = String(payload.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) throw new Error('画像データを読み込めませんでした。');

    const existing = imageMgmtFindImageRow_(core, context.memberId, rarity);
    oldFileId = existing ? String(existing.record.DriveFileID || '').trim() : '';
    const oldFileExists = oldFileId ? imageMgmtDriveFileExists_(oldFileId) : false;
    if (oldFileExists) {
      if (!payload.replace) throw new Error('既存画像があります。画像を差し替えるか確認してください。');
      if (String(payload.expectedOldFileId || '') !== oldFileId) throw new Error('画像データが更新されています。画面を開き直して確認してください。');
    }

    const folder = DriveApp.getFolderById(imageMgmtGetFolderId_(core));
    const extension = imageMgmtResolveExtension_(payload.fileName, mimeType);
    const fileName = '[' + rarity + ']' + context.memberName + '(' + context.groupName + ').' + extension;
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
    newFile = folder.createFile(blob);

    imageMgmtEnsureMemberRows_(core, context.memberId, context.displayOrder);
    const target = imageMgmtFindImageRow_(core, context.memberId, rarity);
    if (!target) throw new Error('画像データの登録行を作成できませんでした。');
    targetCell = target.sheet.getRange(target.rowNumber, target.map.DriveFileID + 1);
    targetCell.setValue(newFile.getId());
    SpreadsheetApp.flush();
    if (String(targetCell.getDisplayValue()).trim() !== newFile.getId()) throw new Error('画像データの更新を確認できませんでした。');
    dbUpdated = true;

    if (oldFileId && oldFileId !== newFile.getId() && oldFileExists) {
      try {
        DriveApp.getFileById(oldFileId).setTrashed(true);
      } catch (trashError) {
        targetCell.setValue(oldFileId);
        SpreadsheetApp.flush();
        dbUpdated = false;
        try { newFile.setTrashed(true); } catch (ignore) {}
        throw new Error('古い画像を安全に整理できなかったため、差し替えを取り消しました。');
      }
    }

    imageMgmtClearCardCache_();
    return {
      ok: true,
      message: '画像を登録しました。',
      memberId: context.memberId,
      rarity: rarity,
      driveFileId: newFile.getId()
    };
  } catch (error) {
    if (newFile && !dbUpdated) {
      try { newFile.setTrashed(true); } catch (ignore) {}
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function repairImageManagementData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const members = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
    const groups = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
    const groupNameById = {};
    groups.forEach(function(row){ groupNameById[asId_(row.GroupID)] = String(row.GroupName || '').trim(); });
    const memberByName = {};
    members.forEach(function(row){
      const name = String(row.DisplayName || '').trim();
      if (!name) return;
      if (!memberByName[name]) memberByName[name] = [];
      memberByName[name].push(row);
      imageMgmtEnsureMemberRows_(core, asId_(row.MemberID), Number(row.DisplayOrder || 9999));
    });

    const filesByKey = {};
    const allImageIds = {};
    const files = DriveApp.getFolderById(imageMgmtGetFolderId_(core)).getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (String(file.getMimeType()).indexOf('image/') !== 0) continue;
      allImageIds[file.getId()] = true;
      const match = file.getName().match(/^\[(SSR|SR|R|N)\](.*?)\(([^()]+)\)(?:\.[^.]+)?$/i);
      if (!match) continue;
      const candidates = memberByName[String(match[2] || '').trim()] || [];
      if (candidates.length !== 1) continue;
      const member = candidates[0];
      const memberId = asId_(member.MemberID);
      const expectedGroup = imageMgmtCategoryForMember_(memberId, member.GroupID, groupNameById);
      if (!expectedGroup || String(match[3] || '').trim() !== expectedGroup) continue;
      const key = memberId + '|' + String(match[1]).toUpperCase();
      if (!filesByKey[key]) filesByKey[key] = [];
      filesByKey[key].push(file.getId());
    }

    const table = imageMgmtReadTable_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.IMAGES));
    let updated = 0;
    let warnings = 0;
    table.rows.forEach(function(row){
      const type = String(row.record.TargetType || '').trim().toLowerCase();
      const rarity = String(row.record.Rarity || '').trim().toUpperCase();
      if (type !== 'member' || IMAGE_MGMT_RARITIES_.indexOf(rarity) < 0) return;
      const key = asId_(row.record.TargetID) + '|' + rarity;
      const ids = filesByKey[key] || [];
      const current = String(row.record.DriveFileID || '').trim();
      let next = current;
      if (!ids.length) next = current && allImageIds[current] ? current : '';
      else if (ids.length === 1) next = ids[0];
      else if (current && ids.indexOf(current) >= 0) next = current;
      else { warnings++; return; }
      if (next !== current) {
        row.sheet.getRange(row.rowNumber, table.map.DriveFileID + 1).setValue(next);
        updated++;
      }
    });
    SpreadsheetApp.flush();
    imageMgmtClearCardCache_();
    return {ok:true, updated:updated, warnings:warnings, message:'画像データを修復しました。'};
  } finally {
    lock.releaseLock();
  }
}

function imageMgmtResolveMember_(core, memberId) {
  const members = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const groups = imageMgmtReadObjects_(core.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
  const groupNameById = {};
  groups.forEach(function(row){ groupNameById[asId_(row.GroupID)] = String(row.GroupName || '').trim(); });
  const id = asId_(memberId);
  const member = members.find(function(row){ return asId_(row.MemberID) === id; });
  if (!member) throw new Error('メンバーが見つかりません。');
  const groupName = imageMgmtCategoryForMember_(id, member.GroupID, groupNameById);
  if (!groupName || IMAGE_MGMT_GROUPS_.indexOf(groupName) < 0) throw new Error('画像管理の対象外メンバーです。');
  return {memberId:id, memberName:String(member.DisplayName || id).trim(), groupName:groupName, displayOrder:Number(member.DisplayOrder || 9999)};
}

function imageMgmtCategoryForMember_(memberId, groupId, groupNameById) {
  if (/^5/.test(String(memberId || ''))) return 'BMSG POSSE';
  const name = groupNameById[asId_(groupId)] || '';
  return ['BE:FIRST','MAZZEL','STARGLOW','HANA'].indexOf(name) >= 0 ? name : '';
}

function imageMgmtNormalizeRarity_(rarity) {
  const value = String(rarity || '').trim().toUpperCase();
  if (IMAGE_MGMT_RARITIES_.indexOf(value) < 0) throw new Error('レア度を選択してください。');
  return value;
}

function imageMgmtResolveExtension_(fileName, mimeType) {
  const match = String(fileName || '').toLowerCase().match(/\.(jpe?g|png)$/);
  if (match) return match[1] === 'jpeg' ? 'jpeg' : match[1];
  return IMAGE_MGMT_MIME_EXT_[mimeType];
}

function imageMgmtGetFolderId_(core) {
  const config = imageMgmtReadObjects_(core.getSheetByName('00_Config'));
  const row = config.find(function(item){ return String(item.Key || '').trim() === IMAGE_MGMT_FOLDER_KEY_; });
  const folderId = row ? String(row.Value || '').trim() : '';
  if (!folderId) throw new Error('画像保存先フォルダを確認できません。');
  return folderId;
}

function imageMgmtFindImageRow_(core, memberId, rarity) {
  const sheet = core.getSheetByName(UNIVERSE_CONFIG.SHEETS.IMAGES);
  const table = imageMgmtReadTable_(sheet);
  const matches = table.rows.filter(function(row){
    return String(row.record.TargetType || '').trim().toLowerCase() === 'member' &&
      asId_(row.record.TargetID) === String(memberId) &&
      String(row.record.Rarity || '').trim().toUpperCase() === rarity;
  });
  if (matches.length > 1) throw new Error('同じメンバー・レア度の画像データが重複しています。修復してください。');
  return matches[0] || null;
}

function imageMgmtEnsureMemberRows_(core, memberId, displayOrder) {
  const sheet = core.getSheetByName(UNIVERSE_CONFIG.SHEETS.IMAGES);
  const table = imageMgmtReadTable_(sheet);
  ['ImageID','TargetType','TargetID','Rarity','DriveFileID','DisplayOrder','IsProfileMain'].forEach(function(name){
    if (table.map[name] == null) throw new Error('09_Images に必要な列「' + name + '」がありません。');
  });
  const existing = {};
  table.rows.forEach(function(row){
    if (String(row.record.TargetType || '').trim().toLowerCase() === 'member' && asId_(row.record.TargetID) === String(memberId)) {
      existing[String(row.record.Rarity || '').trim().toUpperCase()] = true;
    }
  });
  const missing = IMAGE_MGMT_RARITIES_.filter(function(r){ return !existing[r]; });
  if (!missing.length) return;

  const configSheet = core.getSheetByName('00_Config');
  const configTable = imageMgmtReadTable_(configSheet);
  const configRow = configTable.rows.find(function(row){ return String(row.record.Key || '').trim() === 'NEXT_IMAGE_ID'; });
  if (!configRow) throw new Error('00_Config の NEXT_IMAGE_ID がありません。');
  let nextId = Number(configRow.record.Value);
  if (!Number.isFinite(nextId) || nextId <= 0) throw new Error('NEXT_IMAGE_ID が不正です。');
  const rows = missing.map(function(rarity){
    const values = new Array(table.headers.length).fill('');
    values[table.map.ImageID] = String(nextId++);
    values[table.map.TargetType] = 'Member';
    values[table.map.TargetID] = String(memberId);
    values[table.map.Rarity] = rarity;
    values[table.map.DriveFileID] = '';
    values[table.map.DisplayOrder] = (Number(displayOrder) - 1) * 4 + IMAGE_MGMT_RARITIES_.indexOf(rarity) + 1;
    values[table.map.IsProfileMain] = rarity === 'SSR';
    return values;
  });
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, table.headers.length).setValues(rows);
  if (startRow > 2) {
    const source = sheet.getRange(startRow - 1, 1, 1, table.headers.length);
    const target = sheet.getRange(startRow, 1, rows.length, table.headers.length);
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    sheet.getRange(startRow, 1, rows.length, table.headers.length).setValues(rows);
  }
  configSheet.getRange(configRow.rowNumber, configTable.map.Value + 1).setValue(nextId);
  if (configTable.map.UpdatedAt != null) configSheet.getRange(configRow.rowNumber, configTable.map.UpdatedAt + 1).setValue(new Date());
}

function imageMgmtReadObjects_(sheet) { return imageMgmtReadTable_(sheet).rows.map(function(row){ return row.record; }); }

function imageMgmtReadTable_(sheet) {
  if (!sheet) throw new Error('必要なシートが見つかりません。');
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map(function(value){ return String(value || '').trim(); });
  const map = {};
  headers.forEach(function(name,index){ if (name) map[name] = index; });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i].some(function(value){ return value !== '' && value !== null; })) continue;
    const record = {};
    headers.forEach(function(name,index){ if (name) record[name] = values[i][index]; });
    rows.push({sheet:sheet,rowNumber:i+1,record:record,values:values[i]});
  }
  return {sheet:sheet,headers:headers,map:map,rows:rows};
}

function imageMgmtDriveFileExists_(fileId) {
  try { DriveApp.getFileById(fileId).getName(); return true; } catch (e) { return false; }
}
function imageMgmtPreviewUrl_(fileId) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w900'; }
function imageMgmtClearCardCache_() {
  try { CacheService.getScriptCache().remove(CARD_CATALOG_CACHE_KEY_); } catch (e) {}
}
