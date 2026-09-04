const LYRICS_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const LYRICS_CATEGORIES_ = Object.freeze(['ALL', 'BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA', 'UNIT']);

function getLyricsCatalog() {
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
  const parts = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
  const counts = parts.reduce(function(map, row) {
    const id = asId_(row.SongID);
    if (id) map[id] = (map[id] || 0) + 1;
    return map;
  }, {});

  return {
    categories: LYRICS_CATEGORIES_.slice(),
    songs: songs.filter(function(row) {
      return counts[asId_(row.SongID)] > 0;
    }).map(function(row) {
      const artist = String(row.Artist || '').trim();
      return {
        songId: asId_(row.SongID),
        title: String(row.Title || '').trim(),
        artist: artist,
        category: lyricsCategory_(artist),
        unitCategory: lyricsUnitCategory_(String(row.Title || '').trim(), artist),
        partCount: counts[asId_(row.SongID)] || 0
      };
    })
  };
}

function getLyricsSong(songId) {
  const id = asId_(songId);
  if (!id) throw new Error('SongID is required.');
  const song = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS).find(function(row) {
    return asId_(row.SongID) === id;
  });
  if (!song) throw new Error('Song not found: ' + id);

  const parts = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS)
    .filter(function(row) { return asId_(row.SongID) === id; })
    .sort(function(a, b) { return Number(a.PartOrder) - Number(b.PartOrder); })
    .map(function(row) {
      return {
        songId: id,
        partOrder: Number(row.PartOrder),
        singer: String(row.Singer || ''),
        lyrics: String(row.Lyrics || '')
      };
    });
  return { songId: id, title: String(song.Title || ''), artist: String(song.Artist || ''), parts: parts };
}

function updateLyricsPart(payload) {
  payload = payload || {};
  const userId = asId_(payload.userId);
  const songId = asId_(payload.songId);
  const partOrder = Number(payload.partOrder);
  const singer = String(payload.singer || '').trim();
  const lyrics = String(payload.lyrics || '').trim();
  if (LYRICS_USERS_.indexOf(userId) < 0) throw new Error('利用ユーザーを選択してください。');
  if (!songId || !Number.isInteger(partOrder) || partOrder < 1) throw new Error('更新対象が不正です。');
  if (!singer || !lyrics) throw new Error('歌唱者と歌詞は必須です。');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID)
      .getSheetByName(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
    if (!sheet) throw new Error('Lyrics sheet not found.');
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(function(v) { return String(v).trim(); });
    const songCol = headers.indexOf('SongID');
    const orderCol = headers.indexOf('PartOrder');
    const singerCol = headers.indexOf('Singer');
    const lyricsCol = headers.indexOf('Lyrics');
    if ([songCol, orderCol, singerCol, lyricsCol].some(function(i) { return i < 0; })) {
      throw new Error('Lyrics sheet columns are invalid.');
    }
    let rowNumber = 0;
    for (let i = 1; i < values.length; i++) {
      if (asId_(values[i][songCol]) === songId && Number(values[i][orderCol]) === partOrder) {
        rowNumber = i + 1;
        break;
      }
    }
    if (!rowNumber) throw new Error('更新対象の歌詞パートが見つかりません。');
    sheet.getRange(rowNumber, singerCol + 1).setValue(singer);
    sheet.getRange(rowNumber, lyricsCol + 1).setValue(lyrics);
    SpreadsheetApp.flush();
    const checked = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    if (String(checked[singerCol]) !== singer || String(checked[lyricsCol]) !== lyrics) {
      throw new Error('保存後の確認に失敗しました。');
    }
    return { ok: true, songId: songId, partOrder: partOrder, singer: singer, lyrics: lyrics };
  } finally {
    lock.releaseLock();
  }
}

function lyricsCategory_(artist) {
  if (['BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA'].indexOf(artist) >= 0) return artist;
  return 'UNIT';
}

function lyricsUnitCategory_(title, artist) {
  if (artist === 'BMSG ALLSTARS' || ['New Chapter', 'Grand Champ', "Grand Champ -from BMSG FES'2025-"].indexOf(title) >= 0) return 'BMSG ALLSTARS';
  const units = ['ShowMinorSavage', 'BMSG POSSE', 'BMSG EAST', 'BMSG WEST', 'BMSG SKY', 'BMSG GAIA', 'BMSG MARINE', 'BMSG STRIKERS'];
  return units.indexOf(artist) >= 0 ? artist : 'その他UNIT';
}
