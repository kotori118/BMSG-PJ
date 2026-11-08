/** Video appearance persistence. The two existing sheets are the only data store.
 * All mutations use one Sheets batchUpdate under the shared ScriptLock.
 */
const APPEARANCE_MEMBERS_ = Object.freeze(['101','102','103','104','105','106']);
const APPEARANCE_VIDEO_COLUMNS_ = Object.freeze(['VideoID','YouTubeVideoID','Title','PublishedAt','DurationMs','Status','ResumePositionMs','Revision','SavedAt']);
const APPEARANCE_SEGMENT_COLUMNS_ = Object.freeze(['VideoID','StartMs','EndMs','MemberIDs']);

function appearanceLocked_(action) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('別の保存処理が進行中です。少し待ってから再試行してください。');
  try { return action(); } finally { lock.releaseLock(); }
}
function appearanceUser_(userId) {
  if (UNIVERSE_CONFIG.USER_IDS.indexOf(String(userId || '')) < 0) throw new Error('Universeの利用者を選択してください。');
}
function appearanceTable_(ss, name, required) {
  const sheet = getCoreSheetFromSpreadsheet_(ss, name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(v){ return String(v).trim(); });
  required.forEach(function(h){ if (headers.indexOf(h) < 0 || headers.indexOf(h) !== headers.lastIndexOf(h)) throw new Error(name + 'の列定義が不正です: ' + h); });
  const rows = values.slice(1).map(function(cells,i){
    const record = {_row:i+1}; // zero-based Sheets API row index
    headers.forEach(function(h,j){ if(h) record[h]=cells[j]; });
    return record;
  }).filter(function(r){ return headers.some(function(h){return r[h] !== '' && r[h] != null;}); });
  return {sheet:sheet, headers:headers, rows:rows, lastRow:sheet.getLastRow(), maxRows:sheet.getMaxRows(), id:sheet.getSheetId()};
}
function appearanceSnapshot_() {
  const ss = getCoreSpreadsheet_();
  const videos = appearanceTable_(ss, UNIVERSE_CONFIG.SHEETS.VIDEOS, APPEARANCE_VIDEO_COLUMNS_);
  const segments = appearanceTable_(ss, UNIVERSE_CONFIG.SHEETS.VIDEO_SEGMENTS, APPEARANCE_SEGMENT_COLUMNS_);
  const ids = {}, youtubeIds = {};
  videos.rows.forEach(function(row){
    const id = String(row.VideoID || '');
    if (!id || ids[id]) throw new Error('VideoIDが空欄または重複しています。');
    ids[id] = true;
    const yt = String(row.YouTubeVideoID || '');
    if (yt && (!/^[\w-]{11}$/.test(yt) || youtubeIds[yt])) throw new Error('YouTube動画IDが不正または重複しています。');
    if(yt) youtubeIds[yt]=true;
  });
  segments.rows.forEach(function(row){if(!ids[String(row.VideoID)])throw new Error('存在しない動画の区間があります。');});
  return {ss:ss,videos:videos,segments:segments};
}
function appearanceInteger_(value, label, minimum) {
  if (value === '' || value == null || (typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new Error(label + 'が不正です。');
  return Number(value);
}
function appearanceDate_(value, optional) {
  if (value === '' || value == null) { if(optional)return ''; throw new Error('公開日を入力してください。'); }
  if(value instanceof Date) return Utilities.formatDate(value,'Asia/Tokyo','yyyy-MM-dd');
  const s=String(value), m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(!m || new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('公開日はYYYY-MM-DD形式で入力してください。');
  return s;
}
function appearanceVideo_(row) {
  if(['not_started','in_progress','completed'].indexOf(String(row.Status))<0)throw new Error('分析状態が不正です。');
  return {videoId:String(row.VideoID),youtubeVideoId:String(row.YouTubeVideoID||''),title:String(row.Title||''),publishedAt:appearanceDate_(row.PublishedAt,true),
    durationMs:row.DurationMs===''||row.DurationMs==null?null:appearanceInteger_(row.DurationMs,'動画長',1),status:String(row.Status),
    resumePositionMs:appearanceInteger_(row.ResumePositionMs,'再開位置',0),revision:appearanceInteger_(row.Revision,'Revision',0),
    savedAt:row.SavedAt instanceof Date?row.SavedAt.toISOString():String(row.SavedAt||'')};
}
function appearanceFind_(snapshot, id, revision) {
  const row=snapshot.videos.rows.find(function(r){return String(r.VideoID)===String(id);});
  if(!row)throw new Error('動画が見つかりません。削除された可能性があります。');
  if(arguments.length>=3 && appearanceInteger_(revision,'Revision',0)!==Number(row.Revision))throw new Error('CONFLICT: 別の端末で変更されています。保存済みデータを再取得してください。');
  return row;
}
function appearanceNormalizeSegments_(rows,duration) {
  if(!Array.isArray(rows))throw new Error('区間一覧が不正です。');
  const sorted=rows.map(function(r){
    if(!r || r.open || r.pending || r.endMs==null)throw new Error('未確定の区間は保存できません。');
    const start=appearanceInteger_(r.startMs,'開始位置',0),end=appearanceInteger_(r.endMs,'終了位置',1);
    if(!duration || start>=end || end>duration)throw new Error('区間は開始＜終了、動画長以内で指定してください。動画長不明では確定できません。');
    const ids=String(r.memberIds||'').split(',');
    if(r.memberIds!=='NONE' && (!ids.length || new Set(ids).size!==ids.length || ids.some(function(id){return APPEARANCE_MEMBERS_.indexOf(id)<0;})))throw new Error('出演メンバーが不正です。');
    return {startMs:start,endMs:end,memberIds:r.memberIds==='NONE'?'NONE':ids.sort().join(',')};
  }).sort(function(a,b){return a.startMs-b.startMs;});
  sorted.forEach(function(r,i){if(i && sorted[i-1].endMs>r.startMs)throw new Error('出演区間が重複しています。');});
  return sorted;
}
function appearanceSegments_(snapshot, id, duration) {
  const rows=snapshot.segments.rows.filter(function(r){return String(r.VideoID)===String(id);}).map(function(r){return {startMs:r.StartMs,endMs:r.EndMs,memberIds:String(r.MemberIDs)};});
  // Unknown duration in legacy data must remain visible as uncomputable coverage.
  return appearanceNormalizeSegments_(rows,duration||Number.MAX_SAFE_INTEGER);
}
function appearanceMembers_(ss) {
  const rows=readCoreSheetObjectsFromSpreadsheet_(ss,UNIVERSE_CONFIG.SHEETS.MEMBERS);
  return APPEARANCE_MEMBERS_.map(function(id){
    const row=rows.find(function(r){return String(r.MemberID)===id;});
    if(!row)throw new Error('02_Membersに対象メンバーがありません: '+id);
    return {memberId:id,name:String(row.DisplayName||row.Name||id),color:/^#[a-f\d]{6}$/i.test(String(row.ColorHex))?String(row.ColorHex):'#9cecff'};
  });
}
function appearanceCells_(table, record) {
  return table.headers.map(function(h){const v=record[h];return {userEnteredValue:v===''||v==null?{}:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}};});
}
function appearanceUpdateRow_(table, row, record) {
  return {updateCells:{start:{sheetId:table.id,rowIndex:row,columnIndex:0},rows:[{values:appearanceCells_(table,record)}],fields:'userEnteredValue'}};
}
function appearanceDeletionRequests_(table, rowIndexes) {
  const sorted=rowIndexes.slice().sort(function(a,b){return a-b;}),groups=[];
  sorted.forEach(function(row){const last=groups[groups.length-1];if(last&&last.endIndex===row)last.endIndex++;else groups.push({sheetId:table.id,dimension:'ROWS',startIndex:row,endIndex:row+1});});
  return groups.reverse().map(function(range){return {deleteDimension:{range:range}};});
}
function appearanceEnsureRows_(requests, table, needed, deleted) {
  const shortage=Math.max(needed,2)-(table.maxRows-(deleted||0));
  // Extend before deletion, retaining a non-header row even at full capacity.
  if(shortage>0)requests.unshift({appendDimension:{sheetId:table.id,dimension:'ROWS',length:shortage}});
}
function appearanceBatch_(requests) {
  const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+UNIVERSE_CONFIG.CORE_DB_ID+':batchUpdate',{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},payload:JSON.stringify({requests:requests}),muteHttpExceptions:true
  });
  if(response.getResponseCode()<200 || response.getResponseCode()>=300)throw new Error('保存に失敗しました（Sheets API '+response.getResponseCode()+'）。再取得して保存状態を確認してください。');
}
