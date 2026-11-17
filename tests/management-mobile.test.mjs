import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {fixture} from '../audit/management-fixture.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('management access explains the current gate without exposing emails or granting writes',()=>{
 const props={},env={UNIVERSE_CONFIG:{USER_IDS:['U001']},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},Session:{getActiveUser:()=>({getEmail:()=>env.email})},normalizeUniverseStateUserId_:()=>{}};
 vm.createContext(env);vm.runInContext(read('CatalogManagementApi.gs')+'\n'+read('ManagementPageApi.gs'),env);
 assert.match(env.getManagementPageAccess('U001').catalogMessage,/まだ公開/);
 props.UNIVERSE_CATALOG_ENABLED='true';props.UNIVERSE_CATALOG_ADMIN_EMAILS='admin@example.test';env.email='';
 assert.equal(env.getManagementPageAccess('U001').catalog,false);
 assert.match(env.getManagementPageAccess('U001').catalogMessage,/権限/);
 env.email='member@example.test';assert.equal(env.getManagementPageAccess('U001').catalog,false);
 assert.doesNotMatch(JSON.stringify(env.getManagementPageAccess('U001')),/example.test/);
 env.email='admin@example.test';assert.equal(env.getManagementPageAccess('U001').catalog,true);
});
test('the route back button returns to its category and breadcrumbs omit the repeated operation title',async()=>{
 const f=fixture();await f.go('members','profile');
 const doc=f.dom.window.document,nav=doc.getElementById('managementNavigation');
 assert.equal(nav.querySelectorAll('.management-back').length,1);
 assert.doesNotMatch(nav.textContent,/プロフィールを編集/);
 assert.equal(doc.querySelector('#managementContent h2').textContent,'プロフィールを編集');
 f.run(nav.querySelector('.management-back').getAttribute('onclick'));await f.settle();
 assert.match(doc.getElementById('managementContent').textContent,/メンバーを追加/);
 f.dom.window.close();
});
test('disabled management shows its reason while protected action links remain absent',async()=>{
 const f=fixture({admin:false});f.data.getManagementPageAccess.catalogMessage='<設定の確認>';
 await f.go();const doc=f.dom.window.document;
 assert.match(doc.querySelector('.management-access-note').textContent,/<設定の確認>/);
 assert.equal(doc.querySelector('.management-access-note 設定の確認'),null);
 await f.go('members');assert.equal(doc.querySelector('[onclick="managementGo_(\'members\',\'add\')"]'),null);
 f.dom.window.close();
});
