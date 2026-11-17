import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import {fixture} from '../audit/management-fixture.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function populate(f){
  const d=f.data.getManagementOperationsBootstrap;
  d.guests=[{GuestID:'901',DisplayName:'Old guest',revision:'guest-before'},{GuestID:'902',DisplayName:'Target guest',revision:'target-before'}];
  d.groups[1].revision='group-before';d.groups[1].DisplayOrder=2;
  d.fields=[{profileId:'P001',label:'好きな色',displayGroup:'好み',dataType:'TEXT',displayOrder:1,isMultiValue:false,isActive:true}];
  d.images=[{ImageID:'100',TargetType:'Member',TargetID:'101',Rarity:'SSR',DisplayOrder:1,IsProfileMain:true,revision:'image-before'}];
  d.backups=[{coreId:'backup-core',logId:'backup-log',createdAt:'2026-11-17'}];
  d.flags={UNIVERSE_SITE_ONLY_WRITES:false};
}
test('every new management operation is routed and unauthorized direct links are refused',async()=>{
  const f=fixture();populate(f);
  for(const [s,a] of [['songs','guests'],['groups','edit'],['members','fields'],['images','settings'],['maintenance','history'],['maintenance','backup'],['maintenance','prepare'],['maintenance','repair'],['maintenance','options']]){
    await f.go(s,a);assert.ok(f.dom.window.document.getElementById('managementOperationsHost'),`${s}/${a}`);assert.equal(f.run('managementBusy_()'),false);
    const ids=[...f.dom.window.document.querySelectorAll('[id]')].map(x=>x.id);assert.equal(ids.length,new Set(ids).size,`${s}/${a} duplicate IDs`);
  }f.dom.window.close();
  const denied=fixture({admin:false});await denied.go('songs','guests');assert.match(denied.dom.window.document.getElementById('managementContent').textContent,/利用できません/);denied.dom.window.close();
});
test('guest edits include optimistic revision, block duplicate submits and keep inputs on failure',async()=>{
  const f=fixture();populate(f);await f.go('songs','guests');
  f.data.runManagementOperation=new Error('save failed');
  f.run("document.getElementById('moTarget').value='901';moSelect_();document.getElementById('moName').value='Corrected';moSaveGuest_();moSaveGuest_()");await f.settle();
  const calls=f.calls.filter(x=>x.key==='runManagementOperation');assert.equal(calls.length,1);assert.equal(calls[0].args[0].expectedRevision,'guest-before');
  assert.equal(f.dom.window.document.getElementById('moName').value,'Corrected');assert.match(f.dom.window.document.getElementById('moError').textContent,/save failed/);f.dom.window.close();
});
test('switching an operations target with unsaved content can be cancelled',async()=>{
  const f=fixture();populate(f);await f.go('songs','guests');
  f.run("document.getElementById('moTarget').value='901';moSelect_();document.getElementById('moName').value='Unsaved';managementState.dirty=true");f.ctx.window.confirm=()=>false;
  f.run("document.getElementById('moTarget').value='902';moSelect_()");assert.equal(f.dom.window.document.getElementById('moTarget').value,'901');assert.equal(f.dom.window.document.getElementById('moName').value,'Unsaved');f.dom.window.close();
});
test('field creation reuses the existing endpoint and stays in the operations editor after reread',async()=>{
  const f=fixture();populate(f);await f.go('members','fields');
  f.run("document.getElementById('cmProfileFieldName').value='New field';cmCreateProfileField_();cmCreateProfileField_()");await f.settle();
  assert.equal(f.calls.filter(x=>x.key==='catalogManagementCreateProfileField').length,1);assert.ok(f.dom.window.document.getElementById('moTarget'));assert.equal(f.run('managementBusy_()'),false);f.dom.window.close();
});
test('image display settings and field metadata submit only their own data',async()=>{
  const f=fixture();populate(f);await f.go('images','settings');
  f.run("document.getElementById('moTarget').value='100';moSelect_();document.getElementById('moOrder').value='2';moSaveImage_()");await f.settle();
  let payload=f.calls.find(x=>x.key==='runManagementOperation').args[0];assert.equal(payload.operation,'image');assert.equal(payload.imageId,'100');assert.equal(payload.expectedRevision,'image-before');
  await f.go('members','fields');f.run("document.getElementById('moTarget').value='P001';moSelect_();document.getElementById('moName').value='色';moSaveField_()");await f.settle();
  payload=f.calls.filter(x=>x.key==='runManagementOperation').at(-1).args[0];assert.equal(payload.operation,'field');assert.equal(payload.profileId,'P001');assert.equal(payload.name,'色');f.dom.window.close();
});
test('backup and repair/restore preview are explicit; commit requires a second confirmation',async()=>{
  const f=fixture();populate(f);await f.go('maintenance','backup');
  f.ctx.window.confirm=()=>false;f.run('moBackup_()');assert.equal(f.calls.filter(x=>x.key==='runManagementOperation').length,0);
  f.ctx.window.confirm=()=>true;f.run('moBackup_()');await f.settle();assert.equal(f.calls.find(x=>x.key==='runManagementOperation').args[0].confirm,'CREATE_BACKUP');
  f.data.runManagementOperation={ok:true,backupId:'backup-core',revision:'restore-plan',counts:[{table:'Songs',currentRows:2,backupRows:1}]};
  f.run('moPreviewRestore_()');await f.settle();assert.equal(f.calls.filter(x=>x.key==='runManagementOperation').at(-1).args[0].preview,true);
  f.ctx.window.prompt=()=> 'WRONG';f.run('moConfirmRestore_()');assert.equal(f.calls.filter(x=>x.key==='runManagementOperation').length,2);
  f.ctx.window.prompt=()=> 'RESTORE_MASTER_DATA';f.run('moConfirmRestore_()');await f.settle();assert.equal(f.calls.filter(x=>x.key==='runManagementOperation').at(-1).args[0].expectedRevision,'restore-plan');f.dom.window.close();
});
test('initial setup and runtime configuration keep explicit confirmation tokens',async()=>{
  const f=fixture();populate(f);await f.go('maintenance','prepare');f.ctx.window.prompt=()=> 'PREPARE_MANAGEMENT';f.run('moPrepare_()');await f.settle();
  assert.equal(f.calls.find(x=>x.key==='runManagementOperation').args[0].operation,'prepare');
  await f.go('maintenance','options');f.ctx.window.prompt=()=> 'CONFIGURE_MANAGEMENT';f.run("document.getElementById('moFlag_UNIVERSE_SITE_ONLY_WRITES').checked=true;moSaveOptions_()");await f.settle();
  const payload=f.calls.filter(x=>x.key==='runManagementOperation').at(-1).args[0];assert.equal(payload.flags.UNIVERSE_SITE_ONLY_WRITES,true);f.dom.window.close();
});
test('server dispatcher rejects arbitrary library functions and checks admin gate',()=>{
  const calls=[];const env={catalogManagementSiteAccess_:uid=>{if(uid!=='U001')throw Error('admin');},catalogManagementCallWriter_:(fn,p)=>{calls.push(fn);return {ok:true};},catalogManagementRefreshProfileFieldCaches_:()=>{},clearUniverseImageRepairCaches_:()=>{},BMSGDB:{}};
  vm.createContext(env);vm.runInContext(read('ManagementOperationsApi.gs'),env);
  assert.throws(()=>env.runManagementOperation({userId:'U002',operation:'guest'}),/admin/);
  assert.throws(()=>env.runManagementOperation({userId:'U001',operation:'arbitraryFunction'}),/対応/);
  env.runManagementOperation({userId:'U001',operation:'guest'});assert.deepEqual(calls,['maintainCatalogGuestForUniverse']);
});
test('group data drives cards, cover and quiz; logo references are absent from runtime payloads',()=>{
  const groups=[{GroupID:'7',GroupName:'NEW GROUP',GroupKind:'GROUP',DisplayOrder:1}];
  const env={asId_:x=>String(x??''),asBoolean_:x=>x===true,normalizeHex_:x=>x,UNIVERSE_CONFIG:{SHEETS:{GROUPS:'Groups'}},readCoreSheetObjects_:()=>groups};
  vm.createContext(env);vm.runInContext(read('CardApi.gs')+'\n'+read('CoverApi.gs')+'\n'+read('QuizApi.gs'),env);
  assert.ok(env.getQuizCourses_().some(c=>c.value==='NEW GROUP'));
  const cards=env.buildCardCatalog_(groups,[],[],[{TargetType:'Brand',DriveFileID:'legacy-logo'}]);assert.doesNotMatch(JSON.stringify(cards),/logo|legacy-logo/i);
  assert.ok(env.buildCoverGroups_({groups}).some(g=>g.groupName==='NEW GROUP'));
  assert.doesNotMatch(read('PokerApi.gs')+read('PokerScripts.html'),/brandLogoDriveFileId/);
});
