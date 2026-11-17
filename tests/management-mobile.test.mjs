import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {fixture} from '../audit/management-fixture.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('all selected users open management without Google identity or role properties',()=>{
 const env={UNIVERSE_CONFIG:{USER_IDS:['U001','U002','U003']},PropertiesService:{getScriptProperties:()=>{throw Error('unexpected settings read');}},Session:{getActiveUser:()=>{throw Error('unexpected Google identity read');}},BMSGDB:{getCatalogManagementReadinessForUniverse:()=>({ready:true})}};
 vm.createContext(env);vm.runInContext(read('CatalogManagementApi.gs')+'\n'+read('ManagementPageApi.gs'),env);
 for(const userId of env.UNIVERSE_CONFIG.USER_IDS)assert.equal(env.getManagementPageAccess(userId).catalog,true);
 for(const userId of ['','U999'])assert.throws(()=>env.getManagementPageAccess(userId),/利用ユーザー/);
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
test('schema preparation is offered to every user without hiding management operations',async()=>{
 const f=fixture({admin:false});f.data.getManagementPageAccess.initialSetupRequired=true;
 await f.go();const doc=f.dom.window.document;
 assert.match(doc.querySelector('.management-access-note').textContent,/初回のデータ準備/);
 assert.ok(doc.querySelector('.management-access-note button'));
 await f.go('members');assert.match(doc.getElementById('managementContent').textContent,/メンバーを追加/);
 f.dom.window.close();
});
