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

test('existing site modules filter archived songs from selectable catalogs',()=>{
  assert.match(read('CoreRepository.gs'),/RecordStatus \|\| 'ACTIVE'/);
  assert.match(read('CoverApi.gs'),/RecordStatus\|\|'ACTIVE'/);
  assert.match(read('PerformanceTimerApi.gs'),/RecordStatus\|\|'ACTIVE'/);
});

test('production library remains version-pinned and feature-flagged',()=>{
  const manifest=JSON.parse(read('appsscript.json'));
  const library=manifest.dependencies.libraries.find(x=>x.userSymbol==='BMSGDB');
  assert.equal(library.developmentMode,false);
  assert.equal(library.version,'14');
  assert.match(read('CatalogManagementEntry.html'),/button\.hidden=true/);
});
