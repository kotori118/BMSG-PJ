// Expected-correctness tests for release audit. Failing assertions are release blockers.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {fixture} from './management-fixture.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('switching member target can be cancelled without discarding a draft',async()=>{
  const f=fixture();
  f.data.getCatalogManagementBootstrap.members.push({MemberID:'102',GroupID:'1',DisplayName:'SHUNTO',ColorHex:'#0000ff'});
  await f.go('members','edit');
  f.run("document.getElementById('cmEditMember').value='101';document.getElementById('cmEditMember').onchange();document.getElementById('cmEditMemberName').value='Unsaved name';managementState.dirty=true");
  let asked=0;f.ctx.window.confirm=()=>{asked++;return false;};
  f.run("document.getElementById('cmEditMember').value='102';document.getElementById('cmEditMember').onchange()");
  try{assert.equal(asked,1,'Target switch must confirm discarding');assert.equal(f.dom.window.document.getElementById('cmEditMemberName').value,'Unsaved name');}finally{f.dom.window.close();}
});

test('editing an existing song can return to the song selector',async()=>{
  const f=fixture();await f.go('songs','edit');f.run("openSlmExistingSong_('1001')");await f.settle();
  try{
    const doc=f.dom.window.document;
    assert.ok([...doc.querySelectorAll('button')].some(el=>/backSlmExistingSelect/.test(el.getAttribute('onclick')||'')),'No visible song-select return action');
  }finally{f.dom.window.close();}
});

test('a lyricless registration confirmation can return to correct its song information',async()=>{
  const f=fixture();await f.go('songs','add');
  f.run("document.getElementById('slmNewArtist').value='BE:FIRST';document.getElementById('slmNewTitle').value='Test';document.getElementById('slmIncludeLyrics').checked=false;nextSlmNewSong();nextSlmNewCredits()");
  try{assert.ok(f.dom.window.document.querySelector('#slmBody button[onclick="slmPrevNewStep()"]'),'No back action in lyricless final step');}finally{f.dom.window.close();}
});

test('guest registration has a busy guard when the confirmation button is pressed twice',async()=>{
  const f=fixture();await f.go('songs','add');
  f.run("songLyricsManagementState.unknownQueue=['Guest X'];openNextSlmGuestConfirm_();confirmSlmGuestRegistration();confirmSlmGuestRegistration()");
  const count=f.calls.filter(x=>x.key==='registerSongLyricsGuest').length;
  await f.settle();
  try{assert.equal(count,1,'Guest request sent twice while saving');}finally{f.dom.window.close();}
});

test('song classification draft survives saving basic information',async()=>{
  const f=fixture();await f.go('songs','edit');f.run("openSlmExistingSong_('1001')");await f.settle();
  f.run("document.getElementById('slmEditSongType').value='SOLO';document.getElementById('slmEditSongType').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('slmEditSoloMember').value='101';document.getElementById('slmEditSoloMember').dispatchEvent(new Event('change',{bubbles:true}));saveSlmExistingInfo()");await f.settle();
  try{assert.equal(f.dom.window.document.getElementById('slmEditSongType').value,'SOLO','Unsaved classification was lost on reload');}finally{f.dom.window.close();}
});

test('missing live-schema shows a safe migration-required state without crashing edit screens',async()=>{
  const f=fixture();await f.go('members','edit');
  f.run("cmState.bootstrap.schema={ready:false,missing:['02_Members.RecordStatus']}");
  try{assert.doesNotThrow(()=>f.run('cmRender_()'));}finally{f.dom.window.close();}
});

test('new GROUP can be selected in the card and cover feature group lists',()=>{
  const env={asId_:x=>String(x??''),asBoolean_:x=>x===true,normalizeHex_:x=>x};
  vm.createContext(env);vm.runInContext(read('CardApi.gs')+'\n'+read('CoverApi.gs'),env);
  const groups=[{GroupID:'7',GroupName:'NEW GROUP',GroupKind:'GROUP',ColorHex:'#abcdef',DisplayOrder:7}];
  const members=[{MemberID:'501',GroupID:'7',DisplayName:'New member',ColorHex:'#123abc',DisplayOrder:40}];
  const links=[{GroupID:'7',MemberID:'501',DisplayOrder:1}];
  const images=[{ImageID:'2000',TargetType:'Member',TargetID:'501',Rarity:'N',DriveFileID:'synthetic-file',DisplayOrder:1}];
  const cards=env.buildCardCatalog_(groups,members,links,images);
  const covers=env.buildCoverGroups_({groups});
  assert.deepEqual({cards:cards.groups.some(x=>x.name==='NEW GROUP'),cover:covers.some(x=>x.groupName==='NEW GROUP')},{cards:true,cover:true},'New group must appear in both feature selectors');
});
