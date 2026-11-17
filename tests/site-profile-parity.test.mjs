import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(path.join(import.meta.dirname,'..','ProfileManagementApi.gs'),'utf8');
function fixture({failOnColumn=0}={}){
  const data={
    Groups:[['GroupID','GroupName'],['1','BE:FIRST']],
    Members:[['MemberID','GroupID','DisplayName','DisplayOrder'],['101','1','SOTA',1]],
    Profiles:[['MemberID','P000','P001','P002'],['101',1,'Before','Must stay hidden']],
    Settings:[['ProfileID','FieldName','DataType','IsMultiValue','DisplayGroup','IsCompareTarget','DisplayOrder','IsActive'],
      ['P000','呼ばれ順','NUMBER',false,'基本',false,0,true],
      ['P001','好きな色','TEXT',false,'基本',false,1,true],
      ['P002','非表示の過去値','TEXT',false,'基本',false,2,false]]
  };
  const errors=[],cache=[];
  const getSheet=(name)=>({
    getLastRow:()=>data[name].length,
    getLastColumn:()=>data[name][0].length,
    getRange:(row,col,rows=1,cols=1)=>({
      getValues:()=>Array.from({length:rows},(_,i)=>
        (data[name][row-1+i]||[]).slice(col-1,col-1+cols)),
      getDisplayValues:()=>Array.from({length:rows},(_,i)=>
        (data[name][row-1+i]||[]).slice(col-1,col-1+cols).map(v=>String(v??''))),
      getValue:()=>data[name][row-1]?.[col-1],
      setValue:(value)=>{
        if(col===failOnColumn)throw new Error('simulated write failure');
        data[name][row-1][col-1]=value;
      }
    })
  });
  const core={getSheetByName:(name)=>getSheet(name)},log={getSheetByName:()=>{throw new Error('ProfileSettings must live in Core');}};
  let locks=0,unlocks=0;
  const env={
    UNIVERSE_CONFIG:{USER_IDS:['U001','U002','U003'],CORE_DB_ID:'core',LOG_DB_ID:'log',SHEETS:{
      MEMBERS:'Members',GROUPS:'Groups',PROFILES:'Profiles',PROFILE_SETTINGS:'Settings'}},
    SpreadsheetApp:{openById:(id)=>id==='core'?core:log,flush:()=>{}},
    LockService:{getScriptLock:()=>({waitLock:()=>{locks++},releaseLock:()=>{unlocks++}})},
    asId_:(x)=>String(x??'').trim(),
    asNumber_:(x,def)=>Number.isFinite(Number(x))?Number(x):def,
    asBoolean_:(x)=>x===true||String(x).toUpperCase()==='TRUE'||String(x)==='1',
    clearUniverseProfileMutationCaches_:(id)=>cache.push(id),
    Utilities:{formatDate:()=>''},
    Session:{getScriptTimeZone:()=> 'Asia/Tokyo'}
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname,'..','UserStateApi.gs'),'utf8'),env);
  vm.runInContext(source,env);
  const call=(fn,p)=>vm.runInContext(fn+'('+JSON.stringify(p)+')',env);
  return{data,call,cache,errors,lockState:()=>({locks,unlocks})};
}
test('profile editor loads only active fields without old input sheet',()=>{
  const x=fixture(),boot=x.call('getProfileManagementBootstrap',undefined);
  assert.equal(boot.fields.length,2);
  assert.deepEqual(Array.from(boot.fields.map(f=>f.profileId)),['P000','P001']);
  const member=x.call('getProfileManagementMember','101');
  assert.equal(member.values.P000,'1');
  assert.equal(member.values.P001,'Before');
  assert.equal(member.values.P002,undefined);
  assert.equal(Object.hasOwn(x.data,'入力_プロフィール'),false);
});
test('saving editable values retains hidden profile field and matches member id',()=>{
  const x=fixture();
  const result=x.call('saveProfileManagementMember',{userId:'U001',memberId:'101',groupName:'BE:FIRST',
    values:{P000:'1',P001:'New color'}});
  assert.equal(result.ok,true);
  assert.equal(x.data.Profiles[1][2],'New color');
  assert.equal(x.data.Profiles[1][3],'Must stay hidden');
  assert.deepEqual(x.cache,['101']);
  assert.deepEqual(x.lockState(),{locks:1,unlocks:1});
});
test('profile editor rejects invalid member/group pairs and bad numeric inputs',()=>{
  const x=fixture();
  const before=JSON.stringify(x.data);
  assert.throws(()=>x.call('saveProfileManagementMember',{userId:'U001',memberId:'101',groupName:'HANA',
    values:{P000:'1',P001:'New'}}),/組み合わせ/);
  assert.throws(()=>x.call('saveProfileManagementMember',{userId:'U001',memberId:'101',groupName:'BE:FIRST',
    values:{P000:'not-a-number',P001:'New'}}),/数値/);
  assert.equal(JSON.stringify(x.data),before);
  assert.equal(x.lockState().locks,x.lockState().unlocks);
});
test('write failure rolls back previous profile cell changes',()=>{
  const x=fixture({failOnColumn:3});
  const before=JSON.stringify(x.data);
  assert.throws(()=>x.call('saveProfileManagementMember',{userId:'U001',memberId:'101',groupName:'BE:FIRST',
    values:{P000:'5',P001:'Updated'}}),/simulated write failure/);
  assert.equal(JSON.stringify(x.data),before);
  assert.deepEqual(x.lockState(),{locks:1,unlocks:1});
});
test('new ProfileSettings fields appear in site bootstrap and value saving without old tab',()=>{
  const x=fixture();
  x.data.Profiles[0].push('P016');
  x.data.Profiles[1].push('');
  x.data.Settings.push(['P016','好きな映画','TEXT',false,'好み',false,16,true]);
  const boot=x.call('getProfileManagementBootstrap',undefined);
  assert.equal(boot.fields.find(f=>f.profileId==='P016')?.label,'好きな映画');
  const saved=x.call('saveProfileManagementMember',{userId:'U001',memberId:'101',groupName:'BE:FIRST',
    values:{P000:'1',P001:'Before',P016:'Test film'}});
  assert.equal(saved.ok,true);
  assert.equal(x.data.Profiles[1][4],'Test film');
});
