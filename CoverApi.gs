/** BMSG Universe COVER MAKER */
const COVER_USERS_ = Object.freeze(['U001','U002','U003']);
const COVER_SOURCE_ARTISTS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','ShowMinorSavage']);
const COVER_DESTINATION_GROUPS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','ShowMinorSavage']);
const COVER_ALL_ID_ = '99';

function getCoverMakerBootstrap(userId) {
  const uid = validateCoverUser_(userId);
  const snapshot = getCoverCoreSnapshot_();
  const groups = buildCoverGroups_(snapshot);
  return {
    currentUserId: uid,
    users: getCoverUsers_(),
    groups: groups,
    sourceArtists: COVER_SOURCE_ARTISTS_.slice(),
    projects: listCoverProjects_(snapshot, uid)
  };
}

function getCoverLibrary(userId) {
  validateCoverUser_(userId);
  const snapshot = getCoverCoreSnapshot_();
  return listSharedCoverProjects_(snapshot);
}

function getCoverSourceSongs(artist) {
  const selected = String(artist || '').trim();
  if (COVER_SOURCE_ARTISTS_.indexOf(selected) < 0) throw new Error('カバーする原曲のアーティストが正しくありません。');
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS)
    .filter(function(row){ return String(row.Artist || '').trim() === selected; })
    .map(normalizeCoverSong_)
    .sort(compareCoverSongs_);
  return songs;
}

function getCoverEditorData(payload) {
  payload = payload || {};
  const userId = validateCoverUser_(payload.userId);
  const coverGroupId = asId_(payload.coverGroupId);
  const songId = asId_(payload.songId);
  const snapshot = getCoverCoreSnapshot_();
  const group = requireCoverGroup_(snapshot, coverGroupId);
  const song = snapshot.songs.find(function(row){ return asId_(row.SongID) === songId; });
  if (!song || COVER_SOURCE_ARTISTS_.indexOf(String(song.Artist || '').trim()) < 0) throw new Error('原曲が見つかりません。');
  const members = getCoverGroupMembers_(snapshot, coverGroupId);
  if (!members.length) throw new Error('カバー担当メンバーが見つかりません。');
  const nameMap = buildCoverSingerNameMap_(snapshot);
  const parts = snapshot.lyrics.filter(function(row){ return asId_(row.SongID) === songId; })
    .sort(function(a,b){ return Number(a.PartOrder || 0) - Number(b.PartOrder || 0); })
    .map(function(row){
      const singer = String(row.Singer || '').trim();
      return {
        order: Number(row.PartOrder || 0),
        lyrics: String(row.Lyrics || ''),
        originalSinger: singer,
        originalSingerLabel: formatCoverSingerLabel_(singer, nameMap),
        originalMemberId: getCoverPrimarySingerId_(singer)
      };
    });
  return {
    currentUserId: userId,
    projectId: '',
    sourceSong: normalizeCoverSong_(song),
    coverGroup: { groupId: coverGroupId, groupName: String(group.GroupName || ''), color: normalizeHex_(group.ColorHex, '#9cecff') },
    members: [{memberId:COVER_ALL_ID_,name:'ALL',color:'#777777',isAll:true}].concat(members),
    parts: parts,
    assignments: parts.map(function(part){ return { order: part.order, memberId: part.originalMemberId }; }),
    title: buildCoverTitle_(song, group),
    creatorUserId: userId,
    creatorDisplayName: coverUserDisplayName_(userId),
    isCreator: true,
    isSaved: false,
    isShared: false,
    sharedAt: '',
    isComplete: isCoverComplete_(parts.map(function(part){return {order:part.order,memberId:part.originalMemberId};}), members, parts)
  };
}

function getCoverProject(payload) {
  payload = payload || {};
  const uid = validateCoverUser_(payload.userId);
  const projectId = asId_(payload.projectId);
  const snapshot = getCoverCoreSnapshot_();
  const projectSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS);
  const project = readSheetObjects_(projectSheet).find(function(row){ return asId_(row.CoverProjectID) === projectId; });
  const creatorUserId = project ? asId_(project.CreatorUserID) : '';
  const isCreator = creatorUserId === uid;
  const isShared = project ? asCoverBoolean_(project.IsShared) : false;
  if (!project || (!isCreator && !isShared)) throw new Error('カバーが見つかりません。');
  const group = requireCoverGroup_(snapshot, asId_(project.CoverGroupID));
  const song = snapshot.songs.find(function(row){ return asId_(row.SongID) === asId_(project.SourceSongID); });
  if (!song) throw new Error('原曲が見つかりません。');
  const members = getCoverGroupMembers_(snapshot, asId_(project.CoverGroupID));
  const nameMap = buildCoverSingerNameMap_(snapshot);
  const parts = snapshot.lyrics.filter(function(row){ return asId_(row.SongID) === asId_(project.SourceSongID); })
    .sort(function(a,b){ return Number(a.PartOrder || 0) - Number(b.PartOrder || 0); })
    .map(function(row){
      const singer = String(row.Singer || '').trim();
      return {
        order: Number(row.PartOrder || 0),
        lyrics: String(row.Lyrics || ''),
        originalSinger: singer,
        originalSingerLabel: formatCoverSingerLabel_(singer, nameMap),
        originalMemberId: getCoverPrimarySingerId_(singer)
      };
    });
  const assignments = readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS))
    .filter(function(row){ return asId_(row.CoverProjectID) === projectId; })
    .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; })
    .sort(function(a,b){ return a.order-b.order; });
  return {
    currentUserId: uid,
    projectId: projectId,
    sourceSong: normalizeCoverSong_(song),
    coverGroup: { groupId: asId_(group.GroupID), groupName: String(group.GroupName || ''), color: normalizeHex_(group.ColorHex, '#9cecff') },
    members: [{memberId:COVER_ALL_ID_,name:'ALL',color:'#777777',isAll:true}].concat(members),
    parts: parts,
    assignments: assignments,
    title: String(project.Title || buildCoverTitle_(song, group)),
    creatorUserId: creatorUserId,
    creatorDisplayName: coverUserDisplayName_(creatorUserId),
    isCreator: isCreator,
    isSaved: true,
    isShared: isShared,
    sharedAt: toCoverIso_(project.SharedAt),
    isComplete: isCoverComplete_(assignments, members, parts),
    createdAt: toCoverIso_(project.CreatedAt)
  };
}

function saveCoverProject(payload) {
  payload = payload || {};
  const uid = validateCoverUser_(payload.userId);
  return withCoverLock_(function(){
    const snapshot = getCoverCoreSnapshot_();
    const projectSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS);
    const assignmentSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS);
    const projectIdInput = asId_(payload.projectId);
    const existingRows = readSheetObjectsWithRows_(projectSheet);
    const existing = projectIdInput ? existingRows.find(function(row){ return asId_(row.CoverProjectID) === projectIdInput; }) : null;
    if (projectIdInput && !existing) throw new Error('保存対象のカバーが見つかりません。');
    if (existing && asId_(existing.CreatorUserID) !== uid) throw new Error('このカバーは編集できません。');

    const songId = asId_(existing ? existing.SourceSongID : payload.songId);
    const groupId = asId_(existing ? existing.CoverGroupID : payload.coverGroupId);
    const song = snapshot.songs.find(function(row){ return asId_(row.SongID) === songId; });
    const group = requireCoverGroup_(snapshot, groupId);
    if (!song || COVER_SOURCE_ARTISTS_.indexOf(String(song.Artist || '').trim()) < 0) throw new Error('原曲が正しくありません。');
    const members = getCoverGroupMembers_(snapshot, groupId);
    const allowed = {};
    members.forEach(function(member){ allowed[member.memberId] = true; });
    allowed[COVER_ALL_ID_] = true;

    const parts = snapshot.lyrics.filter(function(row){ return asId_(row.SongID) === songId; });
    const validOrders = {};
    parts.forEach(function(row){ validOrders[String(Number(row.PartOrder || 0))] = true; });
    const submitted = Array.isArray(payload.assignments) ? payload.assignments : [];
    if (submitted.length !== parts.length) throw new Error('歌割りの件数が一致しません。');
    const seenOrders = {};
    const assignments = submitted.map(function(item){
      const order = Number(item && item.order || 0);
      const memberId = asId_(item && item.memberId);
      if (!validOrders[String(order)] || seenOrders[String(order)]) throw new Error('歌割りOrderが正しくありません。');
      seenOrders[String(order)] = true;
      if (!memberId) throw new Error('未設定のパートがあります。');
      if (!allowed[memberId]) throw new Error('選択したグループに所属しないメンバーが含まれています。');
      return {order:order,memberId:memberId};
    }).sort(function(a,b){return a.order-b.order;});

    const coverParts = parts.map(function(row){
      const singer = String(row.Singer || '').trim();
      return {order:Number(row.PartOrder || 0),originalMemberId:getCoverPrimarySingerId_(singer)};
    });
    const incomplete = !isCoverComplete_(assignments, members, coverParts);
    if (incomplete && !payload.confirmIncomplete) {
      return { requiresConfirm: true, message: '原曲担当のまま残っているパートがあります。', isComplete: false };
    }

    const beforeAssignments = existing ? readSheetObjects_(assignmentSheet)
      .filter(function(row){ return asId_(row.CoverProjectID) === projectIdInput; })
      .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; }) : [];
    const wasComplete = existing ? isCoverComplete_(beforeAssignments, members, coverParts) : false;
    const nowComplete = isCoverComplete_(assignments, members, coverParts);
    const projectId = existing ? projectIdInput : Utilities.getUuid();
    const title = buildCoverTitle_(song, group);
    const createdAt = existing ? existing.CreatedAt : new Date();

    const beforeProject = existing ? Object.assign({}, existing) : null;
    let writeStarted = false;
    try {
      writeStarted = true;
      if (!existing) {
        appendByHeaders_(projectSheet, {CoverProjectID:projectId,CreatorUserID:uid,SourceSongID:songId,CoverGroupID:groupId,Title:title,CreatedAt:createdAt,IsShared:false,SharedAt:''});
      } else {
        updateCoverProjectRow_(projectSheet, projectId, {Title:title});
      }
      deleteCoverAssignments_(assignmentSheet, projectId);
      assignments.forEach(function(item){ appendByHeaders_(assignmentSheet,{CoverProjectID:projectId,Order:item.order,MemberID:item.memberId}); });
      SpreadsheetApp.flush();
      assertCoverSaved_(projectSheet, assignmentSheet, projectId, uid, songId, groupId, title, assignments);

      if (nowComplete && !wasComplete) try { appendCoverActivity_(uid, 'CREATE_COVER', projectId); } catch (error) { console.error(error); }
      return {ok:true,projectId:projectId,title:title,isComplete:nowComplete,requiresConfirm:false};
    } catch (error) {
      if (!writeStarted) throw error;
      const rollbackErrors = [];
      try { restoreCoverSnapshot_(projectSheet, assignmentSheet, projectId, beforeProject, beforeAssignments); }
      catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      throw coverRollbackError_(error, rollbackErrors);
    }
  });
}

function setCoverProjectShared(payload) {
  payload = payload || {};
  const uid = validateCoverUser_(payload.userId);
  const projectId = asId_(payload.projectId);
  const makeShared = Boolean(payload.isShared);
  return withCoverLock_(function(){
    const sheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS);
    const project = readSheetObjects_(sheet).find(function(row){ return asId_(row.CoverProjectID) === projectId; });
    if (!project) throw new Error('カバーが見つかりません。');
    if (asId_(project.CreatorUserID) !== uid) throw new Error('このカバーの共有設定は変更できません。');
    const sharedAt = makeShared ? new Date() : '';
    updateCoverProjectRow_(sheet, projectId, {IsShared:makeShared,SharedAt:sharedAt});
    return {ok:true,projectId:projectId,isShared:makeShared,sharedAt:toCoverIso_(sharedAt)};
  });
}

function deleteCoverProject(payload) {
  payload = payload || {};
  const uid = validateCoverUser_(payload.userId);
  const projectId = asId_(payload.projectId);
  return withCoverLock_(function(){
    const projectSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS);
    const assignmentSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS);
    const values = projectSheet.getDataRange().getValues();
    if (values.length < 2) throw new Error('カバーが見つかりません。');
    const headers = values[0].map(String);
    const idCol = headers.indexOf('CoverProjectID');
    const creatorCol = headers.indexOf('CreatorUserID');
    let rowIndex = -1;
    for (let i=1;i<values.length;i++) {
      if (asId_(values[i][idCol]) === projectId) {
        if (asId_(values[i][creatorCol]) !== uid) throw new Error('このカバーは削除できません。');
        rowIndex = i + 1; break;
      }
    }
    if (rowIndex < 0) throw new Error('カバーが見つかりません。');
    const beforeProject = readSheetObjectsWithRows_(projectSheet).find(function(row){ return asId_(row.CoverProjectID) === projectId; });
    const beforeAssignments = readSheetObjects_(assignmentSheet).filter(function(row){ return asId_(row.CoverProjectID) === projectId; })
      .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; });
    try {
      deleteCoverAssignments_(assignmentSheet, projectId);
      projectSheet.deleteRow(rowIndex);
      SpreadsheetApp.flush();
      if (readSheetObjects_(projectSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;}) ||
          readSheetObjects_(assignmentSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;})) {
        throw new Error('カバーの削除後照合に失敗しました。');
      }
      return {ok:true};
    } catch (error) {
      const rollbackErrors = [];
      try { restoreCoverSnapshot_(projectSheet, assignmentSheet, projectId, beforeProject, beforeAssignments); }
      catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      throw coverRollbackError_(error, rollbackErrors);
    }
  });
}

function getCoverCoreSnapshot_() {
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  return {
    groups: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.GROUPS),
    members: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.MEMBERS),
    guests: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.GUESTS),
    groupMembers: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS),
    songs: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.SONGS),
    lyrics: readCoverSheetFromSpreadsheet_(ss, UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS)
  };
}

function readCoverSheetFromSpreadsheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Core DB sheet not found: ' + name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(v){return String(v || '').trim();});
  return values.slice(1).filter(function(row){return row.some(function(v){return v !== '' && v !== null;});}).map(function(row){
    const record = {}; headers.forEach(function(header,index){if(header)record[header]=row[index];}); return record;
  });
}

function buildCoverGroups_(snapshot) {
  const byName = {};
  snapshot.groups.forEach(function(row){byName[String(row.GroupName || '').trim()] = row;});
  return COVER_DESTINATION_GROUPS_.map(function(name){
    const row = byName[name];
    if (!row) return null;
    return {groupId:asId_(row.GroupID),groupName:name,color:normalizeHex_(row.ColorHex,'#9cecff')};
  }).filter(Boolean);
}

function requireCoverGroup_(snapshot, groupId) {
  const row = snapshot.groups.find(function(item){return asId_(item.GroupID)===groupId;});
  if (!row || COVER_DESTINATION_GROUPS_.indexOf(String(row.GroupName || '').trim()) < 0) throw new Error('歌うアーティストが正しくありません。');
  return row;
}

function getCoverGroupMembers_(snapshot, groupId) {
  const memberMap = {};
  snapshot.members.forEach(function(row){memberMap[asId_(row.MemberID)] = row;});
  return snapshot.groupMembers.filter(function(row){return asId_(row.GroupID)===groupId;})
    .sort(function(a,b){return Number(a.DisplayOrder || 999)-Number(b.DisplayOrder || 999);})
    .map(function(row){
      const member = memberMap[asId_(row.MemberID)];
      return member ? {memberId:asId_(member.MemberID),name:String(member.DisplayName || ''),color:normalizeHex_(member.ColorHex,'#777777')} : null;
    }).filter(Boolean);
}

function buildCoverSingerNameMap_(snapshot) {
  const map = { '99': 'ALL', '109': '未定' };
  snapshot.members.forEach(function(row){map[asId_(row.MemberID)] = String(row.DisplayName || asId_(row.MemberID));});
  snapshot.guests.forEach(function(row){map[asId_(row.GuestID)] = String(row.DisplayName || asId_(row.GuestID));});
  return map;
}

function formatCoverSingerLabel_(singer, nameMap) {
  if (!singer) return '未設定';
  return String(singer).split(',').map(function(token){
    const raw = token.trim();
    const match = raw.match(/_(up|down|sub)$/i);
    const id = raw.replace(/_(up|down|sub)$/i,'');
    const suffix = match ? ({up:' ↑',down:' ↓',sub:' SUB'})[match[1].toLowerCase()] : '';
    return (nameMap[id] || id) + suffix;
  }).join(' / ');
}

function getCoverPrimarySingerId_(singer) {
  const token = String(singer || '').split(',')[0].trim();
  return token.replace(/_(up|down|sub)$/i,'');
}

function normalizeCoverSong_(row) {
  return {songId:asId_(row.SongID),title:String(row.Title || ''),artist:String(row.Artist || ''),releaseDate:formatCoverDate_(row.ReleaseDate)};
}

function compareCoverSongs_(a,b) {
  const ad = String(a.releaseDate || ''), bd = String(b.releaseDate || '');
  if (ad !== bd) return bd.localeCompare(ad);
  return Number(b.songId || 0) - Number(a.songId || 0);
}

function formatCoverDate_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return Utilities.formatDate(value,'Asia/Tokyo','yyyy-MM-dd');
  const s = String(value || '').trim();
  if (!s) return '';
  const d = new Date(s.replace(/\//g,'-'));
  return Number.isFinite(d.getTime()) ? Utilities.formatDate(d,'Asia/Tokyo','yyyy-MM-dd') : s;
}

function buildCoverTitle_(song, group) { return String(song.Title || '') + '(' + String(group.GroupName || '') + ' ver)'; }

function isCoverComplete_(assignments, members, parts) {
  if (!assignments || !assignments.length || !parts || assignments.length !== parts.length) return false;
  const allowed = {}; members.forEach(function(member){allowed[member.memberId]=true;}); allowed[COVER_ALL_ID_] = true;
  const originals = {};
  parts.forEach(function(part){
    const order = Number(part.order !== undefined ? part.order : part.PartOrder || 0);
    const original = part.originalMemberId !== undefined
      ? asId_(part.originalMemberId)
      : getCoverPrimarySingerId_(String(part.originalSinger !== undefined ? part.originalSinger : part.Singer || '').trim());
    originals[String(order)] = original;
  });
  const seen = {};
  return assignments.every(function(item){
    const order = String(Number(item.order || 0));
    const memberId = asId_(item.memberId);
    if (!Object.prototype.hasOwnProperty.call(originals, order) || seen[order] || !allowed[memberId]) return false;
    seen[order] = true;
    const originalId = originals[order];
    return memberId === COVER_ALL_ID_ || originalId === COVER_ALL_ID_ || !originalId || memberId !== originalId;
  });
}

function listCoverProjects_(snapshot, userId) {
  const uid = validateCoverUser_(userId);
  return buildCoverProjectSummaries_(snapshot, function(row){ return asId_(row.CreatorUserID) === uid; })
    .sort(function(a,b){return String(b.createdAt).localeCompare(String(a.createdAt));});
}

function listSharedCoverProjects_(snapshot) {
  return buildCoverProjectSummaries_(snapshot, function(row){ return asCoverBoolean_(row.IsShared); })
    .sort(function(a,b){return String(b.sharedAt).localeCompare(String(a.sharedAt));});
}

function buildCoverProjectSummaries_(snapshot, predicate) {
  const groupMap = {}; snapshot.groups.forEach(function(row){groupMap[asId_(row.GroupID)] = row;});
  const songMap = {}; snapshot.songs.forEach(function(row){songMap[asId_(row.SongID)] = row;});
  const assignmentsByProject = {};
  readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS)).forEach(function(row){
    const id = asId_(row.CoverProjectID); if(!assignmentsByProject[id])assignmentsByProject[id]=[];
    assignmentsByProject[id].push({order:Number(row.Order||0),memberId:asId_(row.MemberID)});
  });
  return readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS))
    .filter(predicate)
    .map(function(row){
      const projectId = asId_(row.CoverProjectID);
      const creatorUserId = asId_(row.CreatorUserID);
      const group = groupMap[asId_(row.CoverGroupID)] || {};
      const song = songMap[asId_(row.SourceSongID)] || {};
      const members = getCoverGroupMembers_(snapshot, asId_(row.CoverGroupID));
      return {
        projectId:projectId,creatorUserId:creatorUserId,creatorDisplayName:coverUserDisplayName_(creatorUserId),sourceSongId:asId_(row.SourceSongID),
        sourceTitle:String(song.Title || ''),sourceArtist:String(song.Artist || ''),coverGroupId:asId_(row.CoverGroupID),
        coverGroupName:String(group.GroupName || ''),coverGroupColor:normalizeHex_(group.ColorHex,'#9cecff'),title:String(row.Title || ''),
        createdAt:toCoverIso_(row.CreatedAt),isShared:asCoverBoolean_(row.IsShared),sharedAt:toCoverIso_(row.SharedAt),isComplete:isCoverComplete_(
          assignmentsByProject[projectId] || [],
          members,
          snapshot.lyrics.filter(function(part){return asId_(part.SongID) === asId_(row.SourceSongID);})
        )
      };
    });
}

function getCoverUsers_() {
  return COVER_USERS_.map(function(id){return {userId:id,displayName:coverUserDisplayName_(id)};});
}

function coverUserDisplayName_(userId) {
  const names={U001:'ももたん',U002:'みおたん',U003:'りおたん'};
  return names[asId_(userId)] || asId_(userId);
}

function asCoverBoolean_(value) {
  if (value === true) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function validateCoverUser_(userId) { const id=asId_(userId); if(COVER_USERS_.indexOf(id)<0)throw new Error('利用ユーザーを選択してください。'); return id; }
function getCoverLogSheet_(name) { const sheet=SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(name); if(!sheet)throw new Error('Log sheet not found: '+name); return sheet; }
function withCoverLock_(callback){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return callback();}finally{lock.releaseLock();}}
function normalizeHex_(value,fallback){const s=String(value||'').trim();return /^#[0-9a-f]{6}$/i.test(s)?s:fallback;}
function toCoverIso_(value){if(!value)return '';const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():'';}

function updateCoverProjectRow_(sheet, projectId, patch) {
  const values=sheet.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String), idCol=headers.indexOf('CoverProjectID');
  for(let r=1;r<values.length;r++) if(asId_(values[r][idCol])===projectId){
    Object.keys(patch).forEach(function(key){const col=headers.indexOf(key);if(col>=0)sheet.getRange(r+1,col+1).setValue(patch[key]);}); return;
  }
}

function deleteCoverAssignments_(sheet, projectId) {
  const values=sheet.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String), idCol=headers.indexOf('CoverProjectID');
  for(let r=values.length-1;r>=1;r--) if(asId_(values[r][idCol])===projectId) sheet.deleteRow(r+1);
}

function deleteCoverProjectRows_(sheet, projectId) {
  const values=sheet.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String), idCol=headers.indexOf('CoverProjectID');
  for(let r=values.length-1;r>=1;r--) if(asId_(values[r][idCol])===projectId) sheet.deleteRow(r+1);
}

function assertCoverSaved_(projectSheet, assignmentSheet, projectId, userId, songId, groupId, title, assignments) {
  const projects=readSheetObjects_(projectSheet).filter(function(row){return asId_(row.CoverProjectID)===projectId;});
  if(projects.length!==1 || asId_(projects[0].CreatorUserID)!==userId || asId_(projects[0].SourceSongID)!==songId ||
      asId_(projects[0].CoverGroupID)!==groupId || String(projects[0].Title||'')!==title) {
    throw new Error('カバープロジェクトの保存後照合に失敗しました。');
  }
  const actual=readSheetObjects_(assignmentSheet).filter(function(row){return asId_(row.CoverProjectID)===projectId;})
    .map(function(row){return Number(row.Order||0)+'|'+asId_(row.MemberID);}).sort();
  const expected=assignments.map(function(row){return Number(row.order||0)+'|'+asId_(row.memberId);}).sort();
  if(actual.length!==expected.length || actual.some(function(value,index){return value!==expected[index];})) {
    throw new Error('カバー担当の保存後照合に失敗しました。');
  }
}

function restoreCoverSnapshot_(projectSheet, assignmentSheet, projectId, project, assignments) {
  deleteCoverAssignments_(assignmentSheet, projectId);
  deleteCoverProjectRows_(projectSheet, projectId);
  if(project) appendByHeaders_(projectSheet, project);
  (assignments||[]).forEach(function(item){
    appendByHeaders_(assignmentSheet,{CoverProjectID:projectId,Order:item.order,MemberID:item.memberId});
  });
  SpreadsheetApp.flush();
}

function coverRollbackError_(error, rollbackErrors) {
  const message=error&&error.message?error.message:String(error||'保存に失敗しました。');
  return new Error(rollbackErrors&&rollbackErrors.length?message+'\n復元にも失敗しました: '+rollbackErrors.join(' / '):message);
}

function appendCoverActivity_(userId, activityType, targetId) {
  const sheet=getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
  appendByHeaders_(sheet,{ActivityID:Utilities.getUuid(),UserID:userId,ActivityType:activityType,TargetID:targetId,OccurredAt:new Date()});
}
