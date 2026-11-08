/** Appearance feature API. Existing Universe user selection is retained; no new auth system. */
function listVideos() {
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_();
    const videos=s.videos.rows.map(function(row){
      const video=appearanceVideo_(row),segments=appearanceSegments_(s,video.videoId,video.durationMs);
      video.measuredMs=segments.reduce(function(sum,r){return sum+r.endMs-r.startMs;},0);
      video.coverage=video.durationMs?video.measuredMs/video.durationMs:null;
      return video;
    }).sort(function(a,b){return b.publishedAt.localeCompare(a.publishedAt)||a.title.localeCompare(b.title);});
    return {videos:videos,members:appearanceMembers_(s.ss)};
  });
}
function getVideoAnalysis(videoId) {
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_(),video=appearanceVideo_(appearanceFind_(s,videoId));
    return {video:video,segments:appearanceSegments_(s,video.videoId,video.durationMs)};
  });
}
function getYouTubeVideoMetadata(input) {
  const id=appearanceYouTubeId_(input);
  const key=PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY');
  if(!key)return {youtubeVideoId:id,warning:'YouTube API未設定です。GASのスクリプトプロパティにYOUTUBE_API_KEYを設定してください。手入力でも登録できます。'};
  let data;
  try {
    const response=UrlFetchApp.fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,liveStreamingDetails&id='+encodeURIComponent(id),{
      headers:{'X-Goog-Api-Key':key},muteHttpExceptions:true
    });
    if(response.getResponseCode()!==200)return {youtubeVideoId:id,warning:'動画情報を取得できません（YouTube API '+response.getResponseCode()+'）。API設定を確認するか手入力してください。'};
    data=JSON.parse(response.getContentText());
  }catch(error){return {youtubeVideoId:id,warning:'動画情報の取得に失敗しました。再取得するか手入力してください。'};}
  const item=data.items&&data.items[0];
  if(!item)return {youtubeVideoId:id,warning:'動画が見つかりません。非公開・削除済みなどの可能性があります。'};
  const snippet=item.snippet||{}, live=item.liveStreamingDetails||{};
  const livePending=snippet.liveBroadcastContent==='live'||snippet.liveBroadcastContent==='upcoming'||(!!live.actualStartTime&&!live.actualEndTime);
  return {youtubeVideoId:id,title:snippet.title||'',publishedAt:snippet.publishedAt?Utilities.formatDate(new Date(snippet.publishedAt),'Asia/Tokyo','yyyy-MM-dd'):'',
    durationMs:livePending?null:appearanceDuration_(item.contentDetails&&item.contentDetails.duration),
    livePending:livePending,embeddable:!!(item.status&&item.status.embeddable),
    warning:livePending?'配信中・配信予定の動画は確定尺が得られるまで計測できません。':item.status&&item.status.embeddable===false?'この動画は埋め込み再生できません。計測不可です。':''};
}
function appearanceYouTubeId_(input) {
  const text=String(input||'').trim();
  if(/^[\w-]{11}$/.test(text))return text;
  const match=/^https?:\/\/(?:www\.|m\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\/([^#]*)/i.exec(text);
  if(!match)throw new Error('YouTubeの動画URLを入力してください。');
  const path=match[2];let id='';
  if(match[1].toLowerCase()==='youtu.be')id=path.split(/[?\/]/)[0];
  else if(/^(embed|shorts|live)\//.test(path))id=path.split('/')[1].split('?')[0];
  else {const v=/(?:^watch\?|&)v=([^&]+)/.exec(path);if(v)id=v[1];}
  if(!/^[\w-]{11}$/.test(id))throw new Error('YouTubeの動画IDを読み取れません。');
  return id;
}
function appearanceDuration_(duration) {
  const m=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(duration||''));
  if(!m)return null;
  const ms=Math.round(((Number(m[1]||0)*24+Number(m[2]||0))*3600+Number(m[3]||0)*60+Number(m[4]||0))*1000);
  return Number.isSafeInteger(ms)&&ms>0?ms:null;
}
function appearanceMetadata_(payload) {
  const title=String(payload.title||'').trim();
  if(!title)throw new Error('動画タイトルを入力してください。');
  return {YouTubeVideoID:payload.youtubeVideoId?appearanceYouTubeId_(payload.youtubeVideoId):'',Title:title,PublishedAt:appearanceDate_(payload.publishedAt,false),DurationMs:payload.durationMs===''||payload.durationMs==null?'':appearanceInteger_(payload.durationMs,'動画長',1)};
}
function appearanceUniqueYouTube_(s,id,exclude) {
  if(id&&s.videos.rows.some(function(r){return String(r.YouTubeVideoID)===id&&String(r.VideoID)!==exclude;}))throw new Error('このYouTube動画はすでに登録されています。既存の動画を開いてください。');
}
function registerVideo(payload) {
  payload=payload||{};appearanceUser_(payload.userId);
  const metadata=appearanceMetadata_(payload);
  if(!metadata.YouTubeVideoID)throw new Error('新規登録にはYouTube URLが必要です。');
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_();appearanceUniqueYouTube_(s,metadata.YouTubeVideoID,'');
    let id;do{id='VID'+Utilities.getUuid().replace(/-/g,'');}while(s.videos.rows.some(function(r){return r.VideoID===id;}));
    const row=Object.assign({VideoID:id,Status:'not_started',ResumePositionMs:0,Revision:0,SavedAt:''},metadata),requests=[];
    appearanceEnsureRows_(requests,s.videos,s.videos.lastRow+1,0);
    requests.push(appearanceUpdateRow_(s.videos,s.videos.lastRow,row));appearanceBatch_(requests);
    return {video:appearanceVideo_(row),segments:[]};
  });
}
function updateVideoMetadata(payload) {
  payload=payload||{};appearanceUser_(payload.userId);const metadata=appearanceMetadata_(payload);
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_(),row=appearanceFind_(s,payload.videoId,payload.revision);
    appearanceUniqueYouTube_(s,metadata.YouTubeVideoID,String(row.VideoID));
    const existing=appearanceSegments_(s,row.VideoID,Number(row.DurationMs)||null);
    if(existing.length&&metadata.YouTubeVideoID!==String(row.YouTubeVideoID||'')&&payload.youtubeChangeConfirmed!==true)throw new Error('動画URLの変更には、計測済み区間を保持することの確認が必要です。動画一覧を再取得してから確認してください。');
    if(existing.length&&!metadata.DurationMs)throw new Error('計測済み動画の動画長は空欄にできません。');
    appearanceNormalizeSegments_(existing,metadata.DurationMs||null);
    const updated=Object.assign({},row,metadata,{Revision:Number(row.Revision)+1,SavedAt:new Date().toISOString()});
    if(metadata.DurationMs&&Number(updated.ResumePositionMs)>metadata.DurationMs)updated.ResumePositionMs=metadata.DurationMs;
    appearanceBatch_([appearanceUpdateRow_(s.videos,row._row,updated)]);
    return {video:appearanceVideo_(updated),segments:existing};
  });
}
function saveVideoAnalysis(payload) {
  payload=payload||{};appearanceUser_(payload.userId);
  if(payload.openSegment||payload.pendingSegment)throw new Error('区間確定が必要です。');
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_(),row=appearanceFind_(s,payload.videoId,payload.revision),duration=appearanceInteger_(payload.durationMs,'動画長',1);
    if(!row.YouTubeVideoID)throw new Error('YouTube URLを登録してください。');
    const segments=appearanceNormalizeSegments_(payload.segments,duration),position=appearanceInteger_(payload.resumePositionMs,'再開位置',0);
    if(position>duration)throw new Error('再開位置が動画長を超えています。');
    if(['not_started','in_progress','completed'].indexOf(payload.status)<0)throw new Error('分析状態が不正です。');
    const measured=segments.reduce(function(sum,r){return sum+r.endMs-r.startMs;},0);
    if(payload.status==='completed'&&measured<duration&&payload.incompleteConfirmed!==true)throw new Error('未計測区間があります。カバー率を確認して完了を指定してください。');
    const status=payload.status==='not_started'?'in_progress':payload.status;
    const old=s.segments.rows.filter(function(r){return String(r.VideoID)===String(row.VideoID);});
    const requests=appearanceDeletionRequests_(s.segments,old.map(function(r){return r._row;}));
    const start=s.segments.lastRow-old.length;
    appearanceEnsureRows_(requests,s.segments,start+segments.length,old.length);
    if(segments.length)requests.push({updateCells:{start:{sheetId:s.segments.id,rowIndex:start,columnIndex:0},rows:segments.map(function(r){return {values:appearanceCells_(s.segments,{VideoID:row.VideoID,StartMs:r.startMs,EndMs:r.endMs,MemberIDs:r.memberIds})};}),fields:'userEnteredValue'}});
    const updated=Object.assign({},row,{DurationMs:duration,Status:status,ResumePositionMs:position,Revision:Number(row.Revision)+1,SavedAt:new Date().toISOString()});
    requests.push(appearanceUpdateRow_(s.videos,row._row,updated));appearanceBatch_(requests);
    return {video:appearanceVideo_(updated),segments:segments};
  });
}
function deleteVideo(payload) {
  payload=payload||{};appearanceUser_(payload.userId);
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_(),row=appearanceFind_(s,payload.videoId,payload.revision),old=s.segments.rows.filter(function(r){return String(r.VideoID)===String(row.VideoID);});
    if(payload.confirmed!==true||payload.confirmTitle!==String(row.Title)||payload.segmentCount!==old.length)throw new Error('削除対象をもう一度確認してください。');
    const requests=appearanceDeletionRequests_(s.segments,old.map(function(r){return r._row;}));
    requests.push.apply(requests,appearanceDeletionRequests_(s.videos,[row._row]));
    appearanceEnsureRows_(requests,s.segments,2,old.length);appearanceEnsureRows_(requests,s.videos,2,1);appearanceBatch_(requests);
    return {ok:true,videoId:String(row.VideoID)};
  });
}
function getAppearanceStats(filter) {
  return appearanceLocked_(function(){
    const s=appearanceSnapshot_(),members=appearanceMembers_(s.ss);
    const videos=s.videos.rows.map(function(row){const video=appearanceVideo_(row);video.segments=appearanceSegments_(s,video.videoId,video.durationMs);return video;});
    return appearanceAggregate_(videos,members,filter||{});
  });
}
