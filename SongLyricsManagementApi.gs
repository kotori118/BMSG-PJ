/** SETTINGS > 管理 > 楽曲・歌詞管理 */
const SLM_USERS_ = Object.freeze(['U001','U002','U003']);
const SLM_FORMS_ = Object.freeze(['シングル','アルバム','デジタルリリース','その他']);
const SLM_ROLES_ = Object.freeze(['MAIN','UP','DOWN','SUB']);
const SLM_SONG_BANDS_ = Object.freeze({'BE:FIRST':1000,'MAZZEL':2000,'STARGLOW':3000,'HANA':4000,DEFAULT:5000});
const SLM_SPECIAL_SINGERS_ = Object.freeze({'99':'ALL','109':'その他'});

function getSongLyricsManagementBootstrap(userId) {
  slmRequireUser_(userId);
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const songs = slmReadObjects_(ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.SONGS));
  const groups = slmReadObjects_(ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.GROUPS));
  const members = slmReadObjects_(ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const guests = slmReadObjects_(ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.GUESTS));
  const artistMap = {};
  groups.forEach(function(row){ const name=String(row.GroupName||'').trim(); if(name) artistMap[name]=true; });
  members.forEach(function(row){ const name=String(row.DisplayName||'').trim(); if(name) artistMap[name]=true; });
  artistMap.UNIT = true;
  const artistPriority = {'BE:FIRST':1,'MAZZEL':2,'STARGLOW':3,'HANA':4,'UNIT':9998};
  const artists = Object.keys(artistMap).sort(function(a,b){
    const pa=artistPriority[a]||1000, pb=artistPriority[b]||1000;
    return pa-pb || a.localeCompare(b,'ja');
  });
  const normalizedSongs = songs.map(slmSongModel_).filter(function(song){return song.songId&&song.title&&song.artist;});
  normalizedSongs.sort(slmSongSort_);
  const existingArtists = Array.from(new Set(normalizedSongs.map(function(song){return song.artist;}))).sort(function(a,b){
    const pa=artistPriority[a]||1000, pb=artistPriority[b]||1000;
    return pa-pb || a.localeCompare(b,'ja');
  });
  return {
    artists: artists,
    existingArtists: existingArtists,
    songs: normalizedSongs,
    singerOptions: slmSingerOptions_(members, guests),
    forms: SLM_FORMS_.slice(),
    roles: [
      {value:'MAIN',label:'MAIN'},
      {value:'UP',label:'UP'},
      {value:'DOWN',label:'DOWN'},
      {value:'SUB',label:'SUB'}
    ]
  };
}

function parseSongLyricsManagement(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  const raw = String(payload.rawLyrics || '');
  if (!raw.trim()) throw new Error('歌詞を入力してください。');
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const masters = slmSingerMaster_(ss);
  const unknownGuests = slmFindUnknownGuests_(raw, masters);
  const errors = [];
  const parts = slmParseParts_(raw, masters, errors);
  if (!parts.length) errors.push('歌詞パートを作成できませんでした。');
  return {
    parts: parts,
    unknownGuests: unknownGuests,
    errors: errors,
    canRegister: unknownGuests.length === 0 && errors.length === 0
  };
}

function registerSongLyricsGuest(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  const name = String(payload.name || '').trim();
  if (!name || !slmLooksLikeName_(name)) throw new Error('Guest名を確認してください。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('別の更新処理が進行中です。少し待ってからもう一度試してください。');
  let reservation = null;
  let appendedRow = 0;
  try {
    const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const members = slmReadObjects_(ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.MEMBERS));
    const guestsSheet = slmRequireSheet_(ss, UNIVERSE_CONFIG.SHEETS.GUESTS);
    const guests = slmReadObjects_(guestsSheet);
    if (members.some(function(row){return String(row.DisplayName||'').trim()===name;}) || guests.some(function(row){return String(row.DisplayName||'').trim()===name;})) {
      return {ok:true, alreadyExists:true, name:name};
    }
    const liveMax = guests.reduce(function(max,row){const n=Number(slmId_(row.GuestID)); return Number.isFinite(n)?Math.max(max,n):max;},0);
    reservation = reserveUniverseId_('GUEST','GLOBAL',liveMax,null,'BMSG-PJ','楽曲・歌詞管理 Guest登録: '+name);
    appendedRow = slmAppendRecord_(guestsSheet,{GuestID:reservation.issuedId,DisplayName:name});
    SpreadsheetApp.flush();
    const verified = slmReadObjects_(guestsSheet).filter(function(row){return slmId_(row.GuestID)===reservation.issuedId && String(row.DisplayName||'').trim()===name;});
    if (verified.length !== 1) throw new Error('Guest登録後の照合に失敗しました。');
    finalizeUniverseIdReservation_(reservation,true,'Guest登録完了: '+name);
    return {ok:true, guestId:reservation.issuedId, name:name};
  } catch (error) {
    if (appendedRow) {
      try {
        const ss=SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
        const sheet=ss.getSheetByName(UNIVERSE_CONFIG.SHEETS.GUESTS);
        if(sheet && appendedRow<=sheet.getLastRow()) sheet.deleteRow(appendedRow);
      } catch(ignore){}
    }
    if (reservation) { try { finalizeUniverseIdReservation_(reservation,false,'Guest登録失敗'); } catch(ignore){} }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function saveNewSongLyricsManagement(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  const input = slmNormalizeSongInput_(payload.song || {});
  const creditsInput = slmNormalizeCreditsInput_(payload.credits || {});
  const rawLyrics = String(payload.rawLyrics || '');
  if (!rawLyrics.trim()) throw new Error('歌詞を入力してください。');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('別の更新処理が進行中です。少し待ってからもう一度試してください。');
  let reservation = null;
  const rollback = [];
  try {
    const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const songsSheet = slmRequireSheet_(ss, UNIVERSE_CONFIG.SHEETS.SONGS);
    const currentSongs = slmReadObjects_(songsSheet).map(slmSongModel_);
    const duplicate = currentSongs.find(function(song){return song.title===input.title && song.artist===input.artist;});
    if (duplicate) return {ok:false, duplicate:true, songId:duplicate.songId, title:duplicate.title, artist:duplicate.artist};
    slmAssertArtistCandidate_(ss, input.artist);
    slmAssertOriginalSong_(currentSongs, creditsInput.originalSongId, '');

    const masters = slmSingerMaster_(ss);
    const unknownGuests = slmFindUnknownGuests_(rawLyrics, masters);
    if (unknownGuests.length) throw new Error('未登録のSingerがあります: ' + unknownGuests.join('、'));
    const parseErrors = [];
    const parts = slmParseParts_(rawLyrics, masters, parseErrors);
    if (parseErrors.length || !parts.length) throw new Error(parseErrors.concat(!parts.length?['歌詞パートを作成できませんでした。']:[]).join('\n'));

    const band = SLM_SONG_BANDS_[input.artist] || SLM_SONG_BANDS_.DEFAULT;
    const bandMax = band + 999;
    const liveMax = currentSongs.reduce(function(max,song){
      const n=Number(song.songId); return Number.isFinite(n)&&n>=band&&n<=bandMax?Math.max(max,n):max;
    },band-1);
    reservation = reserveUniverseId_('SONG',String(band),liveMax,null,'BMSG-PJ','楽曲・歌詞管理 新規曲: '+input.title);
    const songId = reservation.issuedId;

    const songRow = slmAppendRecord_(songsSheet,{
      SongID:songId,Title:input.title,Artist:input.artist,ReleaseDate:input.releaseDateValue,
      Form:input.form,CDTitle:input.cdTitle,IsTitleTrack:input.isTitleTrack
    });
    rollback.push({sheet:songsSheet,row:songRow});

    const creditsSheet = slmRequireSheet_(ss, UNIVERSE_CONFIG.SHEETS.SONG_CREDITS);
    const creditRow = slmAppendRecord_(creditsSheet,{
      SongID:songId,Title:input.title,Lyricists:creditsInput.lyricists,Composers:creditsInput.composers,
      Choreographers:creditsInput.choreographers,OriginalSongID:creditsInput.originalSongId
    });
    rollback.push({sheet:creditsSheet,row:creditRow});

    const partsSheet = slmRequireSheet_(ss, UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
    parts.forEach(function(part,index){
      const row = slmAppendRecord_(partsSheet,{SongID:songId,PartOrder:index+1,Singer:part.singer,Lyrics:part.lyrics});
      rollback.push({sheet:partsSheet,row:row});
    });

    if (input.artist === 'BE:FIRST') {
      const metricsSheet = slmRequireSheet_(ss, UNIVERSE_CONFIG.SHEETS.PERFORMANCE_METRICS);
      if (!findPerformanceTimerSongRow_(metricsSheet, songId)) {
        const row = Math.max(3, metricsSheet.getLastRow()+1);
        metricsSheet.getRange(row,1).setValue(songId);
        rollback.push({sheet:metricsSheet,row:row});
      }
    }

    SpreadsheetApp.flush();
    const verifySong = slmReadObjects_(songsSheet).filter(function(row){return slmId_(row.SongID)===songId;});
    const verifyParts = slmReadObjects_(partsSheet).filter(function(row){return slmId_(row.SongID)===songId;});
    if (verifySong.length !== 1 || verifyParts.length !== parts.length) throw new Error('登録後の照合に失敗しました。');
    finalizeUniverseIdReservation_(reservation,true,'新規曲登録完了: '+input.title);
    slmClearCaches_();
    return {ok:true, songId:songId, title:input.title, artist:input.artist};
  } catch (error) {
    rollback.sort(function(a,b){return b.row-a.row;}).forEach(function(item){
      try { if(item.row>=2 && item.row<=item.sheet.getLastRow()) item.sheet.deleteRow(item.row); } catch(ignore){}
    });
    if (reservation) { try { finalizeUniverseIdReservation_(reservation,false,'新規曲登録失敗'); } catch(ignore){} }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getSongLyricsManagementSong(userId, songId) {
  slmRequireUser_(userId);
  const id = slmId_(songId);
  if (!id) throw new Error('曲を選択してください。');
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const songRows = slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONGS));
  const row = songRows.find(function(item){return slmId_(item.SongID)===id;});
  if (!row) throw new Error('曲が見つかりません。');
  const credits = slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONG_CREDITS)).find(function(item){return slmId_(item.SongID)===id;}) || {};
  const singerMap = slmSingerMap_(ss);
  const parts = slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS))
    .filter(function(item){return slmId_(item.SongID)===id;})
    .sort(function(a,b){return Number(a.PartOrder)-Number(b.PartOrder);})
    .map(function(item,index){
      return {partOrder:index+1,singer:String(item.Singer||''),singers:slmDecodeSinger_(String(item.Singer||''),singerMap),lyrics:String(item.Lyrics||'')};
    });
  const song = slmSongModel_(row);
  return {
    song: song,
    credits: {
      lyricists:String(credits.Lyricists||''), composers:String(credits.Composers||''),
      choreographers:String(credits.Choreographers||''), originalSongId:slmId_(credits.OriginalSongID)
    },
    parts: parts
  };
}

function saveSongLyricsManagementInfo(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  const songId = slmId_(payload.songId);
  const input = slmNormalizeSongInput_(payload.song || {});
  if (!songId) throw new Error('SongIDがありません。');
  const lock=LockService.getScriptLock(); if(!lock.tryLock(30000))throw new Error('別の更新処理が進行中です。');
  try{
    const ss=SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const sheet=slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONGS);
    const table=slmReadTable_(sheet);
    const target=table.rows.filter(function(row){return slmId_(row.record.SongID)===songId;});
    if(target.length!==1)throw new Error('06_SongsでSongIDを一意に確認できません。');
    const currentArtist=String(target[0].record.Artist||'').trim();
    if(input.artist!==currentArtist)throw new Error('登録後のARTISTは変更できません。');
    slmSetRecord_(sheet,target[0].rowNumber,table.map,{
      Title:input.title,ReleaseDate:input.releaseDateValue,Form:input.form,CDTitle:input.cdTitle,IsTitleTrack:input.isTitleTrack
    });
    const creditsSheet=slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONG_CREDITS);
    const creditsTable=slmReadTable_(creditsSheet);
    const credit=creditsTable.rows.find(function(row){return slmId_(row.record.SongID)===songId;});
    if(credit && creditsTable.map.Title!=null) creditsSheet.getRange(credit.rowNumber,creditsTable.map.Title+1).setValue(input.title);
    SpreadsheetApp.flush(); slmClearCaches_();
    return {ok:true,songId:songId};
  }finally{lock.releaseLock();}
}

function saveSongLyricsManagementCredits(payload) {
  payload=payload||{}; slmRequireUser_(payload.userId);
  const songId=slmId_(payload.songId); if(!songId)throw new Error('SongIDがありません。');
  const input=slmNormalizeCreditsInput_(payload.credits||{});
  const lock=LockService.getScriptLock(); if(!lock.tryLock(30000))throw new Error('別の更新処理が進行中です。');
  try{
    const ss=SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const songs=slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONGS)).map(slmSongModel_);
    const song=songs.find(function(item){return item.songId===songId;}); if(!song)throw new Error('曲が見つかりません。');
    slmAssertOriginalSong_(songs,input.originalSongId,songId);
    const sheet=slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONG_CREDITS), table=slmReadTable_(sheet);
    const matches=table.rows.filter(function(row){return slmId_(row.record.SongID)===songId;});
    if(matches.length>1)throw new Error('07_SongCreditsでSongIDが重複しています。');
    const record={SongID:songId,Title:song.title,Lyricists:input.lyricists,Composers:input.composers,Choreographers:input.choreographers,OriginalSongID:input.originalSongId};
    if(matches.length) slmSetRecord_(sheet,matches[0].rowNumber,table.map,record); else slmAppendRecord_(sheet,record);
    SpreadsheetApp.flush(); slmClearCaches_(); return {ok:true,songId:songId};
  }finally{lock.releaseLock();}
}

function saveSongLyricsManagementLyrics(payload) {
  payload=payload||{}; slmRequireUser_(payload.userId);
  const songId=slmId_(payload.songId); if(!songId)throw new Error('SongIDがありません。');
  const incoming=Array.isArray(payload.parts)?payload.parts:[]; if(!incoming.length)throw new Error('歌詞パートがありません。');
  const lock=LockService.getScriptLock(); if(!lock.tryLock(30000))throw new Error('別の更新処理が進行中です。');
  let oldRows=[];
  try{
    const ss=SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    const songExists=slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.SONGS)).some(function(row){return slmId_(row.SongID)===songId;});
    if(!songExists)throw new Error('曲が見つかりません。');
    const singerMap=slmSingerMap_(ss);
    const normalized=incoming.map(function(part,index){
      const lyrics=String(part.lyrics||'').trim(); if(!lyrics)throw new Error('Part '+(index+1)+' の歌詞が空です。');
      const singer=slmEncodeSingerAssignments_(part.singers,singerMap); if(!singer)throw new Error('Part '+(index+1)+' のSingerが空です。');
      return {SongID:songId,PartOrder:index+1,Singer:singer,Lyrics:lyrics};
    });
    const sheet=slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS), table=slmReadTable_(sheet);
    oldRows=table.rows.filter(function(row){return slmId_(row.record.SongID)===songId;}).map(function(row){return {rowNumber:row.rowNumber,record:row.record};});
    oldRows.slice().sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(row){sheet.deleteRow(row.rowNumber);});
    normalized.forEach(function(record){slmAppendRecord_(sheet,record);});
    SpreadsheetApp.flush();
    const verify=slmReadObjects_(sheet).filter(function(row){return slmId_(row.SongID)===songId;}).sort(function(a,b){return Number(a.PartOrder)-Number(b.PartOrder);});
    if(verify.length!==normalized.length)throw new Error('歌詞保存後の照合に失敗しました。');
    normalized.forEach(function(record,index){
      if(Number(verify[index].PartOrder)!==record.PartOrder||String(verify[index].Singer||'')!==record.Singer||String(verify[index].Lyrics||'')!==record.Lyrics)throw new Error('歌詞保存後の照合に失敗しました。');
    });
    slmClearCaches_(); return {ok:true,songId:songId,partCount:normalized.length};
  }catch(error){
    if(oldRows.length){
      try{
        const ss=SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID), sheet=slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS), table=slmReadTable_(sheet);
        table.rows.filter(function(row){return slmId_(row.record.SongID)===songId;}).sort(function(a,b){return b.rowNumber-a.rowNumber;}).forEach(function(row){sheet.deleteRow(row.rowNumber);});
        oldRows.sort(function(a,b){return a.rowNumber-b.rowNumber;}).forEach(function(row){slmAppendRecord_(sheet,row.record);});
        SpreadsheetApp.flush();
      }catch(ignore){}
    }
    throw error;
  }finally{lock.releaseLock();}
}

function slmRequireUser_(userId){ if(SLM_USERS_.indexOf(String(userId||'').trim())<0)throw new Error('利用ユーザーを選択してください。'); }
function slmId_(value){return value==null?'':String(value).trim().replace(/\.0+$/,'');}
function slmRequireSheet_(ss,name){const sheet=ss.getSheetByName(name);if(!sheet)throw new Error('必要なシート「'+name+'」がありません。');return sheet;}
function slmReadObjects_(sheet){return slmReadTable_(sheet).rows.map(function(row){return row.record;});}
function slmReadTable_(sheet){
  if(!sheet)throw new Error('必要なシートがありません。');
  const values=sheet.getDataRange().getValues(); const headers=(values[0]||[]).map(function(v){return String(v||'').trim();}); const map={};
  headers.forEach(function(name,index){if(name)map[name]=index;}); const rows=[];
  for(let i=1;i<values.length;i++){if(!values[i].some(function(v){return v!==''&&v!==null;}))continue;const record={};headers.forEach(function(name,index){if(name)record[name]=values[i][index];});rows.push({rowNumber:i+1,record:record,values:values[i]});}
  return {sheet:sheet,headers:headers,map:map,rows:rows};
}
function slmAppendRecord_(sheet,record){
  const table=slmReadTable_(sheet); const rowNumber=sheet.getLastRow()+1; if(rowNumber>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rowNumber-sheet.getMaxRows());
  const values=table.headers.map(function(header){return Object.prototype.hasOwnProperty.call(record,header)?record[header]:'';});
  if(rowNumber>2){const source=sheet.getRange(rowNumber-1,1,1,table.headers.length),target=sheet.getRange(rowNumber,1,1,table.headers.length);source.copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);source.copyTo(target,SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,false);}
  sheet.getRange(rowNumber,1,1,table.headers.length).setValues([values]); return rowNumber;
}
function slmSetRecord_(sheet,rowNumber,map,record){Object.keys(record).forEach(function(key){if(map[key]==null)throw new Error(sheet.getName()+' に必要な列「'+key+'」がありません。');sheet.getRange(rowNumber,map[key]+1).setValue(record[key]);});}
function slmSongModel_(row){
  const raw=row.ReleaseDate; let releaseDate=''; let timeValue=0;
  if(raw instanceof Date&&!isNaN(raw.getTime())){releaseDate=Utilities.formatDate(raw,'Asia/Tokyo','yyyy-MM-dd');timeValue=raw.getTime();}
  else if(String(raw||'').trim()){const d=new Date(raw);if(!isNaN(d.getTime())){releaseDate=Utilities.formatDate(d,'Asia/Tokyo','yyyy-MM-dd');timeValue=d.getTime();}else releaseDate=String(raw).trim();}
  return {songId:slmId_(row.SongID),title:String(row.Title||'').trim(),artist:String(row.Artist||'').trim(),releaseDate:releaseDate,form:String(row.Form||'').trim(),cdTitle:String(row.CDTitle||'').trim(),isTitleTrack:row.IsTitleTrack===true||String(row.IsTitleTrack||'').toUpperCase()==='TRUE',timeValue:timeValue};
}
function slmSongSort_(a,b){return (b.timeValue||0)-(a.timeValue||0)||(Number(b.songId)||0)-(Number(a.songId)||0)||a.title.localeCompare(b.title,'ja');}
function slmNormalizeSongInput_(input){
  const title=String(input.title||'').trim(),artist=String(input.artist||'').trim(),releaseDate=String(input.releaseDate||'').trim(),form=String(input.form||'').trim(),cdTitle=String(input.cdTitle||'').trim();
  if(!title)throw new Error('TITLEを入力してください。'); if(!artist)throw new Error('ARTISTを選択してください。'); if(form&&SLM_FORMS_.indexOf(form)<0)throw new Error('FORMを確認してください。');
  if((form==='デジタルリリース'||form==='その他')&&cdTitle)throw new Error('デジタルリリース／その他ではCD TITLEを空欄にしてください。');
  let releaseDateValue=''; if(releaseDate){const m=releaseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)throw new Error('RELEASE DATEを確認してください。');const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));if(d.getFullYear()!==Number(m[1])||d.getMonth()!==Number(m[2])-1||d.getDate()!==Number(m[3]))throw new Error('RELEASE DATEを確認してください。');releaseDateValue=d;}
  return {title:title,artist:artist,releaseDate:releaseDate,releaseDateValue:releaseDateValue,form:form,cdTitle:cdTitle,isTitleTrack:input.isTitleTrack===true||String(input.isTitleTrack||'').toUpperCase()==='TRUE'};
}
function slmNormalizeCreditsInput_(input){return {lyricists:String(input.lyricists||'').trim(),composers:String(input.composers||'').trim(),choreographers:String(input.choreographers||'').trim(),originalSongId:slmId_(input.originalSongId)};}
function slmAssertArtistCandidate_(ss,artist){
  if(artist==='UNIT')return;
  const groups=slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.GROUPS)).some(function(row){return String(row.GroupName||'').trim()===artist;});
  const members=slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.MEMBERS)).some(function(row){return String(row.DisplayName||'').trim()===artist;});
  if(!groups&&!members)throw new Error('ARTISTが登録済み候補にありません。');
}
function slmAssertOriginalSong_(songs,originalSongId,currentSongId){if(!originalSongId)return;if(originalSongId===currentSongId)throw new Error('原曲に同じ曲は指定できません。');if(!songs.some(function(song){return song.songId===originalSongId;}))throw new Error('原曲が見つかりません。');}
function slmSingerOptions_(members,guests){
  const out=[]; members.forEach(function(row){const id=slmId_(row.MemberID),name=String(row.DisplayName||'').trim();if(id&&name)out.push({id:id,name:name,type:'MEMBER'});});
  guests.forEach(function(row){const id=slmId_(row.GuestID),name=String(row.DisplayName||'').trim();if(id&&name)out.push({id:id,name:name,type:'GUEST'});});
  out.push({id:'99',name:'ALL',type:'SPECIAL'},{id:'109',name:'その他',type:'SPECIAL'}); return out;
}
function slmSingerMaster_(ss){
  const options=slmSingerOptions_(slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.MEMBERS)),slmReadObjects_(slmRequireSheet_(ss,UNIVERSE_CONFIG.SHEETS.GUESTS)));
  const byName={},byId={}; options.forEach(function(item){if(!byName[item.name])byName[item.name]=[];byName[item.name].push(item);byId[item.id]=item;}); return {byName:byName,byId:byId,options:options};
}
function slmSingerMap_(ss){return slmSingerMaster_(ss).byId;}
function slmNormalizeSingerLabel_(raw){
  let text=String(raw||'').replace(/\r\n?/g,'\n').trim();if(!text)return{text:'',wrapped:false,wrapper:''};
  const wrappers=[['[',']'],['【','】'],['(',')'],['（','）'],['「','」'],['『','』'],['｢','｣'],['〈','〉'],['《','》'],['＜','＞'],['<','>'],['“','”'],['"','"']];let wrapped=false,wrapper='',changed=true;
  while(changed&&text){changed=false;for(let i=0;i<wrappers.length;i++){const pair=wrappers[i];if(text.startsWith(pair[0])&&text.endsWith(pair[1])&&text.length>pair[0].length+pair[1].length){wrapper=pair[0]+pair[1];text=text.slice(pair[0].length,text.length-pair[1].length).trim();wrapped=true;changed=true;break;}}}
  text=text.replace(/[：:]\s*$/,'').trim();return{text:text,wrapped:wrapped,wrapper:wrapper};
}
function slmSplitSingerTokens_(text){return String(text||'').trim().split(/\s*(?:、|,|，|､|＆|&|＋|\+|／|\/|・|×)\s*/).map(function(v){return v.trim();}).filter(Boolean);}
function slmResolveSingerLine_(line,masters){const label=slmNormalizeSingerLabel_(line),text=label.text;if(!text)return null;const direct=masters.byName[text]||[];if(direct.length===1)return{items:[direct[0]]};if(direct.length>1)return null;const tokens=slmSplitSingerTokens_(text);if(tokens.length<2)return null;const items=[];for(let i=0;i<tokens.length;i++){const matches=masters.byName[tokens[i]]||[];if(matches.length!==1)return null;items.push(matches[0]);}return{items:items};}
function slmParseParts_(raw,masters,errors){
  const lines=String(raw||'').replace(/\r\n?/g,'\n').split('\n'),parts=[];let current=null;
  lines.forEach(function(line,index){const singer=slmResolveSingerLine_(line,masters);if(singer){if(current)slmFinalizePart_(current,parts);current={items:singer.items,lines:[],line:index+1};return;}if(!current){if(String(line||'').trim())errors.push('歌唱者を確定する前に未分類行があります: '+String(line).trim());return;}current.lines.push(line);});
  if(current)slmFinalizePart_(current,parts); parts.forEach(function(part,index){if(!part.singer)errors.push('Part '+(index+1)+' のSingerを確定できません。');if(!part.lyrics)errors.push('Part '+(index+1)+' のLyricsが空です。');});return parts;
}
function slmFinalizePart_(current,parts){let lines=current.lines.slice();while(lines.length&&!String(lines[0]).trim())lines.shift();while(lines.length&&!String(lines[lines.length-1]).trim())lines.pop();parts.push({partOrder:parts.length+1,singer:current.items.map(function(item){return item.id;}).join(','),singers:current.items.map(function(item){return{id:item.id,name:item.name,role:'MAIN'};}),lyrics:lines.join('\n')});}
function slmLooksLikeName_(name){const text=String(name||'').trim();if(!text||text.length>48)return false;if(/[!?！？。]/.test(text))return false;if(/\b(?:the|and|but|cause|because|when|what|your|you|me|my|we|our|is|are|to|of|in|on|for|with)\b/i.test(text)&&/\s/.test(text))return false;if(!/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž一-龠ぁ-んァ-ヶ々ー・.'’\- ]+$/.test(text))return false;const words=text.split(/\s+/).filter(Boolean);if(words.length>5)return false;if(/^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ž.'’\- ]+$/.test(text)&&words.length>=2&&!words.every(function(w){return/^[A-Z0-9À-ÖØ-Þ]/.test(w)||/^[A-Z0-9.'’\-]+$/.test(w);}))return false;return true;}
function slmFindUnknownGuests_(raw,masters){
  const lines=String(raw||'').replace(/\r\n?/g,'\n').split('\n'),seen={},out=[];
  lines.forEach(function(line,index){const label=slmNormalizeSingerLabel_(line);if(!label.text||slmResolveSingerLine_(line,masters))return;const tokens=slmSplitSingerTokens_(label.text);if(!tokens.length)return;const knownCount=tokens.filter(function(token){return(masters.byName[token]||[]).length===1;}).length;const unknown=tokens.filter(function(token){return(masters.byName[token]||[]).length===0&&slmLooksLikeName_(token);});if(!unknown.length)return;const prevBlank=index===0||!String(lines[index-1]||'').trim(),nextHasText=index+1<lines.length&&!!String(lines[index+1]||'').trim();const strong=knownCount>0||(label.wrapped&&label.wrapper!=='()'&&label.wrapper!=='（）')||(prevBlank&&nextHasText&&slmLooksLikeName_(label.text));if(!strong)return;unknown.forEach(function(name){if(!seen[name]){seen[name]=true;out.push(name);}});}); return out;
}
function slmDecodeSinger_(raw,singerMap){return String(raw||'').split(',').map(function(token){token=token.trim();if(!token)return null;const m=token.match(/_(up|down|sub)$/i),role=m?m[1].toUpperCase():'MAIN',id=m?token.slice(0,-m[0].length):token;const item=singerMap[id]||{id:id,name:id};return{id:id,name:item.name,role:role};}).filter(Boolean);}
function slmEncodeSingerAssignments_(items,singerMap){if(!Array.isArray(items)||!items.length)return'';return items.map(function(item){const id=slmId_(item&&item.id),role=String(item&&item.role||'MAIN').trim().toUpperCase();if(!singerMap[id])throw new Error('未登録のSinger IDです: '+id);if(SLM_ROLES_.indexOf(role)<0)throw new Error('Singer roleが不正です: '+role);return id+(role==='MAIN'?'':'_'+role.toLowerCase());}).join(',');}
function slmClearCaches_(){try{CacheService.getScriptCache().remove('analysis_bootstrap_v1');}catch(error){}}
