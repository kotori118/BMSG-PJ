const KARAOKE_USERS_ = Object.freeze(['U001','U002','U003']);
const KARAOKE_TZ_ = 'Asia/Tokyo';
const KARAOKE_ROOM_MS_ = 24 * 60 * 60 * 1000;

function getKaraokeBootstrap(userId, requestedRoomId) {
  cleanupExpiredKaraoke_();
  const uid = validateKaraokeUser_(userId);
  const roomId = String(requestedRoomId || getKaraokeRoomProperty_(uid) || '').trim();
  const room = roomId ? findActiveKaraokeRoom_(roomId) : null;
  if (!room && roomId) clearKaraokeRoomProperty_(uid);
  return {
    users: getKaraokeUsers_(),
    room: room,
    history: room ? getKaraokeHistory_(room.roomId) : []
  };
}

function createKaraokeRoom(userId) {
  const uid = validateKaraokeUser_(userId);
  return withKaraokeLock_(function() {
    cleanupExpiredKaraokeUnsafe_();
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_ROOMS);
    const activeIds = readSheetObjects_(sheet).reduce(function(map,row){map[String(row.RoomID).padStart(4,'0')]=true;return map;},{});
    let roomId = '';
    for (let i=0;i<100;i++) {
      const candidate = String(Math.floor(1000 + Math.random()*9000));
      if (!activeIds[candidate]) { roomId=candidate; break; }
    }
    if (!roomId) throw new Error('ルームIDを発行できませんでした。');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime()+KARAOKE_ROOM_MS_);
    appendByHeaders_(sheet,{RoomID:roomId,CreatedAt:createdAt,CreatedByUserID:uid,ExpiresAt:expiresAt});
    setKaraokeRoomProperty_(uid,roomId);
    return {roomId:roomId,createdAt:createdAt.toISOString(),expiresAt:expiresAt.toISOString(),createdByUserId:uid};
  });
}

function joinKaraokeRoom(userId, roomId) {
  const uid=validateKaraokeUser_(userId);
  const id=String(roomId||'').replace(/\D/g,'').padStart(4,'0');
  if (!/^\d{4}$/.test(id)) throw new Error('4桁のルームIDを入力してください。');
  return withKaraokeLock_(function() {
    cleanupExpiredKaraokeUnsafe_();
    const room=findActiveKaraokeRoom_(id);
    if (!room) throw new Error('有効なルームが見つかりません。');
    setKaraokeRoomProperty_(uid,id);
    return {room:room,history:getKaraokeHistory_(id)};
  });
}

function leaveKaraokeRoom(userId) {
  clearKaraokeRoomProperty_(validateKaraokeUser_(userId));
  return {ok:true};
}

function shuffleKaraokeSong(payload) {
  payload=payload||{};
  const uid=validateKaraokeUser_(payload.userId);
  const roomId=String(payload.roomId||'').trim();
  const songId=asId_(payload.songId);
  return withKaraokeLock_(function() {
    cleanupExpiredKaraokeUnsafe_();
    if (!findActiveKaraokeRoom_(roomId)) throw new Error('ルームの有効期限が切れています。');
    const song=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).find(function(row){return asId_(row.SongID)===songId;});
    if (!song) throw new Error('曲が見つかりません。');
    const parts=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS).filter(function(row){return asId_(row.SongID)===songId;});
    const slots=collectKaraokeSingerSlots_(parts);
    if (!slots.length) throw new Error('分配できる歌唱者がありません。');

    const users=getKaraokeUsers_();
    const cumulative=getKaraokeCumulativeCounts_(roomId,users);
    const ordered=orderKaraokeUsersByFairness_(users,cumulative);
    const shuffled=shuffleArray_(slots.slice());
    const base=Math.floor(shuffled.length/users.length);
    const extra=shuffled.length%users.length;
    const assignments={};
    let cursor=0;
    ordered.forEach(function(user,index){
      const size=base+(index<extra?1:0);
      assignments[user.userId]=shuffled.slice(cursor,cursor+size);
      cursor+=size;
    });
    const singerMap=buildLyricsSingerMap_();
    Object.keys(assignments).forEach(function(userId){
      assignments[userId]=assignments[userId].map(function(id){
        const singer=singerMap[id]||{name:id,color:'#777777'};
        return {memberId:id,name:singer.name,color:singer.color};
      });
    });
    return {
      songId:songId,
      title:String(song.Title||''),
      artist:String(song.Artist||''),
      assignments:assignments,
      users:users,
      cumulative:cumulative
    };
  });
}

function saveKaraokeAssignment(payload) {
  payload=payload||{};
  const uid=validateKaraokeUser_(payload.userId);
  const roomId=String(payload.roomId||getKaraokeRoomProperty_(uid)||'').trim();
  const songId=asId_(payload.songId);
  return withKaraokeLock_(function() {
    cleanupExpiredKaraokeUnsafe_();
    if (!findActiveKaraokeRoom_(roomId)) throw new Error('ルームの有効期限が切れています。');
    const song=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).find(function(row){return asId_(row.SongID)===songId;});
    if (!song) throw new Error('曲が見つかりません。');

    const parts=readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS).filter(function(row){return asId_(row.SongID)===songId;});
    const allowed={};
    parts.forEach(function(part){
      String(part.Singer||'').split(',').forEach(function(token){
        const key=token.trim().replace(/_(up|down|sub)$/i,'');
        if(key&&key!=='99')allowed[key]=true;
      });
    });

    const submitted=payload.assignments&&typeof payload.assignments==='object'?payload.assignments:{};
    const assignments={};
    const assigned={};
    getKaraokeUsers_().forEach(function(user){
      const slots=Array.isArray(submitted[user.userId])?submitted[user.userId]:[];
      assignments[user.userId]=slots.map(function(slot){
        const memberId=String(slot&&slot.memberId||'').trim();
        if(!allowed[memberId]||assigned[memberId])throw new Error('振り分け内容が正しくありません。');
        assigned[memberId]=true;
        const name=String(slot&&slot.name||memberId).slice(0,80);
        const color=/^#[0-9a-f]{6}$/i.test(String(slot&&slot.color||''))?String(slot.color):'#777777';
        return {memberId:memberId,name:name,color:color};
      });
    });
    const allowedIds=Object.keys(allowed);
    if(!allowedIds.length||allowedIds.some(function(id){return !assigned[id];})||Object.keys(assigned).length!==allowedIds.length){
      throw new Error('未設定の歌唱者があります。');
    }

    const result={
      songId:songId,title:String(song.Title||''),artist:String(song.Artist||''),
      assignments:assignments,users:getKaraokeUsers_(),createdAt:new Date().toISOString()
    };
    const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_RESULTS);
    appendByHeaders_(sheet,{
      ShuffleID:Utilities.getUuid(),RoomID:roomId,SongID:songId,CreatedAt:new Date(),
      CreatedByUserID:uid,ResultJSON:JSON.stringify(result)
    });
    return result;
  });
}

function getKaraokeHistory(roomId) { return getKaraokeHistory_(String(roomId||'').trim()); }

function getKaraokeUsers_() {
  const names = { U001: 'ももたん', U002: 'みおたん', U003: 'りおたん' };
  return KARAOKE_USERS_.map(function(id) {
    return { userId: id, displayName: names[id] || id };
  });
}

function collectKaraokeSingerSlots_(parts) {
  const seen={}; const out=[];
  parts.forEach(function(part){
    String(part.Singer||'').split(',').forEach(function(token){
      const base=token.trim().replace(/_(up|down|sub)$/i,'');
      const ids=base.split('_');
      ids.forEach(function(id){id=id.trim();if(id&&id!=='99'&&!seen[id]){seen[id]=true;out.push(id);}});
    });
  });
  return out;
}

function getKaraokeCumulativeCounts_(roomId,users) {
  const counts={};users.forEach(function(user){counts[user.userId]=0;});
  getKaraokeHistory_(roomId).forEach(function(result){
    Object.keys(result.assignments||{}).forEach(function(uid){counts[uid]=(counts[uid]||0)+(result.assignments[uid]||[]).length;});
  });
  return counts;
}

function orderKaraokeUsersByFairness_(users,cumulative) {
  const groups={};
  users.forEach(function(user){
    const count=Number(cumulative[user.userId]||0);
    if(!groups[count])groups[count]=[];
    groups[count].push(user);
  });
  return Object.keys(groups).map(Number).sort(function(a,b){return a-b;}).reduce(function(out,count){
    return out.concat(shuffleArray_(groups[count].slice()));
  },[]);
}

function getKaraokeHistory_(roomId) {
  const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_RESULTS);
  return readSheetObjects_(sheet).filter(function(row){return String(row.RoomID).padStart(4,'0')===roomId;})
    .map(function(row){try{return JSON.parse(String(row.ResultJSON||'{}'));}catch(error){return null;}})
    .filter(Boolean).sort(function(a,b){return String(b.createdAt).localeCompare(String(a.createdAt));}).slice(0,50);
}

function findActiveKaraokeRoom_(roomId) {
  const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_ROOMS);
  const row=readSheetObjects_(sheet).find(function(item){return String(item.RoomID).padStart(4,'0')===roomId;});
  if (!row) return null;
  const expires=new Date(row.ExpiresAt);
  if (!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now()) return null;
  return {roomId:roomId,createdAt:new Date(row.CreatedAt).toISOString(),expiresAt:expires.toISOString(),createdByUserId:asId_(row.CreatedByUserID)};
}

function cleanupExpiredKaraoke_() {
  return withKaraokeLock_(cleanupExpiredKaraokeUnsafe_);
}

function cleanupExpiredKaraokeUnsafe_() {
  const rooms=getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_ROOMS);
  const values=rooms.getDataRange().getValues(); if(values.length<2)return;
  const headers=values[0].map(String); const idCol=headers.indexOf('RoomID'),expCol=headers.indexOf('ExpiresAt');
  const expired={};
  for(let i=1;i<values.length;i++){const exp=new Date(values[i][expCol]);if(!Number.isFinite(exp.getTime())||exp.getTime()<=Date.now())expired[String(values[i][idCol]).padStart(4,'0')]=true;}
  const results=getLogSheet_(UNIVERSE_CONFIG.SHEETS.KARAOKE_RESULTS);
  const rv=results.getDataRange().getValues(); if(rv.length>1){const rh=rv[0].map(String),roomCol=rh.indexOf('RoomID');for(let i=rv.length-1;i>=1;i--){if(expired[String(rv[i][roomCol]).padStart(4,'0')])results.deleteRow(i+1);}}
  for(let i=values.length-1;i>=1;i--){if(expired[String(values[i][idCol]).padStart(4,'0')])rooms.deleteRow(i+1);}
}

function withKaraokeLock_(callback) {
  const lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try{return callback();}
  finally{lock.releaseLock();}
}

function validateKaraokeUser_(userId){const id=asId_(userId);if(KARAOKE_USERS_.indexOf(id)<0)throw new Error('利用ユーザーを選択してください。');return id;}
function getLogSheet_(name){const sheet=SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(name);if(!sheet)throw new Error('Log sheet not found: '+name);return sheet;}
function readSheetObjects_(sheet){const values=sheet.getDataRange().getValues();if(values.length<2)return[];const headers=values[0].map(function(v){return String(v).trim();});return values.slice(1).filter(function(row){return row.some(function(v){return v!=='';});}).map(function(row){const obj={};headers.forEach(function(h,i){if(h)obj[h]=row[i];});return obj;});}
function appendByHeaders_(sheet,record){const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);sheet.appendRow(headers.map(function(h){return Object.prototype.hasOwnProperty.call(record,h)?record[h]:'';}));}
function karaokePropertyKey_(uid){return 'KARAOKE_ACTIVE_ROOM_'+uid;}
function setKaraokeRoomProperty_(uid,roomId){PropertiesService.getScriptProperties().setProperty(karaokePropertyKey_(uid),roomId);}
function getKaraokeRoomProperty_(uid){return PropertiesService.getScriptProperties().getProperty(karaokePropertyKey_(uid));}
function clearKaraokeRoomProperty_(uid){PropertiesService.getScriptProperties().deleteProperty(karaokePropertyKey_(uid));}
function shuffleArray_(items){for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=items[i];items[i]=items[j];items[j]=t;}return items;}