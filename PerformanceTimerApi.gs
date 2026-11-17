/**
 * PERFORMANCE TIMER API
 * Universe SETTINGS > TOOLS / 歌唱・ダンス秒数計測
 *
 * UI label "ダンス" writes to the existing 10_PerformanceMetrics
 * "センター秒数" block. No event / interval logs are persisted.
 */
const PERFORMANCE_TIMER_MEMBER_IDS = Object.freeze(['101','102','103','104','105','106']);
const PERFORMANCE_TIMER_TYPES = Object.freeze({
  SING: '歌唱秒数',
  DANCE: 'センター秒数'
});

function getPerformanceTimerBootstrap() {
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const songs = readPerformanceTimerObjects_(ss, UNIVERSE_CONFIG.SHEETS.SONGS)
    .filter(function(row){ return String(row.Artist || '').trim() === 'BE:FIRST'; })
    .map(function(row){
      const rawDate = row.ReleaseDate;
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate || 0);
      const time = date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : 0;
      return {
        songId: performanceTimerId_(row.SongID),
        title: String(row.Title || '').trim(),
        releaseDate: time ? Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd') : '',
        timeValue: time
      };
    })
    .filter(function(song){ return song.songId && song.title; })
    .sort(function(a,b){ return b.timeValue - a.timeValue || Number(b.songId) - Number(a.songId); });

  const memberRows = readPerformanceTimerObjects_(ss, UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const memberById = {};
  memberRows.forEach(function(row){ memberById[performanceTimerId_(row.MemberID)] = row; });
  const members = PERFORMANCE_TIMER_MEMBER_IDS.map(function(id){
    const row = memberById[id] || {};
    return {
      memberId: id,
      name: String(row.DisplayName || row.Name || id).trim() || id,
      color: performanceTimerColor_(row.ColorHex)
    };
  });

  return { songs: songs, members: members };
}

function getPerformanceTimerSnapshot(songId) {
  const id = performanceTimerId_(songId);
  if (!id) throw new Error('曲を選択してください。');
  const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  assertPerformanceTimerSong_(ss, id);
  const sheet = performanceTimerMetricsSheet_(ss);
  const layout = resolvePerformanceTimerLayout_(sheet);
  const rowNumber = findPerformanceTimerSongRow_(sheet, id);
  return {
    songId: id,
    sing: readPerformanceTimerBlock_(sheet, rowNumber, layout.SING),
    dance: readPerformanceTimerBlock_(sheet, rowNumber, layout.DANCE)
  };
}

function savePerformanceTimer(payload) {
  payload = payload || {};
  const songId = performanceTimerId_(payload.songId);
  const type = String(payload.type || '').trim().toUpperCase();
  if (!songId) throw new Error('曲を選択してください。');
  if (!PERFORMANCE_TIMER_TYPES[type]) throw new Error('計測種別を選択してください。');

  const incoming = payload.values || {};
  const values = PERFORMANCE_TIMER_MEMBER_IDS.map(function(memberId){
    const number = Number(incoming[memberId]);
    if (!Number.isFinite(number) || number < 0) throw new Error('秒数が不正です: MemberID ' + memberId);
    return Math.round(number * 100) / 100;
  });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('別の保存処理が進行中です。少し待ってからもう一度保存してください。');
  try {
    const ss = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
    assertPerformanceTimerSong_(ss, songId);
    const sheet = performanceTimerMetricsSheet_(ss);
    const layout = resolvePerformanceTimerLayout_(sheet);
    const columns = layout[type];
    let rowNumber = findPerformanceTimerSongRow_(sheet, songId);

    if (!rowNumber) {
      rowNumber = Math.max(3, sheet.getLastRow() + 1);
      sheet.getRange(rowNumber, 1).setValue(songId);
    }

    const existing = readPerformanceTimerBlock_(sheet, rowNumber, columns);
    const hasExisting = existing.some(function(item){ return item.value !== null; });
    if (hasExisting && !payload.overwriteConfirmed) {
      return {
        ok: false,
        requiresConfirmation: true,
        songId: songId,
        type: type,
        existing: existing
      };
    }

    const sortedColumns = columns.map(function(item){ return item.column; });
    const startColumn = Math.min.apply(null, sortedColumns);
    const expected = PERFORMANCE_TIMER_MEMBER_IDS.map(function(id, index){
      return { memberId:id, column:columns[index].column, value:values[index] };
    }).sort(function(a,b){ return a.column - b.column; });
    for (let i = 1; i < expected.length; i++) {
      if (expected[i].column !== expected[i-1].column + 1) {
        throw new Error('10_PerformanceMetricsの対象6列が連続していません。保存を中止しました。');
      }
    }

    sheet.getRange(rowNumber, startColumn, 1, expected.length)
      .setNumberFormat('0.00')
      .setValues([expected.map(function(item){ return item.value; })]);
    SpreadsheetApp.flush();

    const verified = readPerformanceTimerBlock_(sheet, rowNumber, columns);
    PERFORMANCE_TIMER_MEMBER_IDS.forEach(function(memberId, index){
      const item = verified.find(function(x){ return x.memberId === memberId; });
      if (!item || item.value === null || Math.round(Number(item.value) * 100) / 100 !== values[index]) {
        throw new Error('保存後の照合に失敗しました。MemberID ' + memberId);
      }
    });

    try { CacheService.getScriptCache().remove('analysis_bootstrap_v1'); } catch (error) {}

    return {
      ok: true,
      songId: songId,
      type: type,
      values: verified
    };
  } finally {
    lock.releaseLock();
  }
}

function performanceTimerMetricsSheet_(ss) {
  const name = UNIVERSE_CONFIG.SHEETS.PERFORMANCE_METRICS;
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Core DB sheet not found: ' + name);
  return sheet;
}

function resolvePerformanceTimerLayout_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 2) throw new Error('10_PerformanceMetricsのヘッダーが不足しています。');
  const headers = sheet.getRange(1, 1, 2, lastColumn).getDisplayValues();
  const result = { SING: [], DANCE: [] };
  let currentType = '';
  for (let col = 1; col < lastColumn; col++) {
    const block = String(headers[0][col] || '').trim();
    if (block === PERFORMANCE_TIMER_TYPES.SING) currentType = 'SING';
    else if (block === PERFORMANCE_TIMER_TYPES.DANCE) currentType = 'DANCE';
    else if (block) currentType = '';
    const memberId = performanceTimerId_(headers[1][col]);
    if (currentType && PERFORMANCE_TIMER_MEMBER_IDS.indexOf(memberId) !== -1) {
      result[currentType].push({ memberId: memberId, column: col + 1 });
    }
  }
  ['SING','DANCE'].forEach(function(type){
    const byId = {};
    result[type].forEach(function(item){
      if (byId[item.memberId]) throw new Error('10_PerformanceMetricsでMemberIDが重複しています: ' + item.memberId);
      byId[item.memberId] = item;
    });
    result[type] = PERFORMANCE_TIMER_MEMBER_IDS.map(function(id){ return byId[id]; });
    if (result[type].some(function(item){ return !item; })) {
      throw new Error('10_PerformanceMetricsの' + PERFORMANCE_TIMER_TYPES[type] + 'ヘッダーが不足しています。');
    }
  });
  return result;
}

function findPerformanceTimerSongRow_(sheet, songId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  const ids = sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues();
  const matches = [];
  ids.forEach(function(row, index){ if (performanceTimerId_(row[0]) === songId) matches.push(index + 3); });
  if (matches.length > 1) throw new Error('10_PerformanceMetricsでSongIDが重複しています: ' + songId);
  return matches.length ? matches[0] : 0;
}

function readPerformanceTimerBlock_(sheet, rowNumber, columns) {
  if (!rowNumber) {
    return PERFORMANCE_TIMER_MEMBER_IDS.map(function(id){ return { memberId:id, value:null }; });
  }
  return columns.map(function(item){
    const raw = sheet.getRange(rowNumber, item.column).getValue();
    const empty = raw === '' || raw === null || typeof raw === 'undefined';
    const number = empty ? null : Number(raw);
    return { memberId:item.memberId, value: empty || !Number.isFinite(number) ? null : Math.round(number * 100) / 100 };
  });
}

function assertPerformanceTimerSong_(ss, songId) {
  const matches = readPerformanceTimerObjects_(ss, UNIVERSE_CONFIG.SHEETS.SONGS).filter(function(row){
    return performanceTimerId_(row.SongID) === songId;
  });
  if (matches.length !== 1) throw new Error('06_SongsでSongIDを一意に確認できません: ' + songId);
  if (String(matches[0].Artist || '').trim() !== 'BE:FIRST') throw new Error('BE:FIRSTの曲だけ計測できます。');
}

function readPerformanceTimerObjects_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Core DB sheet not found: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(function(value){ return String(value || '').trim(); });
  return values.slice(1).filter(function(row){
    return row.some(function(value){ return value !== '' && value !== null; });
  }).map(function(row){
    const record = {};
    headers.forEach(function(header, index){ if (header) record[header] = row[index]; });
    return record;
  });
}

function performanceTimerId_(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '';
  return String(value).trim().replace(/\.0+$/, '');
}

function performanceTimerColor_(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#9cecff';
}
