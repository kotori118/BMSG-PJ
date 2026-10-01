import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

test('server user catalog has the three current users', () => {
  const sandbox = { result: null };
  const source = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
  vm.runInNewContext(
    `${source}\nresult = JSON.parse(JSON.stringify({ids: UNIVERSE_CONFIG.USER_IDS, names: UNIVERSE_CONFIG.USER_DISPLAY_NAMES}));`,
    sandbox
  );

  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.result)), {
    ids: ['U001', 'U002', 'U003'],
    names: { U001: 'ももたん', U002: 'みおたん', U003: 'りおたん' }
  });
});

test('feature APIs do not redefine the server user list', () => {
  const forbidden = /const\s+(?:CARD|COVER|KARAOKE|LYRICS|POKER|QUIZ|SLM|UNIVERSE_STATE)_USERS_/;
  const offenders = fs.readdirSync(root)
    .filter((name) => name.endsWith('.gs'))
    .filter((name) => forbidden.test(fs.readFileSync(path.join(root, name), 'utf8')));

  assert.deepEqual(offenders, []);
});

test('BMSGDB is pinned to a production library version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  const library = manifest.dependencies.libraries.find((item) => item.userSymbol === 'BMSGDB');

  assert.ok(library);
  assert.equal(Number.isInteger(Number(library.version)), true);
  assert.ok(Number(library.version) > 0);
  assert.equal(library.developmentMode, false);
});

test('cover save shows progress and batches spreadsheet row writes', () => {
  const client = fs.readFileSync(path.join(root, 'CoverScripts.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'CoverStyles.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'CoverApi.gs'), 'utf8');

  assert.match(client, /setCoverSavingState\(true\)/);
  assert.match(client, /id="coverSaving"/);
  assert.match(client, /renderUniverseLoading\('LOADING\.\.\.','#9cecff'\)/);
  assert.doesNotMatch(client, /class="cover-dialog cover-saving"/);
  assert.doesNotMatch(client, /function refreshCoverHomeAfterSave/);
  assert.match(client, /function finishCoverSave\(project\)/);
  assert.doesNotMatch(styles, /cover-saving-spinner|@keyframes cover-saving-spin/);
  assert.match(styles, /\.cover-saving\[hidden\]\{display:none!important\}/);
  assert.match(server, /function appendCoverRecordsByHeaders_/);
  assert.doesNotMatch(server, /assignments\.forEach\(function\(item\)\{ appendByHeaders_/);
  assert.doesNotMatch(server, /sheet\.deleteRow\(/);
  assert.match(server, /!allowed\[memberId\] && memberId !== originalsByOrder\[key\]/);
  assert.match(server, /function readCoverWrittenRecords_/);
});
