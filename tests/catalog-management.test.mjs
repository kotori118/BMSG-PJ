import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
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
