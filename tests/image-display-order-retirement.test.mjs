import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const src = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const ids = (x) => x == null ? '' : String(x).trim();
const number = (x, fallback) => x == null || x === '' || !Number.isFinite(Number(x)) ? fallback : Number(x);
const bool = (x) => x === true || String(x).toUpperCase() === 'TRUE';
const members = [
  {MemberID:'101', GroupID:'1', DisplayName:'SOTA', ColorHex:'#00AFCC', DisplayOrder:1},
  {MemberID:'102', GroupID:'1', DisplayName:'SHUNTO', ColorHex:'#999999', DisplayOrder:2}
];
const groups = [{GroupID:'1', GroupName:'BE:FIRST', ColorHex:'#0000FF', DisplayOrder:1}];
const memberships = [{GroupID:'1',MemberID:'101',DisplayOrder:1},{GroupID:'1',MemberID:'102',DisplayOrder:2}];
const ranks = ['SSR','SR','R','N'];
const images = members.flatMap((m, i) => ranks.map((rarity, ri) => ({
  ImageID:String(i*4+ri+1), TargetType:'Member', TargetID:m.MemberID, Rarity:rarity,
  DriveFileID:'file_'+m.MemberID+'_'+rarity, IsProfileMain:rarity==='SSR'
})));
const context = (names, extras={}) => {
  const env={asId_:ids,asNumber_:number,asBoolean_:bool,...extras};
  vm.createContext(env);
  for(const file of names)vm.runInContext(src(file),env,{filename:file});
  return env;
};
test('card catalog accepts 09_Images without DisplayOrder and retains member/rarity ordering',()=>{
  const env=context(['CardApi.gs']);
  const model=env.buildCardCatalog_(groups,members,memberships,images);
  assert.deepEqual(Array.from(model.cards, c=>c.imageId), ['4','3','2','1','8','7','6','5']);
  assert.deepEqual(Array.from(model.cards, c=>c.displayOrder), [4,3,2,1,8,7,6,5]);
  assert.equal(model.cards[0].memberId,'101');
  assert.equal(model.cards.length,8);
  assert.equal(model.groups.find(g=>g.name==='BE:FIRST').memberIds.length,2);
});
test('profile selects exactly the same designated member image without 09_Images.DisplayOrder',()=>{
  const table={Groups:groups,Members:members,GroupMembers:memberships,Images:images};
  const env=context(['ProfileApi.gs'],{
    UNIVERSE_CONFIG:{SHEETS:{GROUPS:'Groups',MEMBERS:'Members',GROUP_MEMBERS:'GroupMembers',IMAGES:'Images'}},
    getCoreSpreadsheet_:()=>({}),
    readCoreSheetObjectsFromSpreadsheet_:(_,key)=>table[key]
  });
  const out=env.buildProfileMembersPayload_();
  assert.equal(out.counts.members,2);
  for(const member of out.members){
    assert.match(member.imageUrl,new RegExp('file_'+member.memberId+'_SSR'));
    assert.match(member.imageFallbackUrl,new RegExp('file_'+member.memberId+'_SSR'));
  }
  const other=images.map(r=>({...r,IsProfileMain:false}));
  other.find(r=>r.TargetID==='101'&&r.Rarity==='R').IsProfileMain=true;
  table.Images=other;
  const out2=env.buildProfileMembersPayload_();
  assert.match(out2.members.find(m=>m.memberId==='101').imageUrl,/file_101_R=/);
  assert.match(out2.members.find(m=>m.memberId==='102').imageUrl,/file_102_SSR=/);
});
test('image management accepts the six-column Image table and does not require DisplayOrder',()=>{
  const header=['ImageID','TargetType','TargetID','Rarity','DriveFileID','IsProfileMain'];
  const values=[header,...images.filter(r=>r.TargetID==='101').map(r=>[r.ImageID,r.TargetType,r.TargetID,r.Rarity,r.DriveFileID,r.IsProfileMain])];
  const sheet={getDataRange:()=>({getValues:()=>values}),getMaxRows:()=>100};
  const env=context(['ImageManagementApi.gs'],{
    UNIVERSE_CONFIG:{SHEETS:{IMAGES:'Images'}},
    SpreadsheetApp:{flush(){}}
  });
  const core={getSheetByName:()=>sheet};
  assert.doesNotThrow(()=>env.imageMgmtEnsureMemberRows_(core,'101'));
  const found=env.imageMgmtFindImageRow_(core,'101','SSR');
  assert.equal(found.record.ImageID,'1');
});
test('image management generates missing rarities in the six-column sheet',()=>{
  const values=[['ImageID','TargetType','TargetID','Rarity','DriveFileID','IsProfileMain'],
    ['4','Member','101','SSR','file_101_SSR',true]];
  const reservations=[];
  const sheet={
    getDataRange:()=>({getValues:()=>values}),
    getMaxRows:()=>100,
    getRange:(row,col,rows=1,cols=1)=>({
      copyTo(){},
      setValues(data){
        for(let i=0;i<data.length;i++) values[row-1+i]=Array.from(data[i]);
      }
    })
  };
  const env=context(['ImageManagementApi.gs'],{
    UNIVERSE_CONFIG:{SHEETS:{IMAGES:'Images'}},
    SpreadsheetApp:{flush(){},CopyPasteType:{PASTE_FORMAT:'fmt',PASTE_DATA_VALIDATION:'val'}},
    reserveUniverseId_:(kind,scope,maxNum)=>{
      const num=Math.max(maxNum,Number(reservations.at(-1)?.numericValue)||0)+1;
      const reservation={issuedId:String(num),numericValue:num,requestId:'test_'+num};
      reservations.push(reservation);
      return reservation;
    },
    finalizeUniverseIdReservation_:(r,commit)=>assert.equal(commit,true)
  });
  env.imageMgmtEnsureMemberRows_({getSheetByName:()=>sheet},'101');
  assert.equal(reservations.length,3);
  assert.equal(values.length,5);
  assert.deepEqual(Array.from(values.slice(2), r=>r.length),[6,6,6]);
  assert.deepEqual(Array.from(values.slice(2), r=>r[3]),['SR','R','N']);
  assert.equal(values[2][5],false);
  assert.equal(values[4][5],false);
});
test('no image parser/writer reads or writes the removed Image DisplayOrder column',()=>{
  for(const name of ['CardApi.gs','ImageManagementApi.gs','ProfileApi.gs']){
    const code=src(name);
    assert.doesNotMatch(code,/row\.DisplayOrder\s*\|\|\s*9999/);
    assert.doesNotMatch(code,/image\.DisplayOrder/);
    assert.doesNotMatch(code,/table\.map\.DisplayOrder/);
  }
});
