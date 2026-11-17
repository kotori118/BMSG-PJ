import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const read=f=>fs.readFileSync(path.join(import.meta.dirname,'..',f),'utf8');
function client(){
  const nodes={managementNavigation:{innerHTML:''},managementContent:{innerHTML:''}};
  const events={},history=[],toasts=[];
  const env={document:{getElementById:id=>nodes[id]||null,addEventListener:()=>{}},window:{addEventListener:(n,f)=>events[n]=f,confirm:()=>false},
    cmEscape_:x=>String(x??''),getUniverseUserId:()=> 'U001',currentRoute:'manage',
    cmState:{busy:false},songLyricsManagementState:{busy:false,dirty:{}},profileManagementState:{busy:false,dirty:false},imageManagementState:{busy:false,pendingFile:null},
    hasSlmDirty_:()=>false,resetImageManagementForm:()=>{},showToast:x=>toasts.push(x),
    google:{script:{history:{replace:s=>history.push(s)},run:{}}}};
  vm.createContext(env);vm.runInContext(read('ManagementPage.html').match(/<script>([\s\S]*)<\/script>/)[1],env);
  const run=s=>vm.runInContext(s,env);
  return{env,nodes,events,history,toasts,run};
}
test('registered users see management categories; restricted operations are omitted',()=>{
  for(const uid of ['U001','U002','U003']){
    const c=client();c.env.getUniverseUserId=()=>uid;
    c.run('managementState.access={registered:true,catalog:false};renderManagementNavigation_()');
    assert.match(c.nodes.managementContent.innerHTML,/楽曲・歌詞|メンバー・プロフィール|メンバー画像/);
    assert.doesNotMatch(c.nodes.managementContent.innerHTML,/データ点検・保守|グループ・ユニット/);
    c.run("managementState.params={section:'members'};renderManagementNavigation_()");
    assert.match(c.nodes.managementContent.innerHTML,/プロフィールを編集/);
    assert.doesNotMatch(c.nodes.managementContent.innerHTML,/メンバーを追加|プロフィール項目を管理/);
  }
});
test('admin sees maintenance last, future features remain absent',()=>{
  const c=client();c.run('managementState.access={registered:true,catalog:true};renderManagementNavigation_()');
  const html=c.nodes.managementContent.innerHTML;
  assert.ok(html.indexOf('データ点検・保守')>html.indexOf('メンバー画像'));
  assert.doesNotMatch(html,/動画|変更履歴を見る|バックアップ・移行|画像の表示設定|ゲストを管理/);
});
test('invalid or unauthorized deep links render an error without invoking an editor',()=>{
  const c=client();c.run('managementState.access={registered:true,catalog:false}');
  for(const params of [{section:'members',action:'add'},{section:'songs',action:'missing'},{section:'missing',action:'edit'},{section:'maintenance',action:'audit'}]){
    c.run('managementState.params='+JSON.stringify(params)+';renderManagementNavigation_()');
    assert.match(c.nodes.managementContent.innerHTML,/利用できません/);
  }
});
test('dirty cancellation and busy state prevent navigation; confirmation clears drafts',()=>{
  const c=client();c.run('managementState.dirty=true');
  assert.equal(c.run('managementCanLeave_()'),false);
  c.env.window.confirm=()=>true;assert.equal(c.run('managementCanLeave_()'),true);
  c.run('cmState.busy=true');assert.equal(c.run('managementCanLeave_()'),false);
  assert.equal(c.toasts.length,1);
});
test('browser history restoration includes category and action; unload protects drafts',()=>{
  const c=client();c.run("managementState.params={page:'manage',section:'members',action:'profile'};restoreManagementHistory_();managementState.dirty=true");
  assert.deepEqual(JSON.parse(JSON.stringify(c.history[0])),{page:'manage',section:'members',action:'profile'});
  let prevented=false;const event={preventDefault:()=>prevented=true};c.events.beforeunload(event);
  assert.equal(prevented,true);assert.equal(event.returnValue,'');
});
test('responses from an old mount or a switched user are ignored',()=>{
  const c=client();let success;
  c.env.google.script.run={withSuccessHandler:f=>{success=f;return{getData:()=>{}}}};
  c.run('var got=0;managementRunner_().withSuccessHandler(function(){got++}).getData()');
  success({});assert.equal(c.run('got'),1);
  c.run('managementState.epoch++');success({});assert.equal(c.run('got'),1);
  c.run('managementRunner_().withSuccessHandler(function(){got++}).getData()');
  c.env.getUniverseUserId=()=> 'U002';success({});assert.equal(c.run('got'),1);
});
test('navigation access API validates registered users and keeps catalog admin gate',()=>{
  const env={normalizeUniverseStateUserId_:id=>{if(!['U001','U002','U003'].includes(id))throw Error('user');},getCatalogManagementAccess:id=>({enabled:id==='U001'})};
  vm.createContext(env);vm.runInContext(read('ManagementPageApi.gs'),env);
  assert.throws(()=>env.getManagementPageAccess('unknown'),/user/);
  for(const uid of ['U001','U002','U003'])assert.equal(env.getManagementPageAccess(uid).registered,true);
  assert.equal(env.getManagementPageAccess('U002').catalog,false);
});
test('single registration flow supports optional lyrics and selected-song deletion',()=>{
  const ui=read('SongLyricsManagement.html');
  assert.match(ui,/slmIncludeLyrics/);assert.match(ui,/catalogManagementCreateSongDraft':'saveNewSongLyricsManagement/);
  assert.match(ui,/slmReloadAfterSave_/);assert.match(ui,/if\(dirty.lyrics\)data.parts=old.parts/);
  assert.match(read('CatalogManagement.html'),/const songId=String\(songLyricsManagementState.existingSongId/);
  assert.doesNotMatch(read('CatalogManagement.html'),/function cmSongsHtml_|function cmCreateSong_|cmRunMigration_/);
});
test('profile and image writes validate chosen registered user, retaining existing writer checks',()=>{
  assert.match(read('ProfileManagementApi.gs'),/normalizeUniverseStateUserId_\(payload.userId\)/);
  assert.match(read('ImageManagementApi.gs'),/normalizeUniverseStateUserId_\(payload.userId\)/);
  assert.match(read('ImageManagementApi.gs'),/function repairImageManagementData\(userId\)/);
});
