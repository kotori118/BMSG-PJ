import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=f=>fs.readFileSync(path.join(import.meta.dirname,'..',f),'utf8');
function fixture({admin=true,uid='U001'}={}){
  const files=['CatalogManagement.html','SongLyricsManagement.html','ProfileManagement.html','ImageManagement.html','ManagementPage.html'];
  const html='<div id="pageContent"></div><div id="searchOverlay"></div><div id="settingsOverlay"></div><div id="toastRegion"></div>'+files.map(f=>read(f).replace(/<script>[\s\S]*?<\/script>/g,'')).join('');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/'}),ctx=dom.getInternalVMContext(),calls=[],history=[];
  const groups=[{GroupID:'1',GroupName:'BE:FIRST',GroupKind:'GROUP',ColorHex:'#123456'},{GroupID:'6',GroupName:'ShowMinorSavage',GroupKind:'UNIT',ColorHex:'#654321'}];
  const members=[{MemberID:'101',GroupID:'1',DisplayName:'SOTA',ColorHex:'#00AFCC'}];
  const song={songId:'1001',title:'Test song',artist:'BE:FIRST',releaseDate:'2026-01-01',form:'シングル',cdTitle:'',isTitleTrack:false,songType:'NORMAL',soloMemberId:''};
  const data={getManagementPageAccess:{registered:true,catalog:admin},getCatalogManagementBootstrap:{groups,members,songs:[{SongID:'1001',Title:'Test song'}],schema:{ready:true},memberships:[]},getCatalogManagementProfileFields:{ok:true,fields:[]},getSongLyricsManagementBootstrap:{artists:['BE:FIRST'],existingArtists:['BE:FIRST'],songs:[song],forms:['シングル'],singerOptions:[],soloMembers:[{value:'101',label:'SOTA'}]},getSongLyricsManagementSong:{song,credits:{},parts:[{singers:[],lyrics:'example'}]},getProfileManagementBootstrap:{groups:[{name:'BE:FIRST',members:[{memberId:'101',name:'SOTA'}]}],fields:[]},getProfileManagementMember:{values:{}},getImageManagementBootstrap:{groups:[{name:'BE:FIRST',members:[{memberId:'101',name:'SOTA'}]}]},saveNewSongLyricsManagement:{ok:true,songId:'1001'},catalogManagementCreateSongDraft:{ok:true,songId:'1001'},auditCatalogManagementDatabase:{warnings:[]}};
  let change;
  function runner(success,failure){return new Proxy({}, {get(_,key){if(key==='withSuccessHandler')return f=>runner(f,failure);if(key==='withFailureHandler')return f=>runner(success,f);return(...args)=>{calls.push({key,args});queueMicrotask(()=>{try{if(data[key] instanceof Error){failure?.(data[key]);return;}success?.(structuredClone(data[key]??{ok:true}));}catch(e){throw e;}});};}});}
  Object.assign(ctx,{getUniverseUserId:()=>uid,closeSettings:()=>{},showToast:()=>{},renderUniverseLoading:()=>'<div role="status">LOADING</div>',setPageAtmosphere:()=>{},setTheme:()=>{},setActiveNav:()=>{},scrollAppToTop:()=>{},syncCurrentFavoriteButton:()=>{},renderHome:()=>'<h1>HOME</h1>',initHomePage:()=>{},renderData:()=>'',renderLab:()=>'',resetUniverseCrossLinks:()=>{},mountUniverseSingerEditor:()=>{},google:{script:{run:runner(),history:{push:s=>history.push(s),replace:s=>history.push(s),setChangeHandler:f=>change=f},url:{getLocation:f=>f({parameter:{page:'home'}})}}}});
  ctx.window.confirm=()=>true;
  const scripts=[read('AppCore.html'),...files.map(read),read('Router.html')].flatMap(s=>Array.from(s.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]));
  vm.runInContext(scripts.join('\n'),ctx);
  const run=s=>vm.runInContext(s,ctx);
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
  const go=async(section,action)=>{run('navigateToWithParams("manage",'+JSON.stringify({section,action})+')');await settle();};
  return{dom,ctx,run,calls,data,history,go,settle,change:(p)=>change({location:{parameter:p}})};
}
test('all live operations mount exactly one full-page editor, without a management modal',async()=>{
  const f=fixture();
  for(const [s,a] of [['songs','add'],['songs','edit'],['members','add'],['members','edit'],['members','profile'],['members','fields'],['groups','add'],['groups','edit'],['groups','units'],['images','edit'],['maintenance','audit']]){
    await f.go(s,a);
    assert.equal(f.dom.window.document.querySelectorAll('#managementEditorHost > .management-editor').length,1,`${s}/${a}`);
    assert.equal(f.dom.window.document.querySelectorAll('#managementEditorHost .modal-overlay.open').length,0);
    assert.equal(f.run('managementBusy_()'),false,`${s}/${a} busy`);
  }
  f.dom.window.close();
});
test('catalog validation and failed saves preserve the entered draft; duplicate submits are blocked',async()=>{
  const f=fixture();await f.go('groups','add');
  f.run("document.getElementById('cmGroupName').value='New group';document.getElementById('cmGroupColor').value='#123456';cmCreateGroup_()");
  assert.equal(f.dom.window.document.getElementById('cmGroupName').value,'New group');
  assert.match(f.dom.window.document.getElementById('catalogManagementBody').textContent,/すでに/);
  f.data.catalogManagementCreateGroup=new Error('test failure');
  f.run("document.getElementById('cmGroupColor').value='#abcdef';cmCreateGroup_();cmCreateGroup_()");await f.settle();
  assert.equal(f.calls.filter(x=>x.key==='catalogManagementCreateGroup').length,1);
  assert.equal(f.dom.window.document.getElementById('cmGroupName').value,'New group');
  assert.match(f.dom.window.document.getElementById('catalogManagementBody').textContent,/test failure/);
  f.dom.window.close();
});
test('one song form registers lyricless songs with credits; normal lyric saves reuse the old endpoint',async()=>{
  const f=fixture();await f.go('songs','add');
  f.run("document.getElementById('slmNewArtist').value='BE:FIRST';document.getElementById('slmNewTitle').value='New';document.getElementById('slmIncludeLyrics').checked=false;nextSlmNewSong();document.getElementById('slmNewLyricists').value='Writer';nextSlmNewCredits();saveSlmNewSong();saveSlmNewSong()");await f.settle();
  const calls=f.calls.filter(x=>x.key==='catalogManagementCreateSongDraft');assert.equal(calls.length,1);assert.equal(calls[0].args[0].credits.lyricists,'Writer');assert.equal(calls[0].args[0].includeLyrics,false);
  await f.go('songs','add');f.run("songLyricsManagementState.newSong={title:'With lyrics',artist:'BE:FIRST'};songLyricsManagementState.rawLyrics='SOTA\\nExample';songLyricsManagementState.preview={parts:[{}]};saveSlmNewSong()");await f.settle();
  assert.equal(f.calls.filter(x=>x.key==='saveNewSongLyricsManagement').length,1);
  f.dom.window.close();
});
test('cancelled browser back keeps action URL and dirty form; approved navigation parks editors',async()=>{
  const f=fixture();await f.go('groups','add');
  f.run("document.getElementById('cmGroupName').value='Draft';managementState.dirty=true");f.ctx.window.confirm=()=>false;
  f.change({page:'home'});assert.equal(f.dom.window.document.getElementById('cmGroupName').value,'Draft');assert.equal(f.history.at(-1).section,'groups');
  f.ctx.window.confirm=()=>true;f.change({page:'home'});assert.match(f.dom.window.document.getElementById('pageContent').textContent,/HOME/);
  assert.equal(f.dom.window.document.querySelectorAll('#managementEditorStore > .management-editor').length,4);
  f.dom.window.close();
});
test('saving one song section reloads server data and retains unsaved lyrics and credits',async()=>{
  const f=fixture();await f.go('songs','edit');f.run("openSlmExistingSong_('1001')");await f.settle();
  f.run("document.getElementById('slmEditTitle').value='Changed title';songLyricsManagementState.existing.parts[0].lyrics='Draft lyric';songLyricsManagementState.dirty.lyrics=true;document.getElementById('slmEditLyricists').value='Draft writer';songLyricsManagementState.dirty.credits=true;saveSlmExistingInfo();saveSlmExistingInfo()");await f.settle();
  assert.equal(f.calls.filter(x=>x.key==='saveSongLyricsManagementInfo').length,1);
  assert.equal(f.dom.window.document.getElementById('slmEditLyricists').value,'Draft writer');
  assert.equal(f.run('songLyricsManagementState.existing.parts[0].lyrics'),'Draft lyric');
  assert.equal(f.run('managementDirty_()'),true);
  f.dom.window.close();
});
test('profile value save is submitted once, then reloaded without recursive requests',async()=>{
  const f=fixture();f.data.getProfileManagementBootstrap.fields=[{profileId:'P001',label:'好きな色',dataType:'TEXT',displayGroup:'基本'}];f.data.getProfileManagementMember={values:{P001:'Before'}};
  await f.go('members','profile');f.run("document.getElementById('profileManagementGroup').value='BE:FIRST';changeProfileManagementGroup();document.getElementById('profileManagementMember').value='101';changeProfileManagementMember()");await f.settle();
  f.run("profileManagementState.values.P001='After';markProfileManagementDirty_();submitProfileManagement();submitProfileManagement()");await f.settle();
  assert.equal(f.calls.filter(x=>x.key==='saveProfileManagementMember').length,1);
  assert.equal(f.calls.filter(x=>x.key==='getProfileManagementMember').length,2);
  assert.equal(f.run('profileManagementState.busy'),false);
  assert.equal(f.dom.window.document.getElementById('profileManagementGroup').disabled,false);
  f.dom.window.close();
});
test('member target selection synchronizes maintenance and deletion target, hiding deletion until selected',async()=>{
  const f=fixture();await f.go('members','edit');
  assert.equal(f.dom.window.document.getElementById('cmDeleteMember').closest('section').hidden,true);
  f.run("const select=document.getElementById('cmEditMember');select.value='101';select.onchange()");
  assert.equal(f.dom.window.document.getElementById('cmDeleteMember').value,'101');
  assert.equal(f.dom.window.document.getElementById('cmMaintenanceMember').value,'101');
  assert.equal(f.dom.window.document.getElementById('cmEditMemberName').value,'SOTA');
  f.dom.window.close();
});
test('image uploads remain available without catalog-admin access and reject a second submit',async()=>{
  const f=fixture({admin:false});f.data.getImageManagementStatus={hasImage:false};await f.go('images','edit');
  f.run("document.getElementById('imageManagementGroup').value='BE:FIRST';changeImageManagementGroup();document.getElementById('imageManagementMember').value='101';document.getElementById('imageManagementRarity').value='N';imageManagementState.pendingFile={name:'sample.png',type:'image/png'};readImageManagementFile_=function(file,success){success('TEST_BASE64')};submitImageManagement();submitImageManagement()");await f.settle();
  const saves=f.calls.filter(x=>x.key==='saveImageManagementImage');assert.equal(saves.length,1);assert.equal(saves[0].args[0].userId,'U001');
  assert.equal(f.run('imageManagementState.pendingFile'),null);assert.equal(f.run('imageManagementState.busy'),false);
  f.dom.window.close();
});
