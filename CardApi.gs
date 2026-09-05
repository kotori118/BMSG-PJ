const CARD_USERS_ = Object.freeze(['U001','U002','U003']);
const CARD_GROUP_NAMES_ = Object.freeze(['ALL','BE:FIRST','MAZZEL','STARGLOW','HANA','BMSG POSSE']);
const CARD_RARITY_WEIGHTS_ = Object.freeze({N:70,R:24,SR:5,SSR:1});
const CARD_RARITY_ORDER_ = Object.freeze({N:0,R:1,SR:2,SSR:3});
const CARD_CATALOG_CACHE_KEY_ = 'trading_card_catalog_v2';
const CARD_COLLECTION_CACHE_PREFIX_ = 'trading_card_collection_v1_';
const CARD_CACHE_SECONDS_ = 300;

function getTradingCardBootstrap(userId) {
  const uid = validateCardUser_(userId);
  const model = getCardCatalogModel_();
  const collected = readCardCollectionIds_(uid);
  cacheCardCollectionIds_(uid, collected);
  return {
    groups: model.groups,
    cards: model.cards.map(function(card){return Object.assign({}, card, {isDrawn: !!collected[card.imageId]});}),
    brandLogoDriveFileId: model.brandLogoDriveFileId,
    totalCount: model.cards.length,
    collectedCount: model.cards.reduce(function(sum, card){return sum + (collected[card.imageId] ? 1 : 0);},0)
  };
}

function drawTradingCard(userId, groupName) {
  const uid = validateCardUser_(userId);
  const selectedGroup = CARD_GROUP_NAMES_.indexOf(String(groupName || '')) >= 0 ? String(groupName) : 'ALL';
  return withCardLock_(function(){
    const model = getCardCatalogModel_();
    const group = model.groups.find(function(item){return item.name === selectedGroup;});
    if (!group) throw new Error('Groupが見つかりません。');
    const allowed = {}; group.memberIds.forEach(function(id){allowed[id] = true;});
    const pool = model.cards.filter(function(card){return selectedGroup === 'ALL' || allowed[card.memberId];});
    if (!pool.length) throw new Error('抽選できるカードがありません。');
    const byRarity = {N:[],R:[],SR:[],SSR:[]}; pool.forEach(function(card){if(byRarity[card.rarity])byRarity[card.rarity].push(card);});
    const rarity = chooseCardRarity_(byRarity);
    const candidates = byRarity[rarity];
    const card = candidates[Math.floor(Math.random() * candidates.length)];

    const log = SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID);
    const collectionSheet = requireUniverseSheet_(log, UNIVERSE_CONFIG.SHEETS.CARD_COLLECTIONS);
    let collected = getCachedCardCollectionIds_(uid);
    if (!collected) collected = readCardCollectionIdsFromRows_(readSheetObjects_(collectionSheet), uid);
    const already = !!collected[card.imageId];
    if (!already) {
      appendByHeaders_(collectionSheet, {UserID:uid, ImageID:card.imageId});
      collected[card.imageId] = true;
      cacheCardCollectionIds_(uid, collected);
    }

    const activitySheet = requireUniverseSheet_(log, UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES);
    appendByHeaders_(activitySheet, {ActivityID:Utilities.getUuid(),UserID:uid,ActivityType:'DRAW_CARD',TargetID:card.imageId,OccurredAt:new Date()});
    return {card:card,isNew:!already,totalCount:model.cards.length,collectedCount:model.cards.reduce(function(sum,item){return sum + (collected[item.imageId] ? 1 : 0);},0)};
  });
}

function resetTradingCardCollection(userId) {
  const uid = validateCardUser_(userId);
  return withCardLock_(function(){
    const bootstrap = getTradingCardBootstrap(uid);
    if (!bootstrap.totalCount || bootstrap.collectedCount < bootstrap.totalCount) throw new Error('100%コンプリート後にリセットできます。');
    const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.CARD_COLLECTIONS);
    const values = sheet.getDataRange().getValues(); if (values.length < 2) return {ok:true};
    const headers = values[0].map(function(v){return String(v).trim();}); const userCol = headers.indexOf('UserID');
    for (let i=values.length-1;i>=1;i--) if(asId_(values[i][userCol])===uid) sheet.deleteRow(i+1);
    CacheService.getScriptCache().remove(CARD_COLLECTION_CACHE_PREFIX_ + uid);
    return {ok:true};
  });
}

function getCardCatalogModel_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CARD_CATALOG_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  const core = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const groups = readSheetObjects_(requireUniverseSheet_(core, UNIVERSE_CONFIG.SHEETS.GROUPS));
  const members = readSheetObjects_(requireUniverseSheet_(core, UNIVERSE_CONFIG.SHEETS.MEMBERS));
  const memberships = readSheetObjects_(requireUniverseSheet_(core, UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS));
  const images = readSheetObjects_(requireUniverseSheet_(core, UNIVERSE_CONFIG.SHEETS.IMAGES));
  const model = buildCardCatalog_(groups, members, memberships, images);
  const serialized = JSON.stringify(model);
  if (serialized.length < 95000) cache.put(CARD_CATALOG_CACHE_KEY_, serialized, CARD_CACHE_SECONDS_);
  return model;
}

function buildCardCatalog_(groups, members, memberships, images) {
  const memberById={}; members.forEach(function(row){const id=asId_(row.MemberID);if(!id)return;memberById[id]={id:id,name:String(row.DisplayName||id),color:/^#[0-9a-f]{6}$/i.test(String(row.ColorHex||''))?String(row.ColorHex):'#9cecff',displayOrder:Number(row.DisplayOrder||9999)};});
  const groupById={}; groups.forEach(function(row){const id=asId_(row.GroupID);if(!id)return;groupById[id]={id:id,name:String(row.GroupName||id),color:String(row.ColorHex||'#9cecff'),displayOrder:Number(row.DisplayOrder||9999),memberIds:[],logoDriveFileId:''};});
  memberships.forEach(function(row){const gid=asId_(row.GroupID),mid=asId_(row.MemberID);if(groupById[gid]&&memberById[mid]&&groupById[gid].memberIds.indexOf(mid)<0)groupById[gid].memberIds.push(mid);});
  Object.keys(groupById).forEach(function(id){groupById[id].memberIds.sort(function(a,b){return memberById[a].displayOrder-memberById[b].displayOrder;});});
  let brandColor='',brandWhite='';
  images.forEach(function(row){const type=String(row.TargetType||'').trim().toLowerCase();const target=asId_(row.TargetID);const fileId=String(row.DriveFileID||'').trim();if(!fileId)return;if(type==='group'&&groupById[target])groupById[target].logoDriveFileId=fileId;if(type==='brand'){const key=String(row.TargetID||'').trim().toUpperCase();if(key==='BMSG_COLOR_BG')brandColor=fileId;if(key==='BMSG_WHITE_BG')brandWhite=fileId;}});
  const brandLogoDriveFileId=brandWhite||brandColor||'';
  const cards=images.filter(function(row){const targetType=String(row.TargetType||'').trim().toLowerCase();const rarity=String(row.Rarity||'').trim().toUpperCase();return targetType==='member'&&memberById[asId_(row.TargetID)]&&CARD_RARITY_ORDER_[rarity]!=null&&String(row.DriveFileID||'').trim();}).map(function(row){const member=memberById[asId_(row.TargetID)];return {imageId:asId_(row.ImageID),memberId:member.id,memberName:member.name,memberColor:member.color,rarity:String(row.Rarity||'').trim().toUpperCase(),driveFileId:String(row.DriveFileID||'').trim(),displayOrder:Number(row.DisplayOrder||9999)};}).sort(function(a,b){const ma=memberById[a.memberId],mb=memberById[b.memberId];return ma.displayOrder-mb.displayOrder||CARD_RARITY_ORDER_[a.rarity]-CARD_RARITY_ORDER_[b.rarity]||a.displayOrder-b.displayOrder;});
  const cardMemberIds={};cards.forEach(function(card){cardMemberIds[card.memberId]=true;});
  const uiGroups=CARD_GROUP_NAMES_.map(function(name,index){if(name==='ALL')return {name:'ALL',color:'#9cecff',displayOrder:0,logoDriveFileId:brandLogoDriveFileId,memberIds:Object.keys(cardMemberIds).sort(function(a,b){return memberById[a].displayOrder-memberById[b].displayOrder;})};const group=Object.keys(groupById).map(function(id){return groupById[id];}).find(function(item){return item.name===name;});return {name:name,color:group?group.color:'#9cecff',displayOrder:index,logoDriveFileId:group&&group.logoDriveFileId?group.logoDriveFileId:brandLogoDriveFileId,memberIds:group?group.memberIds.filter(function(id){return cardMemberIds[id];}):[]};});
  return {groups:uiGroups,cards:cards,brandLogoDriveFileId:brandLogoDriveFileId};
}

function getCachedCardCollectionIds_(uid){const raw=CacheService.getScriptCache().get(CARD_COLLECTION_CACHE_PREFIX_+uid);if(!raw)return null;try{const ids=JSON.parse(raw),map={};ids.forEach(function(id){map[String(id)]=true;});return map;}catch(e){return null;}}
function cacheCardCollectionIds_(uid,map){CacheService.getScriptCache().put(CARD_COLLECTION_CACHE_PREFIX_+uid,JSON.stringify(Object.keys(map||{})),CARD_CACHE_SECONDS_);}
function chooseCardRarity_(byRarity){const available=Object.keys(CARD_RARITY_WEIGHTS_).filter(function(r){return byRarity[r]&&byRarity[r].length;});if(!available.length)throw new Error('抽選できるカードがありません。');const total=available.reduce(function(sum,r){return sum+CARD_RARITY_WEIGHTS_[r];},0);let value=Math.random()*total;for(let i=0;i<available.length;i++){value-=CARD_RARITY_WEIGHTS_[available[i]];if(value<0)return available[i];}return available[available.length-1];}
function readCardCollectionIds_(uid){const rows=readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.CARD_COLLECTIONS));return readCardCollectionIdsFromRows_(rows,uid);}function readCardCollectionIdsFromRows_(rows,uid){return rows.reduce(function(map,row){if(asId_(row.UserID)===uid)map[asId_(row.ImageID)]=true;return map;},{});}function validateCardUser_(userId){const id=asId_(userId);if(CARD_USERS_.indexOf(id)<0)throw new Error('利用ユーザーを選択してください。');return id;}function withCardLock_(callback){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return callback();}finally{lock.releaseLock();}}function requireUniverseSheet_(ss,name){const sheet=ss.getSheetByName(name);if(!sheet)throw new Error('Sheet not found: '+name);return sheet;}
