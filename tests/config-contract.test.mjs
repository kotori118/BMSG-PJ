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

test('cover opening and editor reads are scoped to the requested screen', () => {
  const client = fs.readFileSync(path.join(root, 'CoverScripts.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'CoverApi.gs'), 'utf8');

  assert.match(server, /function getCoverBootstrapSnapshot_/);
  assert.match(server, /function getCoverScopedSnapshot_/);
  assert.match(server, /function readCoverSheetMatchesFromSpreadsheet_/);
  assert.match(server, /getCoverScopedSnapshot_\(coverGroupId, songId\)/);
  assert.match(server, /SHEETS\.SONGS, 'Artist', selected, false/);
  assert.match(client, /getCoverProjects\(getUniverseUserId\(\)\)/);
});

test('ANALYSIS uses its shared cache key for reads, song writes, and timer writes', () => {
  const analysis = fs.readFileSync(path.join(root, 'AnalysisApi.gs'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'CacheInvalidation.gs'), 'utf8');
  const timer = fs.readFileSync(path.join(root, 'PerformanceTimerApi.gs'), 'utf8');
  assert.doesNotMatch(analysis, /const\s+ANALYSIS_CACHE_KEY\s*=/);
  assert.match(analysis, /cache\.get\(UNIVERSE_CACHE_KEYS_\.ANALYSIS\)/);
  assert.match(analysis, /cache\.put\(UNIVERSE_CACHE_KEYS_\.ANALYSIS,/);
  assert.match(cache, /ANALYSIS:\s*'analysis_bootstrap_v2_without_part_transfers'/);
  assert.match(timer, /clearUniverseAnalysisMutationCaches_\(\)/);
  assert.doesNotMatch(timer, /analysis_bootstrap_v1/);

  const evicted = [];
  const sandbox = {
    CacheService: { getScriptCache: () => ({ removeAll: (keys) => evicted.push([...keys]) }) },
    UNIVERSE_CONFIG: { SHEETS: { MEMBERS: '02_Members' } },
    readCoreSheetObjects_: () => []
  };
  vm.runInNewContext(cache + '\nclearUniverseAnalysisMutationCaches_(); clearUniverseSongMutationCaches_();', sandbox);
  assert.equal(evicted.length, 2);
  for (const keys of evicted) assert.ok(keys.includes('analysis_bootstrap_v2_without_part_transfers'));
});

test('retired part-transfer analysis has no remaining UI, API, CSS, or config references', () => {
  const forbidden = /PART_TRANSFERS|partTransferData|buildAnalysisPartTransfer_|analysisTransferSongs|パート継承分析/;
  for (const file of ['AnalysisApi.gs', 'AnalysisScripts.html', 'AnalysisStyles.html', 'Config.gs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), forbidden, file);
  }
});


test('LYRICS keeps その他UNIT last even after dynamic unit registration', () => {
  const source = fs.readFileSync(path.join(root, 'LyricsScripts.html'), 'utf8');
  const match = source.match(/  function renderLyricsAllStars\(\)\{[\s\S]*?\n  \}/);
  assert.ok(match, 'renderLyricsAllStars must exist');
  const target = { innerHTML: '' };
  const sandbox = {
    lyricsState: { unit: '' },
    LYRICS_UNITS: ['ALL', 'BMSG ALLSTARS', 'その他UNIT', 'BMSG NINE'],
    unitSongs: (unit) => unit === 'ALL' ? [] : [{ songId: '5029', title: 'My Story', releaseDate: '2026-01-01' }],
    document: { getElementById: () => target },
    lyricsGroupHeader_: () => '',
    songTime: () => 0,
    escapeLyrics: (v) => String(v),
    lyricArg: (v) => String(v),
    scrollLyricsTop: () => {}
  };
  vm.runInNewContext(match[0] + '\nrenderLyricsAllStars();', sandbox);
  const newUnit = target.innerHTML.indexOf('BMSG NINE</h3>');
  const other = target.innerHTML.indexOf('その他UNIT</h3>');
  assert.ok(newUnit >= 0 && other > newUnit, 'new units must appear before その他UNIT');
});

test('LYRICS uses the global SETTINGS route to MANAGEMENT without a duplicate shortcut', () => {
  const page = fs.readFileSync(path.join(root, 'LyricsPage.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'LyricsStyles.html'), 'utf8');
  const overlays = fs.readFileSync(path.join(root, 'AppOverlays.html'), 'utf8');
  assert.doesNotMatch(page, /lyrics-management-access|navigateTo\('manage'\)/);
  assert.doesNotMatch(css, /lyrics-management-access/);
  assert.match(overlays, /管理ページを開く/);
});
