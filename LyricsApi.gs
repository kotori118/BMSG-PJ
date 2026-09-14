const LYRICS_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const LYRICS_CATEGORIES_ = Object.freeze(['ALL', 'BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA', 'UNIT']);
const LYRICS_SINGER_ROLES_ = Object.freeze(['MAIN','UP','DOWN','SUB']);

function getLyricsCatalog() {
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
  const parts = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
  const singerMap = buildLyricsSingerMap_();
  const groupColors = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS).reduce(function(map,row){
    const name=String(row.GroupName||'').trim();
    const color=String(row.ColorHex||'').trim();
    if(name&&/^#[0-9a-f]{6}$/i.test(color))map[name]=color;
    return map;
  },{});
  const partsBySong = parts.reduce(function(map, row) {
    const id = asId_(row.SongID);
    if (!id) return map;
    if (!map[id]) map[id] = [];
    map[id].push({songId:id,partOrder:Number(row.PartOrder),singer:String(row.Singer||''),singers:formatLyricsSingers_(String(row.Singer||''),singerMap),lyrics:String(row.Lyrics||'')});
    return map;
  }, {});
  Object.keys(partsBySong).forEach(function(id){partsBySong[id].sort(function(a,b){return a.partOrder-b.partOrder;});});
  const counts = parts.reduce(function(map,row){const id=asId_(row.SongID);if(id)map[id]=(map[id]||0)+1;return map;},{});
  return {
    categories:LYRICS_CATEGORIES_.slice(),groupColors:groupColors,partsBySong:partsBySong,
    songs:songs.filter(function(row){return counts[asId_(row.SongID)]>0;}).map(function(row){
      const artist=String(row.Artist||'').trim();
      return {songId:asId_(row.SongID),title:String(row.Title||'').trim(),artist:artist,releaseDate:row.ReleaseDate instanceof Date?row.ReleaseDate.toISOString():String(row.ReleaseDate||''),category:lyricsCategory_(artist),unitCategory:lyricsUnitCategory_(String(row.Title||'').trim(),artist),partCount:counts[asId_(row.SongID)]||0};
    })
  };
}

function getLyricsSong(songId) {
  const id=asId_(songId);if(!id)throw new Error('SongID is required.');
  const song=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).find(function(row){return asId_(row.SongID)===id;});
  if(!song)throw new Error('Song not found: '+id);
  const singerMap=buildLyricsSingerMap_();
  const parts=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS).filter(function(row){return asId_(row.SongID)===id;}).sort(function(a,b){return Number(a.PartOrder)-Number(b.PartOrder);}).map(function(row){return{songId:id,partOrder:Number(row.PartOrder),singer:String(row.Singer||''),singers:formatLyricsSingers_(String(row.Singer||''),singerMap),lyrics:String(row.Lyrics||'')};});
  return {songId:id,title:String(song.Title||''),artist:String(song.Artist||''),parts:parts};
}

function getLyricsSingerOptions() {
  const options=[];
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){const id=asId_(row.MemberID),name=String(row.DisplayName||'').trim();if(id&&name)options.push({id:id,name:name,type:'MEMBER'});});
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GUESTS).forEach(function(row){const id=asId_(row.GuestID),name=String(row.DisplayName||'').trim();if(id&&name)options.push({id:id,name:name,type:'GUEST'});});
  options.push({id:'99',name:'ALL',type:'SPECIAL'},{id:'109',name:'その他',type:'SPECIAL'});
  return options;
}

function updateLyricsPart(payload) {
  payload=payload||{};
  const userId=asId_(payload.userId);
  if(LYRICS_USERS_.indexOf(userId)<0)throw new Error('利用ユーザーを選択してください。');
  const result=BMSGDB.updateSongPartForUniverse(payload);
  try{CacheService.getScriptCache().remove('analysis_bootstrap_v1');}catch(error){}
  return result;
}

function encodeLyricsSingerAssignments_(items,singerMap){
  if(!Array.isArray(items)||!items.length)return '';
  return items.map(function(item){const id=asId_(item&&item.id);const role=String(item&&item.role||'MAIN').trim().toUpperCase();if(!id||!singerMap[id])throw new Error('未登録の歌唱者です: '+id);if(LYRICS_SINGER_ROLES_.indexOf(role)<0)throw new Error('歌唱役割が不正です: '+role);return id+(role==='MAIN'?'':'_'+role.toLowerCase());}).join(',');
}
function lyricsCategory_(artist){if(['BE:FIRST','MAZZEL','STARGLOW','HANA'].indexOf(artist)>=0)return artist;return'UNIT';}
function lyricsUnitCategory_(title,artist){if(artist==='BMSG ALLSTARS'||['New Chapter','Grand Champ',"Grand Champ -from BMSG FES'2025-"].indexOf(title)>=0)return'BMSG ALLSTARS';const units=['ShowMinorSavage','BMSG POSSE','BMSG EAST','BMSG WEST','BMSG SKY','BMSG GAIA','BMSG MARINE','BMSG STRIKERS'];return units.indexOf(artist)>=0?artist:'その他UNIT';}
function buildLyricsSingerMap_(){
  const map={'99':{name:'ALL',color:'#777777'},'109':{name:'その他',color:'#777777'}};
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS).forEach(function(row){const id=asId_(row.MemberID);if(id)map[id]={name:String(row.DisplayName||id),color:String(row.ColorHex||'#777777')};});
  readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GUESTS).forEach(function(row){const id=asId_(row.GuestID);if(id)map[id]={name:String(row.DisplayName||id),color:'#777777'};});
  return map;
}
function formatLyricsSingers_(raw,singerMap){
  return String(raw||'').split(',').map(function(token){token=token.trim();const harmonyMatch=token.match(/_(up|down|sub)$/i);const harmony=harmonyMatch?harmonyMatch[1].toLowerCase():'';const base=harmonyMatch?token.slice(0,-harmonyMatch[0].length):token;const ids=singerMap[base]?[base]:base.split('_');const people=ids.map(function(id){return singerMap[id]||{name:id,color:'#777777'};});return{raw:token,id:base,role:harmony?harmony.toUpperCase():'MAIN',name:people.map(function(person){return person.name;}).join(' & '),color:people[0].color,harmony:harmony};}).filter(function(item){return item.name;});
}
