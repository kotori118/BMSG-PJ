/** BMSG Universe COVER MAKER */
const COVER_SOURCE_ARTISTS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','ShowMinorSavage']);
const COVER_DESTINATION_GROUPS_ = Object.freeze(['BE:FIRST','MAZZEL','STARGLOW','HANA','ShowMinorSavage','BMSG ALLSTARS']);
const COVER_ALL_ID_ = '99';
const COVER_ALLSTARS_GROUP_ID_ = '8';

function getCoverMakerBootstrap(userId) {
  const uid = validateCoverUser_(userId);
  const snapshot = getCoverCoreSnapshot_();
  const groups = buildCoverGroups_(snapshot);
  return {
    currentUserId: uid,
    users: getCoverUsers_(),
    groups: groups,
    sourceArtists: COVER_SOURCE_ARTISTS_.slice(),
    allStarMembers: getCoverAllStarMembers_(snapshot),
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
  const members = getCoverDestinationMembers_(snapshot, coverGroupId, payload.allStarMemberIds);
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
    sourceSnapshot: null,
    selectedMemberIds: isCoverAllStarsGroup_(coverGroupId) ? members.map(function(member){ return member.memberId; }) : [],
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


function getCoverExternalEditorData(payload) {
  payload = payload || {};
  const userId = validateCoverUser_(payload.userId);
  const coverGroupId = asId_(payload.coverGroupId);
  const snapshot = getCoverCoreSnapshot_();
  const group = requireCoverGroup_(snapshot, coverGroupId);
  const members = getCoverDestinationMembers_(snapshot, coverGroupId, payload.allStarMemberIds);
  if (!members.length) throw new Error('カバー担当メンバーが見つかりません。');
  const source = normalizeCoverExternalSource_(payload.sourceSnapshot);
  const song = {Title:source.title, Artist:source.artist};
  return {
    currentUserId: userId,
    projectId: '',
    sourceSong: {songId:'',title:source.title,artist:source.artist,releaseDate:'',isExternal:true},
    sourceSnapshot: {
      isExternal: true,
      title: source.title,
      artist: source.artist,
      parts: source.parts.map(function(part){ return {order:part.order,singerLabel:part.originalSingerLabel,lyrics:part.lyrics}; })
    },
    selectedMemberIds: isCoverAllStarsGroup_(coverGroupId) ? members.map(function(member){ return member.memberId; }) : [],
    coverGroup: { groupId: coverGroupId, groupName: String(group.GroupName || ''), color: normalizeHex_(group.ColorHex, '#9cecff') },
    members: [{memberId:COVER_ALL_ID_,name:'ALL',color:'#777777',isAll:true}].concat(members),
    parts: source.parts,
    assignments: source.parts.map(function(part){ return {order:part.order,memberId:part.originalMemberId}; }),
    title: buildCoverTitle_(song, group),
    creatorUserId: userId,
    creatorDisplayName: coverUserDisplayName_(userId),
    isCreator: true,
    isSaved: false,
    isShared: false,
    sharedAt: '',
    isComplete: false
  };
}

function getCoverProject(payload) {
  payload = payload || {};
  const uid = validateCoverUser_(payload.userId);
  const projectId = asId_(payload.projectId);
  const snapshot = getCoverCoreSnapshot_();
  const projectSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS);
  const sourceSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_SOURCE_SNAPSHOTS);
  const memberSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECT_MEMBERS);
  const project = readSheetObjects_(projectSheet).find(function(row){ return asId_(row.CoverProjectID) === projectId; });
  const creatorUserId = project ? asId_(project.CreatorUserID) : '';
  const isCreator = creatorUserId === uid;
  const isShared = project ? asCoverBoolean_(project.IsShared) : false;
  if (!project || (!isCreator && !isShared)) throw new Error('カバーが見つかりません。');

  const groupId = asId_(project.CoverGroupID);
  const group = requireCoverGroup_(snapshot, groupId);
  const sourceRows = getCoverSourceSnapshotRows_(sourceSheet, projectId);
  const isExternal = sourceRows.length > 0 || !asId_(project.SourceSongID);
  let sourceSong;
  let sourceSnapshot = null;
  let parts;

  if (isExternal) {
    const source = coverExternalSourceFromRows_(sourceRows);
    sourceSong = {songId:'',title:source.title,artist:source.artist,releaseDate:'',isExternal:true};
    sourceSnapshot = {
      isExternal:true,
      title:source.title,
      artist:source.artist,
      parts:source.parts.map(function(part){return {order:part.order,singerLabel:part.originalSingerLabel,lyrics:part.lyrics};})
    };
    parts = source.parts;
  } else {
    const song = snapshot.songs.find(function(row){ return asId_(row.SongID) === asId_(project.SourceSongID); });
    if (!song) throw new Error('原曲が見つかりません。');
    sourceSong = normalizeCoverSong_(song);
    const nameMap = buildCoverSingerNameMap_(snapshot);
    parts = snapshot.lyrics.filter(function(row){ return asId_(row.SongID) === asId_(project.SourceSongID); })
      .sort(function(a,b){ return Number(a.PartOrder || 0) - Number(b.PartOrder || 0); })
      .map(function(row){
        const singer = String(row.Singer || '').trim();
        return {
          order:Number(row.PartOrder || 0),
          lyrics:String(row.Lyrics || ''),
          originalSinger:singer,
          originalSingerLabel:formatCoverSingerLabel_(singer,nameMap),
          originalMemberId:getCoverPrimarySingerId_(singer)
        };
      });
  }

  const selectedMemberIds = isCoverAllStarsGroup_(groupId) ? getCoverProjectMemberIds_(memberSheet, projectId) : [];
  const members = getCoverDestinationMembers_(snapshot, groupId, selectedMemberIds);
  const assignments = readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS))
    .filter(function(row){ return asId_(row.CoverProjectID) === projectId; })
    .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; })
    .sort(function(a,b){ return a.order-b.order; });

  return {
    currentUserId: uid,
    projectId: projectId,
    sourceSong: sourceSong,
    sourceSnapshot: sourceSnapshot,
    selectedMemberIds: selectedMemberIds,
    coverGroup: { groupId: groupId, groupName: String(group.GroupName || ''), color: normalizeHex_(group.ColorHex, '#9cecff') },
    members: [{memberId:COVER_ALL_ID_,name:'ALL',color:'#777777',isAll:true}].concat(members),
    parts: parts,
    assignments: assignments,
    title: String(project.Title || buildCoverTitle_({Title:sourceSong.title,Artist:sourceSong.artist}, group)),
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
    const sourceSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_SOURCE_SNAPSHOTS);
    const memberSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECT_MEMBERS);
    const projectIdInput = asId_(payload.projectId);
    const existingRows = readSheetObjectsWithRows_(projectSheet);
    const existing = projectIdInput ? existingRows.find(function(row){ return asId_(row.CoverProjectID) === projectIdInput; }) : null;
    if (projectIdInput && !existing) throw new Error('保存対象のカバーが見つかりません。');
    if (existing && asId_(existing.CreatorUserID) !== uid) throw new Error('このカバーは編集できません。');

    const groupId = asId_(existing ? existing.CoverGroupID : payload.coverGroupId);
    const group = requireCoverGroup_(snapshot, groupId);
    const existingSourceRows = existing ? getCoverSourceSnapshotRows_(sourceSheet, projectIdInput) : [];
    const isExternal = existing
      ? (existingSourceRows.length > 0 || !asId_(existing.SourceSongID))
      : Boolean(payload.sourceSnapshot && payload.sourceSnapshot.isExternal);

    let songId = '';
    let song;
    let externalSource = null;
    let parts;
    if (isExternal) {
      externalSource = existing ? coverExternalSourceFromRows_(existingSourceRows) : normalizeCoverExternalSource_(payload.sourceSnapshot);
      song = {Title:externalSource.title,Artist:externalSource.artist};
      parts = externalSource.parts;
    } else {
      songId = asId_(existing ? existing.SourceSongID : payload.songId);
      song = snapshot.songs.find(function(row){ return asId_(row.SongID) === songId; });
      if (!song || COVER_SOURCE_ARTISTS_.indexOf(String(song.Artist || '').trim()) < 0) throw new Error('原曲が正しくありません。');
      parts = snapshot.lyrics.filter(function(row){ return asId_(row.SongID) === songId; });
    }

    const existingMemberRows = existing && isCoverAllStarsGroup_(groupId) ? getCoverProjectMemberRows_(memberSheet, projectIdInput) : [];
    const selectedMemberIds = isCoverAllStarsGroup_(groupId)
      ? (existing ? existingMemberRows.map(function(row){return asId_(row.MemberID);}).filter(Boolean) : payload.allStarMemberIds)
      : [];
    const members = getCoverDestinationMembers_(snapshot, groupId, selectedMemberIds);
    const allowed = {};
    members.forEach(function(member){ allowed[member.memberId] = true; });
    allowed[COVER_ALL_ID_] = true;

    const validOrders = {};
    const originalsByOrder = {};
    parts.forEach(function(row){
      const order = Number(row.order !== undefined ? row.order : row.PartOrder || 0);
      const original = row.originalMemberId !== undefined
        ? asId_(row.originalMemberId)
        : getCoverPrimarySingerId_(String(row.Singer || '').trim());
      validOrders[String(order)] = true;
      originalsByOrder[String(order)] = original;
    });

    const submitted = Array.isArray(payload.assignments) ? payload.assignments : [];
    if (submitted.length !== parts.length) throw new Error('歌割りの件数が一致しません。');
    const seenOrders = {};
    const assignments = submitted.map(function(item){
      const order = Number(item && item.order || 0);
      const key = String(order);
      const memberId = asId_(item && item.memberId);
      if (!validOrders[key] || seenOrders[key]) throw new Error('歌割りOrderが正しくありません。');
      seenOrders[key] = true;
      if (!memberId) throw new Error('未設定のパートがあります。');
      if (!allowed[memberId] && memberId !== originalsByOrder[key]) {
        throw new Error('選択したグループに所属しないメンバーが含まれています。');
      }
      return {order:order,memberId:memberId};
    }).sort(function(a,b){return a.order-b.order;});

    const coverParts = parts.map(function(row){
      const order = Number(row.order !== undefined ? row.order : row.PartOrder || 0);
      const original = row.originalMemberId !== undefined
        ? asId_(row.originalMemberId)
        : getCoverPrimarySingerId_(String(row.Singer || '').trim());
      return {order:order,originalMemberId:original};
    });
    const incomplete = !isCoverComplete_(assignments, members, coverParts);
    if (incomplete && !payload.confirmIncomplete) {
      return { requiresConfirm: true, message: '原曲担当のまま残っているパートがあります。', isComplete: false };
    }

    const beforeAssignments = existing ? readSheetObjects_(assignmentSheet)
      .filter(function(row){ return asId_(row.CoverProjectID) === projectIdInput; })
      .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; }) : [];
    const beforeSourceRows = existingSourceRows;
    const beforeMemberRows = existingMemberRows;
    const wasComplete = existing ? isCoverComplete_(beforeAssignments, members, coverParts) : false;
    const nowComplete = isCoverComplete_(assignments, members, coverParts);
    const projectId = existing ? projectIdInput : Utilities.getUuid();
    const title = buildCoverTitle_(song, group);
    const createdAt = existing ? existing.CreatedAt : new Date();

    const sourceRecords = isExternal ? externalSource.parts.map(function(part){
      return {
        CoverProjectID:projectId,
        SourceTitle:externalSource.title,
        SourceArtist:externalSource.artist,
        Order:part.order,
        OriginalSingerKey:part.originalMemberId,
        OriginalSingerLabel:part.originalSingerLabel,
        Lyrics:part.lyrics
      };
    }) : [];
    const memberRecords = isCoverAllStarsGroup_(groupId) ? members.map(function(member,index){
      return {CoverProjectID:projectId,DisplayOrder:index+1,MemberID:member.memberId};
    }) : [];

    const beforeProject = existing ? Object.assign({}, existing) : null;
    let writeStarted = false;
    try {
      writeStarted = true;
      let projectRowNumber;
      let sourceWrite = null;
      let memberWrite = null;
      if (!existing) {
        projectRowNumber = appendCoverRecordsByHeaders_(projectSheet, [{CoverProjectID:projectId,CreatorUserID:uid,SourceSongID:isExternal?'':songId,CoverGroupID:groupId,Title:title,CreatedAt:createdAt,IsShared:false,SharedAt:''}]).startRow;
        sourceWrite = appendCoverRecordsByHeaders_(sourceSheet, sourceRecords);
        memberWrite = appendCoverRecordsByHeaders_(memberSheet, memberRecords);
      } else {
        projectRowNumber = updateCoverProjectRow_(projectSheet, projectId, {Title:title});
      }
      deleteCoverAssignments_(assignmentSheet, projectId);
      const assignmentWrite = appendCoverRecordsByHeaders_(assignmentSheet, assignments.map(function(item){
        return {CoverProjectID:projectId,Order:item.order,MemberID:item.memberId};
      }));
      SpreadsheetApp.flush();
      assertCoverSaved_(projectSheet, assignmentSheet, sourceSheet, memberSheet, projectRowNumber, assignmentWrite, sourceWrite, memberWrite, projectId, uid, isExternal?'':songId, groupId, title, assignments, sourceRecords, memberRecords);

      if (nowComplete && !wasComplete) try { appendCoverActivity_(uid, 'CREATE_COVER', projectId); } catch (error) { console.error(error); }
      return {ok:true,projectId:projectId,title:title,isComplete:nowComplete,requiresConfirm:false,project:{
        projectId:projectId,creatorUserId:uid,creatorDisplayName:coverUserDisplayName_(uid),sourceSongId:isExternal?'':songId,
        sourceTitle:String(song.Title||''),sourceArtist:String(song.Artist||''),coverGroupId:groupId,
        coverGroupName:String(group.GroupName||''),coverGroupColor:normalizeHex_(group.ColorHex,'#9cecff'),title:title,
        createdAt:toCoverIso_(createdAt),isShared:existing?asCoverBoolean_(existing.IsShared):false,
        sharedAt:existing?toCoverIso_(existing.SharedAt):'',isComplete:nowComplete
      }};
    } catch (error) {
      if (!writeStarted) throw error;
      const rollbackErrors = [];
      try {
        restoreCoverSnapshot_(projectSheet, assignmentSheet, sourceSheet, memberSheet, projectId, beforeProject, beforeAssignments, beforeSourceRows, beforeMemberRows);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
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
    const sourceSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_SOURCE_SNAPSHOTS);
    const memberSheet = getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECT_MEMBERS);
    const values = projectSheet.getDataRange().getValues();
    if (values.length < 2) throw new Error('カバーが見つかりません。');
    const headers = values[0].map(String);
    const idCol = headers.indexOf('CoverProjectID');
    const creatorCol = headers.indexOf('CreatorUserID');
    let rowIndex = -1;
    for (let i=1;i<values.length;i++) {
      if (asId_(values[i][idCol]) === projectId) {
        if (asId_(values[i][creatorCol]) !== uid) throw new Error('このカバーは削除できません。');
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex < 0) throw new Error('カバーが見つかりません。');

    const beforeProject = readSheetObjectsWithRows_(projectSheet).find(function(row){ return asId_(row.CoverProjectID) === projectId; });
    const beforeAssignments = readSheetObjects_(assignmentSheet).filter(function(row){ return asId_(row.CoverProjectID) === projectId; })
      .map(function(row){ return {order:Number(row.Order || 0),memberId:asId_(row.MemberID)}; });
    const beforeSourceRows = getCoverSourceSnapshotRows_(sourceSheet, projectId);
    const beforeMemberRows = getCoverProjectMemberRows_(memberSheet, projectId);

    try {
      deleteCoverAssignments_(assignmentSheet, projectId);
      deleteCoverProjectRows_(sourceSheet, projectId);
      deleteCoverProjectRows_(memberSheet, projectId);
      projectSheet.deleteRow(rowIndex);
      SpreadsheetApp.flush();
      if (readSheetObjects_(projectSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;}) ||
          readSheetObjects_(assignmentSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;}) ||
          readSheetObjects_(sourceSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;}) ||
          readSheetObjects_(memberSheet).some(function(row){return asId_(row.CoverProjectID)===projectId;})) {
        throw new Error('カバーの削除後照合に失敗しました。');
      }
      return {ok:true};
    } catch (error) {
      const rollbackErrors = [];
      try {
        restoreCoverSnapshot_(projectSheet, assignmentSheet, sourceSheet, memberSheet, projectId, beforeProject, beforeAssignments, beforeSourceRows, beforeMemberRows);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
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


function isCoverAllStarsGroup_(groupId) {
  return asId_(groupId) === COVER_ALLSTARS_GROUP_ID_;
}

function getCoverAllStarMembers_(snapshot) {
  return snapshot.members.slice()
    .sort(function(a,b){return Number(a.DisplayOrder||999)-Number(b.DisplayOrder||999);})
    .map(function(member){
      return {
        memberId:asId_(member.MemberID),
        name:String(member.DisplayName||''),
        color:normalizeHex_(member.ColorHex,'#777777')
      };
    })
    .filter(function(member){return member.memberId && member.name;});
}

function getCoverDestinationMembers_(snapshot, groupId, selectedIds) {
  if (!isCoverAllStarsGroup_(groupId)) return getCoverGroupMembers_(snapshot, groupId);
  const allMembers = getCoverAllStarMembers_(snapshot);
  const requested = [];
  const seen = {};
  (Array.isArray(selectedIds) ? selectedIds : []).forEach(function(value){
    const id = asId_(value);
    if (id && !seen[id]) { seen[id] = true; requested.push(id); }
  });
  if (!requested.length) throw new Error('BMSG ALLSTARSの参加メンバーを1人以上選択してください。');
  const available = {};
  allMembers.forEach(function(member){available[member.memberId]=true;});
  if (requested.some(function(id){return !available[id];})) throw new Error('BMSG ALLSTARSの参加メンバーが正しくありません。');
  return allMembers.filter(function(member){return seen[member.memberId];});
}

function normalizeCoverExternalSource_(source) {
  source = source || {};
  const title = String(source.title || '').trim();
  const artist = String(source.artist || '').trim();
  if (!title) throw new Error('曲名を入力してください。');
  if (!artist) throw new Error('原アーティスト名を入力してください。');
  const inputParts = Array.isArray(source.parts) ? source.parts : [];
  if (!inputParts.length) throw new Error('歌割りを入力してください。');

  const singerKeyMap = {};
  let singerKeyIndex = 1;
  const parts = inputParts.map(function(item,index){
    const label = String(item && (item.singerLabel !== undefined ? item.singerLabel : item.originalSingerLabel) || '').trim();
    const lyrics = String(item && item.lyrics || '').trim();
    if (!label || !lyrics) throw new Error('歌割りの歌唱者または歌詞が空欄です。');
    if (!singerKeyMap[label]) {
      singerKeyMap[label] = 'EXT' + String(singerKeyIndex).padStart(3,'0');
      singerKeyIndex += 1;
    }
    const key = singerKeyMap[label];
    return {
      order:index+1,
      lyrics:lyrics,
      originalSinger:key,
      originalSingerLabel:label,
      originalMemberId:key
    };
  });
  return {title:title,artist:artist,parts:parts};
}

function coverExternalSourceFromRows_(rows) {
  const sorted = (rows || []).slice().sort(function(a,b){return Number(a.Order||0)-Number(b.Order||0);});
  if (!sorted.length) throw new Error('外部曲の保存データが見つかりません。');
  const title = String(sorted[0].SourceTitle || '').trim();
  const artist = String(sorted[0].SourceArtist || '').trim();
  const parts = sorted.map(function(row){
    return {
      order:Number(row.Order||0),
      lyrics:String(row.Lyrics||''),
      originalSinger:asId_(row.OriginalSingerKey),
      originalSingerLabel:String(row.OriginalSingerLabel||''),
      originalMemberId:asId_(row.OriginalSingerKey)
    };
  });
  if (!title || !artist || parts.some(function(part){return !part.order || !part.originalMemberId || !part.originalSingerLabel || !part.lyrics;})) {
    throw new Error('外部曲の保存データが不完全です。');
  }
  return {title:title,artist:artist,parts:parts};
}

function getCoverSourceSnapshotRows_(sheet, projectId) {
  return readSheetObjects_(sheet)
    .filter(function(row){return asId_(row.CoverProjectID)===projectId;})
    .sort(function(a,b){return Number(a.Order||0)-Number(b.Order||0);});
}

function getCoverProjectMemberRows_(sheet, projectId) {
  return readSheetObjects_(sheet)
    .filter(function(row){return asId_(row.CoverProjectID)===projectId;})
    .sort(function(a,b){return Number(a.DisplayOrder||0)-Number(b.DisplayOrder||0);});
}

function getCoverProjectMemberIds_(sheet, projectId) {
  return getCoverProjectMemberRows_(sheet, projectId).map(function(row){return asId_(row.MemberID);}).filter(Boolean);
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
  const sourceRowsByProject = {};
  const memberIdsByProject = {};

  readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_ASSIGNMENTS)).forEach(function(row){
    const id = asId_(row.CoverProjectID); if(!assignmentsByProject[id])assignmentsByProject[id]=[];
    assignmentsByProject[id].push({order:Number(row.Order||0),memberId:asId_(row.MemberID)});
  });
  readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_SOURCE_SNAPSHOTS)).forEach(function(row){
    const id = asId_(row.CoverProjectID); if(!sourceRowsByProject[id])sourceRowsByProject[id]=[];
    sourceRowsByProject[id].push(row);
  });
  readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECT_MEMBERS)).forEach(function(row){
    const id = asId_(row.CoverProjectID); if(!memberIdsByProject[id])memberIdsByProject[id]=[];
    memberIdsByProject[id].push({displayOrder:Number(row.DisplayOrder||0),memberId:asId_(row.MemberID)});
  });
  Object.keys(memberIdsByProject).forEach(function(id){
    memberIdsByProject[id].sort(function(a,b){return a.displayOrder-b.displayOrder;});
  });

  return readSheetObjects_(getCoverLogSheet_(UNIVERSE_CONFIG.SHEETS.COVER_PROJECTS))
    .filter(predicate)
    .map(function(row){
      const projectId = asId_(row.CoverProjectID);
      const creatorUserId = asId_(row.CreatorUserID);
      const groupId = asId_(row.CoverGroupID);
      const group = groupMap[groupId] || {};
      const externalRows = sourceRowsByProject[projectId] || [];
      const isExternal = externalRows.length > 0 || !asId_(row.SourceSongID);
      let sourceTitle = '';
      let sourceArtist = '';
      let parts = [];
      if (isExternal) {
        const source = coverExternalSourceFromRows_(externalRows);
        sourceTitle = source.title;
        sourceArtist = source.artist;
        parts = source.parts;
      } else {
        const song = songMap[asId_(row.SourceSongID)] || {};
        sourceTitle = String(song.Title || '');
        sourceArtist = String(song.Artist || '');
        parts = snapshot.lyrics.filter(function(part){return asId_(part.SongID) === asId_(row.SourceSongID);});
      }
      const selectedIds = (memberIdsByProject[projectId] || []).map(function(item){return item.memberId;});
      const members = getCoverDestinationMembers_(snapshot, groupId, selectedIds);
      return {
        projectId:projectId,
        creatorUserId:creatorUserId,
        creatorDisplayName:coverUserDisplayName_(creatorUserId),
        sourceSongId:isExternal?'':asId_(row.SourceSongID),
        sourceTitle:sourceTitle,
        sourceArtist:sourceArtist,
        coverGroupId:groupId,
        coverGroupName:String(group.GroupName || ''),
        coverGroupColor:normalizeHex_(group.ColorHex,'#9cecff'),
        title:String(row.Title || ''),
        createdAt:toCoverIso_(row.CreatedAt),
        isShared:asCoverBoolean_(row.IsShared),
        sharedAt:toCoverIso_(row.SharedAt),
        isComplete:isCoverComplete_(assignmentsByProject[projectId] || [], members, parts)
      };
    });
}

function getCoverUsers_() {
  return UNIVERSE_CONFIG.USER_IDS.map(function(id){return {userId:id,displayName:coverUserDisplayName_(id)};});
}

function coverUserDisplayName_(userId) {
  const id = asId_(userId);
  return UNIVERSE_CONFIG.USER_DISPLAY_NAMES[id] || id;
}

function asCoverBoolean_(value) {
  if (value === true) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function validateCoverUser_(userId) { const id=asId_(userId); if(UNIVERSE_CONFIG.USER_IDS.indexOf(id)<0)throw new Error('利用ユーザーを選択してください。'); return id; }
function getCoverLogSheet_(name) { const sheet=SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(name); if(!sheet)throw new Error('Log sheet not found: '+name); return sheet; }
function withCoverLock_(callback){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return callback();}finally{lock.releaseLock();}}
function normalizeHex_(value,fallback){const s=String(value||'').trim();return /^#[0-9a-f]{6}$/i.test(s)?s:fallback;}
function toCoverIso_(value){if(!value)return '';const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():'';}

function updateCoverProjectRow_(sheet, projectId, patch) {
  const values=sheet.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String), idCol=headers.indexOf('CoverProjectID');
  for(let r=1;r<values.length;r++) if(asId_(values[r][idCol])===projectId){
    Object.keys(patch).forEach(function(key){const col=headers.indexOf(key);if(col>=0)sheet.getRange(r+1,col+1).setValue(patch[key]);}); return r+1;
  }
}

function deleteCoverAssignments_(sheet, projectId) {
  deleteCoverProjectRows_(sheet, projectId);
}

function deleteCoverProjectRows_(sheet, projectId) {
  const values=sheet.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String), idCol=headers.indexOf('CoverProjectID');
  const rows=[];
  for(let r=1;r<values.length;r++) if(asId_(values[r][idCol])===projectId) rows.push(r+1);
  const groups=[];
  rows.forEach(function(row){
    const last=groups[groups.length-1];
    if(last&&last.start+last.count===row) last.count++;
    else groups.push({start:row,count:1});
  });
  groups.reverse().forEach(function(group){sheet.deleteRows(group.start,group.count);});
}

function appendCoverRecordsByHeaders_(sheet, records) {
  if(!records||!records.length)return null;
  const lastColumn=sheet.getLastColumn();
  if(lastColumn<1)throw new Error('保存先のヘッダーが見つかりません。');
  const headers=sheet.getRange(1,1,1,lastColumn).getValues()[0].map(String);
  const rows=records.map(function(record){
    return headers.map(function(header){return record[header]===undefined?'':record[header];});
  });
  const startRow=sheet.getLastRow()+1;
  sheet.getRange(startRow,1,rows.length,headers.length).setValues(rows);
  return {startRow:startRow,rowCount:rows.length};
}

function readCoverWrittenRecords_(sheet, write) {
  if(!write||!write.rowCount)return [];
  const lastColumn=sheet.getLastColumn();
  const headers=sheet.getRange(1,1,1,lastColumn).getValues()[0].map(String);
  return sheet.getRange(write.startRow,1,write.rowCount,lastColumn).getValues().map(function(row){
    const record={};headers.forEach(function(header,index){if(header)record[header]=row[index];});return record;
  });
}

function assertCoverSaved_(projectSheet, assignmentSheet, sourceSheet, memberSheet, projectRowNumber, assignmentWrite, sourceWrite, memberWrite, projectId, userId, songId, groupId, title, assignments, sourceRecords, memberRecords) {
  const projects=readCoverWrittenRecords_(projectSheet,{startRow:projectRowNumber,rowCount:1});
  if(projects.length!==1 || asId_(projects[0].CoverProjectID)!==projectId || asId_(projects[0].CreatorUserID)!==userId || asId_(projects[0].SourceSongID)!==songId ||
      asId_(projects[0].CoverGroupID)!==groupId || String(projects[0].Title||'')!==title) {
    throw new Error('カバープロジェクトの保存後照合に失敗しました。');
  }
  const actual=readCoverWrittenRecords_(assignmentSheet,assignmentWrite)
    .map(function(row){return Number(row.Order||0)+'|'+asId_(row.MemberID);}).sort();
  const expected=assignments.map(function(row){return Number(row.order||0)+'|'+asId_(row.memberId);}).sort();
  if(actual.length!==expected.length || actual.some(function(value,index){return value!==expected[index];})) {
    throw new Error('カバー担当の保存後照合に失敗しました。');
  }

  const actualSource=readCoverWrittenRecords_(sourceSheet,sourceWrite).map(function(row){
    return [String(row.SourceTitle||''),String(row.SourceArtist||''),Number(row.Order||0),asId_(row.OriginalSingerKey),String(row.OriginalSingerLabel||''),String(row.Lyrics||'')].join('|');
  }).sort();
  const expectedSource=(sourceRecords||[]).map(function(row){
    return [String(row.SourceTitle||''),String(row.SourceArtist||''),Number(row.Order||0),asId_(row.OriginalSingerKey),String(row.OriginalSingerLabel||''),String(row.Lyrics||'')].join('|');
  }).sort();
  if(sourceWrite && (actualSource.length!==expectedSource.length || actualSource.some(function(value,index){return value!==expectedSource[index];}))) {
    throw new Error('外部曲Snapshotの保存後照合に失敗しました。');
  }

  const actualMembers=readCoverWrittenRecords_(memberSheet,memberWrite)
    .map(function(row){return Number(row.DisplayOrder||0)+'|'+asId_(row.MemberID);}).sort();
  const expectedMembers=(memberRecords||[])
    .map(function(row){return Number(row.DisplayOrder||0)+'|'+asId_(row.MemberID);}).sort();
  if(memberWrite && (actualMembers.length!==expectedMembers.length || actualMembers.some(function(value,index){return value!==expectedMembers[index];}))) {
    throw new Error('BMSG ALLSTARS参加メンバーの保存後照合に失敗しました。');
  }
}

function restoreCoverSnapshot_(projectSheet, assignmentSheet, sourceSheet, memberSheet, projectId, project, assignments, sourceRows, memberRows) {
  deleteCoverAssignments_(assignmentSheet, projectId);
  deleteCoverProjectRows_(sourceSheet, projectId);
  deleteCoverProjectRows_(memberSheet, projectId);
  deleteCoverProjectRows_(projectSheet, projectId);
  if(project) appendByHeaders_(projectSheet, project);
  appendCoverRecordsByHeaders_(assignmentSheet,(assignments||[]).map(function(item){
    return {CoverProjectID:projectId,Order:item.order,MemberID:item.memberId};
  }));
  appendCoverRecordsByHeaders_(sourceSheet,sourceRows||[]);
  appendCoverRecordsByHeaders_(memberSheet,memberRows||[]);
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
