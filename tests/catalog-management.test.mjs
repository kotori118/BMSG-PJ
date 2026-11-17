import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('catalog UI is isolated and registered once',()=>{
  const index=read('Index.html');
  assert.equal(index.split("include('CatalogManagement');").length-1,1);
  assert.equal(index.split("include('CatalogManagementEntry');").length-1,1);
  assert.match(read('Settings.html'),/refreshCatalogManagementSettingsAccess/);
});

test('site calls BMSG-DB library and does not write Core spreadsheets',()=>{
  const src=read('CatalogManagementApi.gs');
  assert.match(src,/BMSGDB\[name\]\(payload\)/);
  assert.doesNotMatch(src,/SpreadsheetApp\.openById/);
  assert.doesNotMatch(src, /\.setValue\(|\.setValues\(/);
  assert.match(src,/UNIVERSE_CATALOG_ENABLED/);
  assert.match(src,/UNIVERSE_CATALOG_ADMIN_EMAILS/);
  assert.match(src,/Session\.getActiveUser\(\)\.getEmail\(\)/);
});

test('song deletion uses guarded server preview and no archive/restore UI',()=>{
  const api=read('CatalogManagementApi.gs');
  const ui=read('CatalogManagement.html');
  assert.match(api,/getCatalogSongDeletePreviewForUniverse/);
  assert.match(api,/deleteCatalogSongForUniverse/);
  assert.match(ui,/getCatalogManagementDeletePreview/);
  assert.match(ui,/catalogManagementDeleteSong/);
  assert.match(ui,/externalReferencesChecked:true/);
  assert.doesNotMatch(api,/setCatalogSongArchiveForUniverse/);
  assert.doesNotMatch(ui,/cmToggleSongArchive_|アーカイブ・復元|SongIDは維持されます/);
});
test('normal song reads do not rely on an archived RecordStatus column',()=>{
  assert.doesNotMatch(read('CoreRepository.gs'),/RecordStatus \|\| 'ACTIVE'/);
  assert.doesNotMatch(read('CoverApi.gs'),/RecordStatus\|\|'ACTIVE'/);
  assert.doesNotMatch(read('PerformanceTimerApi.gs'),/RecordStatus\|\|'ACTIVE'/);
});

test('production library remains version-pinned and feature-flagged',()=>{
  const manifest=JSON.parse(read('appsscript.json'));
  const library=manifest.dependencies.libraries.find(x=>x.userSymbol==='BMSGDB');
  assert.equal(library.developmentMode,false);
  assert.equal(library.version,'14');
  assert.match(read('CatalogManagementEntry.html'),/button\.hidden=true/);
});

test('PartTransfers analysis is absent but singing/center metrics and timer remain',()=>{
  const api=read('AnalysisApi.gs'),ui=read('AnalysisScripts.html'),cfg=read('Config.gs');
  const timer=read('PerformanceTimerApi.gs'),router=read('Router.html'),index=read('Index.html');
  assert.doesNotMatch(api,/PART_TRANSFERS|transfersRows|buildAnalysisPartTransfer_|partTransferData/);
  assert.doesNotMatch(ui,/パート継承分析|renderOtherTransfer|renderTransferSongs|partTransferData/);
  assert.doesNotMatch(cfg,/PART_TRANSFERS/);
  assert.match(api,/readAnalysisMetrics_\(spreadsheet\)/);
  assert.match(api,/singTotal|centerTotal/);
  assert.match(ui,/歌唱割合推移|センター割合推移/);
  assert.match(timer,/function savePerformanceTimer\(/);
  assert.match(router,/renderPerformanceTimer\(/);
  assert.match(index,/include\('PerformanceTimerScripts'\)/);
  assert.match(cfg,/PERFORMANCE_METRICS: '10_PerformanceMetrics'/);
});

test('profile-field screen and server wrappers are admin-gated and isolated',()=>{
  const ui=read('CatalogManagement.html');
  const api=read('CatalogManagementApi.gs');
  assert.match(ui,/プロフィール項目/);
  assert.match(ui,/cmProfileFieldsHtml_/);
  assert.match(ui,/cmCreateProfileField_/);
  assert.match(ui,/cmSetProfileFieldActive_/);
  assert.match(ui,/cmShowProfileField_/);
  assert.match(ui,/getCatalogManagementProfileFields/);
  assert.match(ui,/expectedActive:field\.isActive/);
  assert.match(api,/function getCatalogManagementProfileFields\(userId\)/);
  assert.match(api,/catalogManagementSiteAccess_\(userId\)/);
  assert.match(api,/BMSGDB\.getCatalogProfileFieldsForUniverse/);
  assert.match(api,/createCatalogProfileFieldForUniverse/);
  assert.match(api,/setCatalogProfileFieldActiveForUniverse/);
  assert.match(api,/catalogManagementRefreshProfileFieldCaches_/);
  assert.doesNotMatch(api,/SpreadsheetApp\.openById/);
});
test('new management panel JavaScript parses and keeps existing management handlers',()=>{
  const ui=read('CatalogManagement.html');
  const match=ui.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match,'inline management JS missing');
  assert.doesNotThrow(()=>new vm.Script(match[1]));
  for(const symbol of ['cmDeleteSong_','cmAddUnitMember_','cmCreateSong_','cmSaveSongClass_','cmGroupsHtml_']){
    assert.match(ui,new RegExp('function '+symbol+'\\('));
  }
  assert.match(ui,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('color collision checks run for every catalog create/update and explain the conflict',()=>{
  const ui=read('CatalogManagement.html');
  const api=read('CatalogManagementApi.gs');
  assert.match(ui,/function cmColorAvailable_\(/);
  assert.match(ui,/String\(x\.hex\|\|''\)\.toUpperCase\(\)===normalized/);
  assert.match(ui,/cmColorAvailable_\(color,'GROUP',''\)/);
  assert.match(ui,/cmColorAvailable_\(color,'GROUP',id\)/);
  assert.match(ui,/cmColorAvailable_\(color,'MEMBER',''\)/);
  assert.match(ui,/cmColorAvailable_\(color,'MEMBER',id\)/);
  assert.match(api,/catalogManagementCreateMember/);
});
test('member maintenance is gated by the shared Writer and UI does not write Sheets',()=>{
  const ui=read('CatalogManagement.html'),api=read('CatalogManagementApi.gs');
  for(const fn of ['cmMoveMember_','cmChangePrimaryGroup_','cmDeleteMember_']){
    assert.match(ui,new RegExp('function '+fn+'\\('));
  }
  for(const fn of ['catalogManagementMoveMemberOrder','catalogManagementChangePrimaryGroup','catalogManagementDeleteMember']){
    assert.match(api,new RegExp('function '+fn+'\\('));
  }
  assert.match(api,/getCatalogMemberDeletePreviewForUniverse/);
  assert.match(ui,/externalReferencesChecked:true/);
  assert.doesNotMatch(ui,/SpreadsheetApp/);
});
test('explicit main group is respected for a 5xx legacy member in profile editor',()=>{
  const source=read('ProfileManagementApi.gs');
  const fn=source.slice(source.indexOf('function profileMgmtCategoryForMember_('),
    source.indexOf('function profileMgmtReadObjects_('));
  const context={
    PROFILE_MGMT_GROUPS_:['BE:FIRST','MAZZEL','STARGLOW','HANA','BMSG POSSE'],
    asId_:(v)=>String(v??'')
  };
  vm.createContext(context);
  vm.runInContext(fn,context);
  assert.equal(vm.runInContext("profileMgmtCategoryForMember_('501','1',{'1':'BE:FIRST'})",context),'BE:FIRST');
  assert.equal(vm.runInContext("profileMgmtCategoryForMember_('501','',{})",context),'BMSG POSSE');
});
