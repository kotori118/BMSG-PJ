import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const root=path.resolve(import.meta.dirname,'..');
const plain=x=>JSON.parse(JSON.stringify(x));
function runtime(){
  const state={requests:[],locks:0,fail:false};
  const videoHeaders=['VideoID','YouTubeVideoID','Title','PublishedAt','DurationMs','Status','ResumePositionMs','Revision','SavedAt'];
  const segHeaders=['VideoID','StartMs','EndMs','MemberIDs'];
  const sheets={
    '12_Videos':{id:12,values:[videoHeaders,['VID000001','abcdefghijk','one','2026-01-01',300000,'in_progress',0,2,''],['VID000002','bcdefghijkl','two','2026-03-01',100000,'not_started',0,0,'']],max:10},
    '13_VideoSegments':{id:13,values:[segHeaders,['VID000001',0,10000,'101'],['VID000002',0,1000,'NONE'],['VID000001',10000,20000,'102']],max:5},
    '02_Members':{id:2,values:[['MemberID','Name','ColorHex'],...['SOTA','SHUNTO','MANATO','RYUHEI','JUNON','LEO'].map((name,i)=>[String(101+i),name,'#9cecff'])],max:10}
  };
  const spreadsheet={getSheetByName(name){const sheet=sheets[name];if(!sheet)return null;return {
    getDataRange:()=>({getValues:()=>sheet.values}),getRange:()=>({getValues:()=>sheet.values}),getLastRow:()=>sheet.values.length,getLastColumn:()=>sheet.values[0].length,getMaxRows:()=>sheet.max,getSheetId:()=>sheet.id
  };}};
  const sandbox={console,Set,Date,URL,Number,JSON,
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>state.key||''})},
    LockService:{getScriptLock:()=>({tryLock:()=>{state.locks++;return true;},releaseLock:()=>state.locks--})},
    SpreadsheetApp:{openById:()=>spreadsheet},
    Utilities:{getUuid:()=> '01234567-1234-1234-1234-123456789abc',formatDate:(d)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10)},
    ScriptApp:{getOAuthToken:()=> 'TEST_TOKEN'},
    UrlFetchApp:{fetch(url,options){
      if(url.includes('youtube'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(state.youtube||{items:[]})};
      assert.equal(state.locks,1);const requests=JSON.parse(options.payload).requests;state.requests.push(requests);
      if(!state.fail){
        for(const req of requests){
          if(req.deleteDimension){const r=req.deleteDimension.range,table=Object.values(sheets).find(s=>s.id===r.sheetId);table.values.splice(r.startIndex,r.endIndex-r.startIndex);table.max-=r.endIndex-r.startIndex;}
          if(req.appendDimension){const r=req.appendDimension,table=Object.values(sheets).find(s=>s.id===r.sheetId);table.max+=r.length;}
          if(req.updateCells){const r=req.updateCells,table=Object.values(sheets).find(s=>s.id===r.start.sheetId);r.rows.forEach((row,i)=>{assert.ok(r.start.rowIndex+i<table.max);table.values[r.start.rowIndex+i]=row.values.map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue??'');});}
        }
      }
      return {getResponseCode:()=>state.fail?500:200};
    }}
  };
  vm.createContext(sandbox);
  for(const file of ['Config.gs','CoreRepository.gs','AppearanceRepository.gs','AppearanceApi.gs','AppearanceStats.gs'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
  return {api:sandbox,state,sheets};
}
const payload={userId:'U001',videoId:'VID000001',revision:2,durationMs:300000,status:'in_progress',resumePositionMs:20000,segments:[{startMs:0,endMs:20000,memberIds:'103,101'}]};
test('save replaces only target rows atomically, normalizes IDs and increments revision',()=>{
  const {api,state,sheets}=runtime();const saved=api.saveVideoAnalysis(payload);
  assert.equal(state.requests.length,1);assert.equal(state.locks,0);assert.equal(saved.video.revision,3);
  assert.deepEqual(plain(api.getVideoAnalysis('VID000002').segments),[{startMs:0,endMs:1000,memberIds:'NONE'}]);
  assert.deepEqual(plain(api.getVideoAnalysis('VID000001').segments),[{startMs:0,endMs:20000,memberIds:'101,103'}]);
  assert.ok(state.requests[0].some(r=>r.updateCells?.start.sheetId===12));
});
test('stale revision, invalid intervals, pending segments, unknown member and incomplete completion cannot write',()=>{
  for(const patch of [{revision:undefined},{revision:1},{segments:[{startMs:10,endMs:5,memberIds:'101'}]},{openSegment:{}},{segments:[{startMs:0,endMs:5,memberIds:'107'}]},{segments:[{startMs:0,endMs:5,memberIds:'101,101'}]},{segments:[{startMs:0,endMs:5,memberIds:'101'},{startMs:4,endMs:6,memberIds:'102'}]},{status:'completed'},{durationMs:0},{resumePositionMs:300001}]){
    const {api,state}=runtime();assert.throws(()=>api.saveVideoAnalysis({...payload,...patch}));assert.equal(state.requests.length,0);assert.equal(state.locks,0);
  }
});
test('empty save and adjacent intervals are valid, capacity extension is in the same batch',()=>{
  const {api,state,sheets}=runtime();sheets['13_VideoSegments'].max=4;
  const segments=Array.from({length:20},(_,i)=>({startMs:i*100,endMs:(i+1)*100,memberIds:'NONE'}));
  api.saveVideoAnalysis({...payload,segments});assert.equal(state.requests.length,1);assert.ok(state.requests[0].some(r=>r.appendDimension));
  const result=api.saveVideoAnalysis({...payload,revision:3,segments:[]});assert.equal(result.segments.length,0);assert.equal(api.getVideoAnalysis('VID000002').segments.length,1);
});
test('failed batch leaves database and revision unchanged',()=>{
  const {api,state,sheets}=runtime();const before=plain(sheets);state.fail=true;
  assert.throws(()=>api.saveVideoAnalysis(payload),/保存に失敗/);assert.deepEqual(sheets,before);assert.equal(state.locks,0);
});
test('delete checks revision and exact confirmation then deletes only target video and segments',()=>{
  const {api,state}=runtime();const p={userId:'U001',videoId:'VID000001',revision:2,confirmed:true,confirmTitle:'one',segmentCount:2};
  assert.throws(()=>api.deleteVideo({...p,segmentCount:1}));assert.equal(state.requests.length,0);
  api.deleteVideo(p);assert.throws(()=>api.getVideoAnalysis('VID000001'));assert.equal(api.getVideoAnalysis('VID000002').segments.length,1);assert.equal(state.requests.length,1);
});
test('metadata rejects duplicate videos and preserves existing analysis on update',()=>{
  const {api,state}=runtime();assert.throws(()=>api.registerVideo({userId:'U001',youtubeVideoId:'abcdefghijk',title:'copy',publishedAt:'2026-01-01'}),/登録/);
  const updated=api.updateVideoMetadata({userId:'U001',videoId:'VID000001',revision:2,youtubeVideoId:'abcdefghijk',title:'renamed',publishedAt:'2026-01-02',durationMs:300000});
  assert.equal(updated.video.title,'renamed');assert.equal(updated.video.revision,3);assert.equal(updated.segments.length,2);
});
test('YouTube parser accepts supported URLs and rejects spoof hosts; metadata uses JST and rejects live duration',()=>{
  const {api,state}=runtime();for(const url of ['https://www.youtube.com/watch?v=abcdefghijk&si=abc','https://youtu.be/abcdefghijk?t=1','https://m.youtube.com/shorts/abcdefghijk','https://youtube.com/live/abcdefghijk'])assert.equal(api.appearanceYouTubeId_(url),'abcdefghijk');
  for(const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk','https://evil.test/abcdefghijk','javascript:abcdefghijk'])assert.throws(()=>api.appearanceYouTubeId_(url));
  assert.match(api.getYouTubeVideoMetadata('abcdefghijk').warning,/未設定/);
  state.key='SECRET';state.youtube={items:[{snippet:{title:'title',publishedAt:'2026-01-01T16:00:00Z',liveBroadcastContent:'none'},contentDetails:{duration:'PT1H2M3S'},status:{embeddable:true}}]};
  let meta=api.getYouTubeVideoMetadata('abcdefghijk');assert.equal(meta.durationMs,3723000);assert.equal(meta.publishedAt,'2026-01-02');assert.equal(JSON.stringify(meta).includes('SECRET'),false);
  state.youtube.items[0].snippet.liveBroadcastContent='live';meta=api.getYouTubeVideoMetadata('abcdefghijk');assert.equal(meta.durationMs,null);assert.equal(meta.livePending,true);
});
test('aggregation includes ALL individually, excludes ALL from pairs, includes NONE denominator and omits gaps',()=>{
  const {api}=runtime(),members=api.appearanceMembers_({getSheetByName:()=>({getLastRow:()=>7,getLastColumn:()=>3,getRange:()=>({getValues:()=>[['MemberID','Name'],...Array.from({length:6},(_,i)=>[String(101+i),'M'+i])]})})});
  const videos=[{videoId:'a',title:'a',publishedAt:'2026-01-10',durationMs:300000,status:'completed',segments:[{startMs:0,endMs:120000,memberIds:'101,102,103,104,105,106'},{startMs:120000,endMs:180000,memberIds:'NONE'},{startMs:200000,endMs:230000,memberIds:'101,102,103'}]}, {videoId:'b',title:'b',publishedAt:'2026-03-10',durationMs:10000,status:'in_progress',segments:[{startMs:0,endMs:10000,memberIds:'NONE'}]}];
  const d=api.appearanceAggregate_(videos,members,{});assert.equal(d.measuredMs,220000);assert.equal(d.allMs,120000);assert.equal(d.ranking[0].appearanceMs,150000);assert.equal(d.pairs[0].appearanceMs,30000);assert.equal(d.pairs.length,15);assert.equal(d.months[1].rates['101'],null);assert.equal(d.videoCount,2);assert.equal(d.provisional,true);
  assert.equal(d.ranking[0].rate,150000/220000);assert.equal(d.ranking[0].meanRate,(150000/210000)/2);
  assert.equal(d.videos[1].individual['101'],0);
  assert.equal(api.appearanceAggregate_(videos,members,{from:'2026-03-10',to:'2026-03-10'}).measuredMs,10000);
  const missing=api.appearanceAggregate_([{...videos[0],durationMs:null}],members,{});assert.equal(missing.coverage,null);assert.equal(missing.coverageUnavailable,true);
  const empty=api.appearanceAggregate_([{...videos[0],segments:[]}],members,{});assert.equal(empty.ranking[0].rate,null);assert.equal(empty.coverage,null);
});

test('metadata and delete require a revision, and confirmed URL correction preserves measured intervals',()=>{
 const {api,state}=runtime();const p={userId:'U001',videoId:'VID000001',title:'one',publishedAt:'2026-01-01',durationMs:300000,youtubeVideoId:'abcdefghijk'};
 assert.throws(()=>api.updateVideoMetadata(p),/Revision/);assert.throws(()=>api.deleteVideo({userId:'U001',videoId:'VID000001',confirmed:true,confirmTitle:'one',segmentCount:2}),/Revision/);assert.equal(state.requests.length,0);
 assert.throws(()=>api.updateVideoMetadata({...p,revision:2,youtubeVideoId:'short'}));
 // A different valid 11-character ID is a metadata correction after explicit confirmation.
 assert.throws(()=>api.updateVideoMetadata({...p,revision:2,youtubeVideoId:'newvideo123'}),/確認/);
 const result=api.updateVideoMetadata({...p,revision:2,youtubeVideoId:'newvideo123',youtubeChangeConfirmed:true});assert.equal(result.video.youtubeVideoId,'newvideo123');assert.equal(result.segments.length,2);
});

test('header mapping survives column reordering and interleaved replacement preserves other videos',()=>{
 for(let count=1;count<=16;count++){
  const {api,sheets}=runtime();
  sheets['13_VideoSegments'].values=[['VideoID','StartMs','EndMs','MemberIDs'],...Array.from({length:count},(_,i)=>[i%2?'VID000001':'VID000002',i*100,(i+1)*100,i%2?'101':'NONE'])];sheets['13_VideoSegments'].max=count+1;
  for(const name of ['12_Videos','13_VideoSegments'])sheets[name].values=sheets[name].values.map(row=>row.slice().reverse());
  const before=plain(api.getVideoAnalysis('VID000002').segments);
  api.saveVideoAnalysis(payload);
  assert.deepEqual(plain(api.getVideoAnalysis('VID000002').segments),before);assert.equal(api.getVideoAnalysis('VID000001').video.revision,3);assert.equal(api.getVideoAnalysis('VID000001').segments.length,1);
 }
});
