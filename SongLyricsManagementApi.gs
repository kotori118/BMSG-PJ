/** SETTINGS > 管理 > 楽曲・歌詞管理
 * Reads stay in BMSG-PJ. All Song / Lyrics / Guest writes are delegated to the
 * version-pinned BMSG-DB library so both Universe and the old spreadsheet route
 * use the same writer, lock, validation and IDRegistry allocation.
 */
const SLM_USERS_ = Object.freeze(['U001','U002','U003']);
const SLM_FORMS_ = Object.freeze(['シングル','アルバム','デジタルリリース','その他']);

function getSongLyricsManagementBootstrap(userId) {
  slmRequireUser_(userId);
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).map(slmSongModel_).filter(function(song){return song.songId&&song.title&&song.artist;});
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const guests = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GUESTS);
  const artistMap = {};
  groups.forEach(function(row){const name=String(row.GroupName||'').trim();if(name)artistMap[name]=true;});
  members.forEach(function(row){const name=String(row.DisplayName||'').trim();if(name)artistMap[name]=true;});
  artistMap.UNIT = true;
  const priority={'BE:FIRST':1,'MAZZEL':2,'STARGLOW':3,'HANA':4,'UNIT':9998};
  function artistSort(a,b){return (priority[a]||1000)-(priority[b]||1000)||a.localeCompare(b,'ja');}
  songs.sort(slmSongSort_);
  return {
    artists:Object.keys(artistMap).sort(artistSort),
    existingArtists:Array.from(new Set(songs.map(function(song){return song.artist;}))).sort(artistSort),
    songs:songs,
    singerOptions:slmSingerOptions_(members,guests),
    forms:SLM_FORMS_.slice(),
    roles:[{value:'MAIN',label:'MAIN'},{value:'UP',label:'UP'},{value:'DOWN',label:'DOWN'},{value:'SUB',label:'SUB'}]
  };
}

function parseSongLyricsManagement(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  const result = BMSGDB.parseSongLyricsForUniverse(payload);
  const ignored = slmIgnoredGuestCandidateMap_(payload.ignoredGuestCandidates);
  result.unknownGuests = (result.unknownGuests || []).filter(function(name){return !ignored[slmGuestCandidateKey_(name)];});
  result.canRegister = result.unknownGuests.length === 0 && !(result.errors || []).length;
  return result;
}

function registerSongLyricsGuest(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  try { return BMSGDB.registerSongLyricsGuestForUniverse(payload); }
  finally { clearUniverseAnalysisMutationCaches_(); }
}

function saveNewSongLyricsManagement(payload) {
  payload = payload || {};
  slmRequireUser_(payload.userId);
  try {
    if (Array.isArray(payload.ignoredGuestCandidates) && payload.ignoredGuestCandidates.length) {
      return BMSGDB.saveNewSongLyricsWithIgnoredGuestsForUniverse(payload);
    }
    return BMSGDB.saveNewSongLyricsForUniverse(payload);
  }
  finally { clearUniverseSongMutationCaches_(); }
}

function getSongLyricsManagementSong(userId, songId) {
  slmRequireUser_(userId);
  const id=slmId_(songId);
  if(!id)throw new Error('曲を選択してください。');
  const songRow=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).find(function(row){return slmId_(row.SongID)===id;});
  if(!songRow)throw new Error('曲が見つかりません。');
  const credits=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONG_CREDITS).find(function(row){return slmId_(row.SongID)===id;})||{};
  const singerMap=buildLyricsSingerMap_();
  const parts=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS)
    .filter(function(row){return slmId_(row.SongID)===id;})
    .sort(function(a,b){return Number(a.PartOrder)-Number(b.PartOrder);})
    .map(function(row,index){
      const raw=String(row.Singer||'');
      return {partOrder:index+1,singer:raw,singers:slmAssignmentsFromRaw_(raw,singerMap),lyrics:String(row.Lyrics||'')};
    });
  return {
    song:slmSongModel_(songRow),
    credits:{lyricists:String(credits.Lyricists||''),composers:String(credits.Composers||''),choreographers:String(credits.Choreographers||'')},
    parts:parts
  };
}

function saveSongLyricsManagementInfo(payload) {
  payload=payload||{};slmRequireUser_(payload.userId);
  try{return BMSGDB.saveSongInfoForUniverse(payload);}finally{clearUniverseSongMutationCaches_();}
}
function saveSongLyricsManagementCredits(payload) {
  payload=payload||{};slmRequireUser_(payload.userId);
  try{return BMSGDB.saveSongCreditsForUniverse(payload);}finally{clearUniverseSongMutationCaches_();}
}
function saveSongLyricsManagementLyrics(payload) {
  payload=payload||{};slmRequireUser_(payload.userId);
  try{return BMSGDB.saveSongPartsForUniverse(payload);}finally{clearUniverseSongMutationCaches_();}
}

function slmRequireUser_(userId){if(SLM_USERS_.indexOf(String(userId||'').trim())<0)throw new Error('利用ユーザーを選択してください。');}
function slmId_(value){return value==null?'':String(value).trim().replace(/\.0+$/,'');}
function slmGuestCandidateKey_(value){const text=String(value==null?'':value).trim();return typeof text.normalize==='function'?text.normalize('NFKC'):text;}
function slmIgnoredGuestCandidateMap_(values){const out=Object.create(null);(Array.isArray(values)?values:[]).forEach(function(value){const key=slmGuestCandidateKey_(value);if(key)out[key]=true;});return out;}
function slmSingerOptions_(members,guests){
  const out=[];
  members.forEach(function(row){const id=slmId_(row.MemberID),name=String(row.DisplayName||'').trim();if(id&&name)out.push({id:id,name:name,type:'MEMBER'});});
  guests.forEach(function(row){const id=slmId_(row.GuestID),name=String(row.DisplayName||'').trim();if(id&&name)out.push({id:id,name:name,type:'GUEST'});});
  out.push({id:'99',name:'ALL',type:'SPECIAL'},{id:'109',name:'その他',type:'SPECIAL'});return out;
}
function slmSongModel_(row){
  const raw=row.ReleaseDate;let releaseDate='',timeValue=0;
  if(raw instanceof Date&&!isNaN(raw.getTime())){releaseDate=Utilities.formatDate(raw,'Asia/Tokyo','yyyy-MM-dd');timeValue=raw.getTime();}
  else if(String(raw||'').trim()){const d=new Date(raw);if(!isNaN(d.getTime())){releaseDate=Utilities.formatDate(d,'Asia/Tokyo','yyyy-MM-dd');timeValue=d.getTime();}else releaseDate=String(raw).trim();}
  return {songId:slmId_(row.SongID),title:String(row.Title||'').trim(),artist:String(row.Artist||'').trim(),releaseDate:releaseDate,form:String(row.Form||'').trim(),cdTitle:String(row.CDTitle||'').trim(),isTitleTrack:row.IsTitleTrack===true||String(row.IsTitleTrack||'').toUpperCase()==='TRUE',timeValue:timeValue};
}
function slmSongSort_(a,b){return (b.timeValue||0)-(a.timeValue||0)||(Number(b.songId)||0)-(Number(a.songId)||0)||a.title.localeCompare(b.title,'ja');}
function slmAssignmentsFromRaw_(raw,singerMap){
  return String(raw||'').split(',').map(function(token){
    token=token.trim();if(!token)return null;
    const m=token.match(/_(up|down|sub)$/i);const role=m?m[1].toUpperCase():'MAIN';const id=m?token.slice(0,-m[0].length):token;const item=singerMap[id]||{name:id};
    return {id:id,name:item.name||id,role:role};
  }).filter(Boolean);
}
