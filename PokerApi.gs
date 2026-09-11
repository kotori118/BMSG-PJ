const POKER_USERS_ = Object.freeze(['U001','U002','U003']);
const POKER_RULES_ = Object.freeze(['A','B']);
const POKER_ROOM_MS_ = 24 * 60 * 60 * 1000;
const POKER_MAX_PLAYERS_ = 3;

function getPokerBootstrap(userId, requestedRoomId) {
  const uid = validatePokerUser_(userId);
  cleanupExpiredPoker_();
  const catalog = getCardCatalogModel_();
  const roomId = String(requestedRoomId || getPokerRoomProperty_(uid) || '').trim();
  const room = roomId ? findPokerRoomByRoomId_(roomId) : null;
  if (!room && roomId) clearPokerRoomProperty_(uid);
  return {
    users: getPokerUsers_(),
    cards: catalog.cards,
    brandLogoDriveFileId: catalog.brandLogoDriveFileId,
    room: room ? buildPokerRoomState_(room, uid) : null
  };
}

function getPokerRoomState(userId, roomId) {
  const uid = validatePokerUser_(userId);
  cleanupExpiredPoker_();
  const room = findPokerRoomByRoomId_(String(roomId || '').trim());
  if (!room) throw new Error('有効なPOKER ROOMが見つかりません。');
  return buildPokerRoomState_(room, uid);
}

function createPokerRoom(userId, ruleType) {
  const uid = validatePokerUser_(userId);
  const rule = validatePokerRule_(ruleType);
  return withPokerLock_(function() {
    cleanupExpiredPokerUnsafe_();
    const rooms = getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_ROOMS);
    const activeIds = readSheetObjects_(rooms).reduce(function(map, row) {
      map[String(row.RoomID || '').padStart(4, '0')] = true;
      return map;
    }, {});
    let roomId = '';
    for (let i = 0; i < 100; i++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      if (!activeIds[candidate]) { roomId = candidate; break; }
    }
    if (!roomId) throw new Error('ROOM IDを発行できませんでした。');
    const gameId = Utilities.getUuid();
    const createdAt = new Date();
    appendByHeaders_(rooms, {
      PokerGameID: gameId, RoomID: roomId, RuleType: rule,
      CreatorUserID: uid, Status: 'WAITING', CreatedAt: createdAt,
      ExpiresAt: new Date(createdAt.getTime() + POKER_ROOM_MS_)
    });
    appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS), {
      PokerGameID: gameId, UserID: uid, JoinOrder: 1,
      HandImageIDsJSON: '[]', DrawnImageIDsJSON: '[]', ExchangeCount: 0,
      IsFinalized: false, FinalizedAt: '', UpdatedAt: createdAt
    });
    setPokerRoomProperty_(uid, roomId);
    return buildPokerRoomState_(findPokerRoomByRoomId_(roomId), uid);
  });
}

function joinPokerRoom(userId, roomId) {
  const uid = validatePokerUser_(userId);
  const id = String(roomId || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(id)) throw new Error('4桁のROOM IDを入力してください。');
  return withPokerLock_(function() {
    cleanupExpiredPokerUnsafe_();
    const room = findPokerRoomByRoomId_(id);
    if (!room) throw new Error('有効なPOKER ROOMが見つかりません。');
    const players = getPokerPlayerRows_(room.gameId);
    const existing = players.find(function(player) { return player.userId === uid; });
    if (!existing) {
      if (room.status !== 'WAITING') throw new Error('このゲームは開始済みです。');
      if (players.length >= POKER_MAX_PLAYERS_) throw new Error('このROOMは満員です。');
      appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS), {
        PokerGameID: room.gameId, UserID: uid, JoinOrder: players.length + 1,
        HandImageIDsJSON: '[]', DrawnImageIDsJSON: '[]', ExchangeCount: 0,
        IsFinalized: false, FinalizedAt: '', UpdatedAt: new Date()
      });
    }
    setPokerRoomProperty_(uid, id);
    return buildPokerRoomState_(room, uid);
  });
}

function leavePokerRoom(userId, roomId) {
  const uid = validatePokerUser_(userId);
  return withPokerLock_(function() {
    const room = findPokerRoomByRoomId_(String(roomId || '').trim());
    if (!room) { clearPokerRoomProperty_(uid); return {ok:true}; }
    if (room.status !== 'WAITING') { clearPokerRoomProperty_(uid); return {ok:true}; }
    if (room.creatorUserId === uid) {
      deletePokerGameRows_(room.gameId, true);
    } else {
      deletePokerPlayer_(room.gameId, uid);
    }
    clearPokerRoomProperty_(uid);
    return {ok:true};
  });
}

function startPokerRoom(userId, roomId) {
  const uid = validatePokerUser_(userId);
  return withPokerLock_(function() {
    cleanupExpiredPokerUnsafe_();
    const room = findPokerRoomByRoomId_(String(roomId || '').trim());
    if (!room) throw new Error('有効なPOKER ROOMが見つかりません。');
    if (room.creatorUserId !== uid) throw new Error('STARTはCreatorのみ操作できます。');
    if (room.status !== 'WAITING') throw new Error('このゲームは開始済みです。');
    const players = getPokerPlayerRows_(room.gameId);
    if (players.length < 2 || players.length > POKER_MAX_PLAYERS_) throw new Error('2〜3人で開始してください。');
    const catalog = getCardCatalogModel_().cards;
    if (uniquePokerMemberCount_(catalog) < 5) throw new Error('5人分のカードが必要です。');
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS);
    players.forEach(function(player) {
      const hand = drawPokerCards_(catalog, [], [], 5);
      const ids = hand.map(function(card) { return card.imageId; });
      updatePokerPlayerRow_(sheet, player.rowNumber, {
        HandImageIDsJSON: JSON.stringify(ids), DrawnImageIDsJSON: JSON.stringify(ids),
        ExchangeCount: 0, IsFinalized: false, FinalizedAt: '', UpdatedAt: new Date()
      });
    });
    updatePokerRoom_(room.rowNumber, {Status:'PLAYING'});
    return buildPokerRoomState_(findPokerRoomByRoomId_(room.roomId), uid);
  });
}

function reorderPokerHand(payload) {
  payload = payload || {};
  const uid = validatePokerUser_(payload.userId);
  return withPokerLock_(function() {
    const context = requirePokerPlayContext_(uid, payload.roomId);
    if (context.player.isFinalized) throw new Error('手札は確定済みです。');
    const submitted = Array.isArray(payload.imageIds) ? payload.imageIds.map(asId_) : [];
    if (submitted.length !== 5 || submitted.slice().sort().join('|') !== context.player.handIds.slice().sort().join('|')) {
      throw new Error('手札の並び順が正しくありません。');
    }
    updatePokerPlayerRow_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS), context.player.rowNumber, {
      HandImageIDsJSON: JSON.stringify(submitted), UpdatedAt: new Date()
    });
    return buildPokerRoomState_(context.room, uid);
  });
}

function exchangePokerCards(payload) {
  payload = payload || {};
  const uid = validatePokerUser_(payload.userId);
  return withPokerLock_(function() {
    const context = requirePokerPlayContext_(uid, payload.roomId);
    if (context.player.isFinalized) throw new Error('手札は確定済みです。');
    const indices = Array.isArray(payload.indices) ? payload.indices.map(Number).filter(function(value, index, all) {
      return Number.isInteger(value) && value >= 0 && value < 5 && all.indexOf(value) === index;
    }).sort() : [];
    if (!indices.length) throw new Error('交換するカードを選択してください。');
    if (context.room.ruleType === 'B' && context.player.exchangeCount >= 1) throw new Error('RULE Bの交換は1回だけです。');
    const catalog = getCardCatalogModel_().cards;
    const handIds = context.player.handIds.slice();
    const keptIds = handIds.filter(function(id, index) { return indices.indexOf(index) < 0; });
    const replacements = drawPokerCards_(catalog, keptIds, context.player.drawnIds, indices.length);
    indices.forEach(function(handIndex, replacementIndex) { handIds[handIndex] = replacements[replacementIndex].imageId; });
    const drawn = context.player.drawnIds.concat(replacements.map(function(card) { return card.imageId; }));
    updatePokerPlayerRow_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS), context.player.rowNumber, {
      HandImageIDsJSON: JSON.stringify(handIds), DrawnImageIDsJSON: JSON.stringify(drawn),
      ExchangeCount: context.player.exchangeCount + 1, UpdatedAt: new Date()
    });
    return buildPokerRoomState_(context.room, uid);
  });
}

function finalizePokerHand(userId, roomId) {
  const uid = validatePokerUser_(userId);
  return withPokerLock_(function() {
    const context = requirePokerPlayContext_(uid, roomId);
    if (!context.player.isFinalized) {
      updatePokerPlayerRow_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS), context.player.rowNumber, {
        IsFinalized: true, FinalizedAt: new Date(), UpdatedAt: new Date()
      });
      appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES), {
        ActivityID: Utilities.getUuid(), UserID: uid, ActivityType: 'PLAY_POKER',
        TargetID: context.room.gameId, OccurredAt: new Date()
      });
    }
    const players = getPokerPlayerRows_(context.room.gameId);
    if (players.length >= 2 && players.every(function(player) { return player.isFinalized; })) {
      updatePokerRoom_(context.room.rowNumber, {Status:'VOTING'});
    }
    return buildPokerRoomState_(findPokerRoomByRoomId_(context.room.roomId), uid);
  });
}

function votePokerWinner(userId, roomId, votedUserId) {
  const uid = validatePokerUser_(userId);
  const voted = validatePokerUser_(votedUserId);
  if (uid === voted) throw new Error('自分以外へ投票してください。');
  return withPokerLock_(function() {
    const room = findPokerRoomByRoomId_(String(roomId || '').trim());
    if (!room || ['VOTING','COMPLETED'].indexOf(room.status) < 0) throw new Error('現在は投票できません。');
    const players = getPokerPlayerRows_(room.gameId);
    if (!players.some(function(player) { return player.userId === uid; }) || !players.some(function(player) { return player.userId === voted; })) {
      throw new Error('投票先が正しくありません。');
    }
    const votes = getPokerVoteRows_(room.gameId);
    if (votes.some(function(vote) { return vote.voterUserId === uid; })) throw new Error('投票済みです。');
    appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_VOTES), {
      PokerGameID: room.gameId, VoterUserID: uid, VotedUserID: voted, VotedAt: new Date()
    });
    if (votes.length + 1 >= players.length) updatePokerRoom_(room.rowNumber, {Status:'COMPLETED'});
    return buildPokerRoomState_(findPokerRoomByRoomId_(room.roomId), uid);
  });
}

function savePokerHighlight(userId, roomId) {
  const uid = validatePokerUser_(userId);
  return withPokerLock_(function() {
    const room = findPokerRoomByRoomId_(String(roomId || '').trim());
    if (!room || ['VOTING','COMPLETED'].indexOf(room.status) < 0) throw new Error('最終手札の公開後に保存できます。');
    const players = getPokerPlayerRows_(room.gameId);
    if (!players.some(function(player) { return player.userId === uid; })) throw new Error('このゲームには参加していません。');
    return savePokerHighlightRecord_({
      gameId: room.gameId, roomId: room.roomId, ruleType: room.ruleType, mode: 'ONLINE',
      players: players.map(function(player) { return {userId:player.userId, handImageIds:player.handIds}; })
    }, uid);
  });
}

function saveOfflinePokerHighlight(userId, payload) {
  const uid = validatePokerUser_(userId);
  payload = payload || {};
  const cards = getCardCatalogModel_().cards;
  const byId = pokerCardMap_(cards);
  const handIds = Array.isArray(payload.handImageIds) ? payload.handImageIds.map(asId_) : [];
  if (handIds.length !== 5 || handIds.some(function(id) { return !byId[id]; })) throw new Error('手札が正しくありません。');
  const members = handIds.map(function(id) { return byId[id].memberId; });
  if (new Set(members).size !== 5) throw new Error('同じMemberを手札へ重複できません。');
  const gameId = String(payload.gameId || Utilities.getUuid()).slice(0, 100);
  return withPokerLock_(function() {
    return savePokerHighlightRecord_({
      gameId: gameId, roomId: '', ruleType: validatePokerRule_(payload.ruleType), mode: 'OFFLINE',
      players: [{userId:uid, handImageIds:handIds}]
    }, uid);
  });
}

function getPokerHighlights(userId) {
  validatePokerUser_(userId);
  const cardMap = pokerCardMap_(getCardCatalogModel_().cards);
  const users = getPokerUserMap_();
  return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_HIGHLIGHTS)).map(function(row) {
    const data = parseJson_(row.FinalHandsJSON, {});
    return {
      highlightId: asId_(row.PokerHighlightID), mode: String(data.mode || 'ONLINE'),
      ruleType: String(data.ruleType || 'A'), roomId: String(data.roomId || ''),
      savedByUserId: asId_(row.SavedByUserID), savedByName: users[asId_(row.SavedByUserID)] || asId_(row.SavedByUserID),
      savedAt: pokerIso_(row.SavedAt),
      players: (data.players || []).map(function(player) {
        return {userId:asId_(player.userId), displayName:users[asId_(player.userId)] || asId_(player.userId), hand:(player.handImageIds || []).map(function(id){return cardMap[asId_(id)];}).filter(Boolean)};
      })
    };
  }).sort(function(a,b){return String(b.savedAt).localeCompare(String(a.savedAt));}).slice(0,30);
}

function buildPokerRoomState_(room, uid) {
  const players = getPokerPlayerRows_(room.gameId);
  const player = players.find(function(item) { return item.userId === uid; });
  if (!player) { clearPokerRoomProperty_(uid); throw new Error('このROOMには参加していません。'); }
  const userMap = getPokerUserMap_();
  const cardMap = pokerCardMap_(getCardCatalogModel_().cards);
  const votes = getPokerVoteRows_(room.gameId);
  const counts = {}; players.forEach(function(item){counts[item.userId]=0;});
  votes.forEach(function(vote){if(Object.prototype.hasOwnProperty.call(counts,vote.votedUserId))counts[vote.votedUserId]++;});
  const maxVotes = Math.max.apply(null, Object.keys(counts).map(function(id){return counts[id];}).concat([0]));
  const winners = room.status === 'COMPLETED' ? Object.keys(counts).filter(function(id){return counts[id]===maxVotes;}) : [];
  const reveal = room.status === 'VOTING' || room.status === 'COMPLETED';
  return {
    gameId:room.gameId,roomId:room.roomId,ruleType:room.ruleType,status:room.status,
    creatorUserId:room.creatorUserId,createdAt:room.createdAt,expiresAt:room.expiresAt,
    isCreator:room.creatorUserId===uid,hasVoted:votes.some(function(vote){return vote.voterUserId===uid;}),
    highlightSaved:isPokerHighlightSaved_(room.gameId),voteCounts:counts,winnerUserIds:winners,
    players:players.map(function(item){return {userId:item.userId,displayName:userMap[item.userId]||item.userId,joinOrder:item.joinOrder,isFinalized:item.isFinalized,exchangeCount:item.exchangeCount,hand:reveal||item.userId===uid?item.handIds.map(function(id){return cardMap[id];}).filter(Boolean):[]};}),
    currentPlayer:{userId:player.userId,displayName:userMap[player.userId]||player.userId,isFinalized:player.isFinalized,exchangeCount:player.exchangeCount,hand:player.handIds.map(function(id){return cardMap[id];}).filter(Boolean)}
  };
}

function requirePokerPlayContext_(uid, roomId) {
  const room = findPokerRoomByRoomId_(String(roomId || '').trim());
  if (!room || room.status !== 'PLAYING') throw new Error('現在は手札を操作できません。');
  const player = getPokerPlayerRows_(room.gameId).find(function(item){return item.userId===uid;});
  if (!player) throw new Error('このROOMには参加していません。');
  return {room:room,player:player};
}

function drawPokerCards_(catalog, keptImageIds, previouslyDrawnIds, count) {
  const cardMap = pokerCardMap_(catalog);
  const usedMembers = {};
  keptImageIds.forEach(function(id){if(cardMap[id])usedMembers[cardMap[id].memberId]=true;});
  const previously = {}; previouslyDrawnIds.forEach(function(id){previously[asId_(id)]=true;});
  const result = [];
  for (let i=0;i<count;i++) {
    let pool = catalog.filter(function(card){return !usedMembers[card.memberId]&&!previously[card.imageId];});
    if (!pool.length) pool = catalog.filter(function(card){return !usedMembers[card.memberId];});
    if (!pool.length) throw new Error('Memberが重複しない手札を作れません。');
    const byRarity={N:[],R:[],SR:[],SSR:[]};pool.forEach(function(card){if(byRarity[card.rarity])byRarity[card.rarity].push(card);});
    const rarity=chooseCardRarity_(byRarity);const options=byRarity[rarity];const card=options[Math.floor(Math.random()*options.length)];
    result.push(card);usedMembers[card.memberId]=true;previously[card.imageId]=true;
  }
  return result;
}

function getPokerPlayerRows_(gameId) {
  return readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS)).filter(function(row){return asId_(row.PokerGameID)===gameId;}).map(function(row){return {rowNumber:row.__rowNumber,userId:asId_(row.UserID),joinOrder:Number(row.JoinOrder||999),handIds:parseJson_(row.HandImageIDsJSON,[]).map(asId_),drawnIds:parseJson_(row.DrawnImageIDsJSON,[]).map(asId_),exchangeCount:Number(row.ExchangeCount||0),isFinalized:asBoolean_(row.IsFinalized)};}).sort(function(a,b){return a.joinOrder-b.joinOrder;});
}

function getPokerVoteRows_(gameId) {
  return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_VOTES)).filter(function(row){return asId_(row.PokerGameID)===gameId;}).map(function(row){return {voterUserId:asId_(row.VoterUserID),votedUserId:asId_(row.VotedUserID)};});
}

function findPokerRoomByRoomId_(roomId) {
  const row = readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_ROOMS)).find(function(item){return String(item.RoomID||'').padStart(4,'0')===roomId;});
  if (!row) return null;
  const expires = new Date(row.ExpiresAt);
  if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) return null;
  return {rowNumber:row.__rowNumber,gameId:asId_(row.PokerGameID),roomId:String(row.RoomID||'').padStart(4,'0'),ruleType:String(row.RuleType||'A'),creatorUserId:asId_(row.CreatorUserID),status:String(row.Status||'WAITING').toUpperCase(),createdAt:pokerIso_(row.CreatedAt),expiresAt:expires.toISOString()};
}

function savePokerHighlightRecord_(data, uid) {
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_HIGHLIGHTS);
  if (isPokerHighlightSaved_(data.gameId)) return {ok:true,alreadySaved:true};
  appendByHeaders_(sheet, {PokerHighlightID:Utilities.getUuid(),FinalHandsJSON:JSON.stringify(data),SavedByUserID:uid,SavedAt:new Date().toISOString()});
  return {ok:true,alreadySaved:false};
}
function isPokerHighlightSaved_(gameId){return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_HIGHLIGHTS)).some(function(row){return asId_(parseJson_(row.FinalHandsJSON,{}).gameId)===gameId;});}
function updatePokerRoom_(rowNumber, record){updatePokerPlayerRow_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_ROOMS),rowNumber,record);}
function updatePokerPlayerRow_(sheet,rowNumber,record){const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);Object.keys(record).forEach(function(key){const col=headers.indexOf(key);if(col>=0)sheet.getRange(rowNumber,col+1).setValue(record[key]);});}
function deletePokerPlayer_(gameId,uid){const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS);const rows=readSheetObjectsWithRows_(sheet).filter(function(row){return asId_(row.PokerGameID)===gameId&&asId_(row.UserID)===uid;});rows.sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).forEach(function(row){sheet.deleteRow(row.__rowNumber);});}
function deletePokerGameRows_(gameId,includeRoom){[UNIVERSE_CONFIG.SHEETS.POKER_VOTES,UNIVERSE_CONFIG.SHEETS.POKER_PLAYERS].forEach(function(name){const sheet=getLogSheet_(name);readSheetObjectsWithRows_(sheet).filter(function(row){return asId_(row.PokerGameID)===gameId;}).sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).forEach(function(row){sheet.deleteRow(row.__rowNumber);});});if(includeRoom){const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_ROOMS);readSheetObjectsWithRows_(sheet).filter(function(row){return asId_(row.PokerGameID)===gameId;}).sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).forEach(function(row){sheet.deleteRow(row.__rowNumber);});}}

function cleanupExpiredPoker_(){return withPokerLock_(cleanupExpiredPokerUnsafe_);}
function cleanupExpiredPokerUnsafe_(){const sheet=getLogSheet_(UNIVERSE_CONFIG.SHEETS.POKER_ROOMS);const expired=readSheetObjectsWithRows_(sheet).filter(function(row){const d=new Date(row.ExpiresAt);return !Number.isFinite(d.getTime())||d.getTime()<=Date.now();});expired.forEach(function(row){deletePokerGameRows_(asId_(row.PokerGameID),false);});expired.sort(function(a,b){return b.__rowNumber-a.__rowNumber;}).forEach(function(row){sheet.deleteRow(row.__rowNumber);});}
function readSheetObjectsWithRows_(sheet){const values=sheet.getDataRange().getValues();if(values.length<2)return[];const headers=values[0].map(function(v){return String(v).trim();});return values.slice(1).map(function(row,index){const obj={__rowNumber:index+2};headers.forEach(function(h,i){if(h)obj[h]=row[i];});return obj;}).filter(function(row){return Object.keys(row).some(function(key){return key!=='__rowNumber'&&row[key]!=='';});});}
function getPokerUsers_(){const rows=readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS));const map={};rows.forEach(function(row){map[asId_(row.UserID)]=String(row.DisplayName||row.UserID);});return POKER_USERS_.map(function(id){return {userId:id,displayName:map[id]||id};});}
function getPokerUserMap_(){return getPokerUsers_().reduce(function(map,user){map[user.userId]=user.displayName;return map;},{});}
function pokerCardMap_(cards){return cards.reduce(function(map,card){map[asId_(card.imageId)]=card;return map;},{});}
function uniquePokerMemberCount_(cards){return Object.keys(cards.reduce(function(map,card){map[card.memberId]=true;return map;},{})).length;}
function parseJson_(value,fallback){try{const parsed=JSON.parse(String(value||''));return parsed===null?fallback:parsed;}catch(error){return fallback;}}
function pokerIso_(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():'';}
function validatePokerUser_(value){const id=asId_(value);if(POKER_USERS_.indexOf(id)<0)throw new Error('利用ユーザーを選択してください。');return id;}
function validatePokerRule_(value){const rule=String(value||'').toUpperCase();if(POKER_RULES_.indexOf(rule)<0)throw new Error('RULEを選択してください。');return rule;}
function withPokerLock_(callback){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return callback();}finally{lock.releaseLock();}}
function pokerPropertyKey_(uid){return 'POKER_ACTIVE_ROOM_'+uid;}
function setPokerRoomProperty_(uid,roomId){PropertiesService.getScriptProperties().setProperty(pokerPropertyKey_(uid),roomId);}
function getPokerRoomProperty_(uid){return PropertiesService.getScriptProperties().getProperty(pokerPropertyKey_(uid));}
function clearPokerRoomProperty_(uid){PropertiesService.getScriptProperties().deleteProperty(pokerPropertyKey_(uid));}
