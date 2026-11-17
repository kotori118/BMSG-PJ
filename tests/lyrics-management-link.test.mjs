import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
test('LYRICS does not render an extra Management shortcut',()=>{
 const page=fs.readFileSync(path.join(root,'LyricsPage.html'),'utf8');
 const css=fs.readFileSync(path.join(root,'LyricsStyles.html'),'utf8');
 const manager=fs.readFileSync(path.join(root,'ManagementPage.html'),'utf8');
 assert.doesNotMatch(page,/lyrics-management-access|管理ページ|navigateTo\('manage'\)/);
 assert.doesNotMatch(css,/lyrics-management-access/);
 assert.match(manager,/function openManagementPage\(/);
 assert.match(page,/<h1>LYRICS<\/h1>/);
});
