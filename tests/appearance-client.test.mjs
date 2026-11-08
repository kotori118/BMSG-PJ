import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const root=path.resolve(import.meta.dirname,'..');
const plain=x=>JSON.parse(JSON.stringify(x));
function client(){
 const elements={};const el=id=>elements[id]||(elements[id]={id,innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,dataset:{},setAttribute(k,v){this[k]=v;}});
 const names=['SOTA','SHUNTO','MANATO','RYUHEI','JUNON','LEO'];
 const controls=['101','102','103','104','105','106','ALL','NONE'].map(id=>Object.assign(el('member-'+id),{dataset:{apSelect:id}}));
 const events={};
 const sandbox={console,JSON,Set,Number,Date,setTimeout:()=>0,clearInterval(){},
  document:{getElementById:el,querySelectorAll:q=>q==='[data-ap-select]'?controls:[],head:{appendChild(){}}},
  window:{confirm:()=>true,addEventListener:(type,fn)=>{events[type]=fn;}},
  escapeHtml:v=>String(v),showToast:v=>{sandbox.toast=v;},getUniverseUserId:()=> 'U001',currentRoute:'appearance-tool',YT:{PlayerState:{PLAYING:1,ENDED:0}},result:null
 };
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'AppearanceScripts.html'),'utf8').replace(/^<script>/,'').replace(/<\/script>\s*$/,''),sandbox);
 const s=vm.runInContext('appearanceToolState',sandbox);s.catalog={members:names.map((name,i)=>({memberId:String(101+i),name}))};
 s.video={videoId:'a',youtubeVideoId:'abcdefghijk',title:'test',publishedAt:'2026-01-01',durationMs:900000,resumePositionMs:0,revision:0,status:'in_progress'};
 s.ready=true;s.player={getCurrentTime:()=>sandbox.time,getDuration:()=>900,getPlayerState:()=>sandbox.playState,pauseVideo:()=>{sandbox.playState=2;},seekTo:t=>{sandbox.time=t;}};sandbox.time=300;sandbox.playState=2;
 return {api:sandbox,s,el,events};
}
test('selection uses player time, blocks saving pending interval and confirms precise seek position',()=>{
 const {api,s,el}=client();api.appearanceSelect('101');assert.equal(s.open.startMs,300000);assert.equal(el('apSave').disabled,true);
 api.time=480;api.appearanceConfirmSegment(false);assert.deepEqual(plain(s.segments),[{startMs:300000,endMs:480000,memberIds:'101'}]);assert.equal(el('apSave').disabled,false);
 api.appearanceUndo();assert.equal(s.segments.length,0);api.time=300;api.appearanceSelect('101');api.time=473;api.appearanceConfirmSegment(false);assert.equal(s.segments[0].endMs-s.segments[0].startMs,173000);
});
test('NONE is exclusive, ALL selects six, unselected replay adds no segments, reverse interval is rejected',()=>{
 const {api,s}=client();api.appearanceSelect('ALL');assert.equal(s.selected.length,6);api.appearanceSelect('NONE');assert.deepEqual(plain(s.selected),['NONE']);api.appearanceSelect('102');assert.deepEqual(plain(s.selected),['102']);
 api.time=299;api.appearanceConfirmSegment(false);assert.equal(s.segments.length,0);assert.match(s.error,/開始/);
 api.time=350;api.appearanceConfirmSegment(false);api.time=400;api.appearanceConfirmSegment(false);assert.equal(s.segments.length,1);
});
test('playing blocks performer changes and ended interval confirms without server saving',()=>{
 const {api,s}=client();api.playState=1;api.appearanceSelect('101');assert.equal(s.open,null);api.playState=2;api.appearanceSelect('101');api.time=900;api.appearanceConfirmSegment(true);assert.equal(s.segments[0].endMs,900000);assert.equal(s.video.revision,0);assert.equal(s.video.status,'in_progress');assert.equal(s.dirty,true);
});
test('overlap edit proposes boundary changes and applies only after confirmation; undo restores source intervals',()=>{
 const {api,s,el}=client();s.segments=[{startMs:0,endMs:100000,memberIds:'101'},{startMs:100000,endMs:200000,memberIds:'102'}];
 el('apSegmentStart').value='0';el('apSegmentEnd').value='150000';api.document.querySelectorAll=q=>q==='[data-ap-edit-member]:checked'?[{value:'103'}]:[];
 api.window.confirm=()=>false;api.appearanceApplySegment(0);assert.equal(s.segments[0].endMs,100000);
 api.window.confirm=()=>true;api.appearanceApplySegment(0);assert.deepEqual(plain(s.segments),[{startMs:0,endMs:150000,memberIds:'103'},{startMs:150000,endMs:200000,memberIds:'102'}]);api.appearanceUndo();assert.equal(s.segments[0].endMs,100000);
});
test('lost save response is reconciled against the captured payload without blind resend',async()=>{
 const {api,s}=client();s.segments=[{startMs:0,endMs:100000,memberIds:'101'}];s.attempt=plain(api.appearanceSavePayload_());s.uncertain=true;s.dirty=true;api.time=305;
 let calls=0;api.appearanceCall_=async method=>{assert.equal(method,'getVideoAnalysis');calls++;return {video:{...s.video,resumePositionMs:s.attempt.resumePositionMs,revision:1},segments:plain(s.segments)};};
 await api.appearanceReconcile();assert.equal(calls,1);assert.equal(s.uncertain,false);assert.equal(s.dirty,false);assert.equal(s.video.revision,1);
});
test('internal navigation, tab close, segment drafts and busy state guard unsaved work',()=>{
 const {api,s,events}=client();api.window.confirm=()=>false;s.segmentDirty=true;assert.equal(api.appearanceCanLeave_(),false);
 let warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true);
 s.segmentDirty=false;s.busy=true;assert.equal(api.appearanceCanLeave_(),false);s.busy=false;assert.equal(api.appearanceCanLeave_(),true);
});
test('route, analysis entry and includes wire into canonical owners without changing deploy triggers',()=>{
 const read=f=>fs.readFileSync(path.join(root,f),'utf8');
 assert.match(read('Router.html'),/appearanceCanLeave_/);assert.match(read('Router.html'),/initAppearanceTool\(\)/);assert.match(read('Settings.html'),/function openAppearanceTool/);
 assert.match(read('AppOverlays.html'),/openAppearanceTool\(\)/);assert.match(read('AnalysisScripts.html'),/appearanceRenderAnalysis\(\)/);
 for(const name of ['AppearanceStyles','AppearancePage','AppearanceScripts','AppearanceAnalysis'])assert.match(read('Index.html'),new RegExp("include\\('"+name+"'\\)"));
});


test('buffering cannot start a measurement and unresolved saves freeze every segment mutation',()=>{
 const {api,s,el}=client();api.playState=3;api.appearanceSelect('101');assert.equal(s.open,null);
 s.segments=[{startMs:0,endMs:100000,memberIds:'101'}];s.undo=[];s.uncertain=true;api.appearanceUndo();assert.equal(s.segments.length,1);
 api.appearanceRemoveSegment(0);assert.equal(s.segments.length,1);
 el('apSegmentStart').value='0';el('apSegmentEnd').value='120000';api.document.querySelectorAll=q=>q==='[data-ap-edit-member]:checked'?[{value:'102'}]:[];
 api.appearanceApplySegment(0);assert.equal(s.segments[0].endMs,100000);
});

test('invalid player position does not leave a selected performer without an open interval',()=>{
 const {api,s}=client();api.time=NaN;api.appearanceSelect('101');assert.deepEqual(plain(s.selected),[]);assert.equal(s.open,null);
});

test('late legacy analysis bootstrap cannot reset the appearance filters',()=>{
 const elements={analysisPanel:{innerHTML:'',isConnected:true}};let success;
 const api={document:{getElementById:id=>elements[id]},google:{script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getAnalysisBootstrap(){}}}},currentRoute:'analysis',renderUniverseLoading:()=>'',escapeHtml:String,window:{__analysisCanonicalRuntimeState:{}},result:null};
 vm.createContext(api);vm.runInContext(fs.readFileSync(path.join(root,'AnalysisScripts.html'),'utf8').replace(/^<script>/,'').replace(/<\/script>\s*$/,''),api);
 api.initAnalysisPage();vm.runInContext("analysisView='appearance';",api);let renders=0;api.renderAnalysisView=()=>{renders++;};success({});assert.equal(renders,0);
 api.currentRoute='home';vm.runInContext("analysisView='top';",api);success({});assert.equal(renders,0);
});

test('all client scripts compile together in the actual Index include order',()=>{
 const index=fs.readFileSync(path.join(root,'Index.html'),'utf8');
 const includes=[...index.matchAll(/include\('([^']+)'\)/g)].map(m=>m[1]+'.html');
 const scripts=includes.flatMap(file=>[...fs.readFileSync(path.join(root,file),'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]));
 assert.doesNotThrow(()=>new vm.Script(scripts.join('\n;\n')));
});
