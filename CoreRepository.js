/**
 * Read a Core DB sheet as header-keyed objects.
 * No write methods are defined in this repository.
 */
function readCoreSheetObjects_(sheetName) {
  const spreadsheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Core DB sheet not found: ' + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(header) {
    return String(header || '').trim();
  });

  return values.slice(1).filter(function(row) {
    return row.some(function(value) {
      return value !== '' && value !== null;
    });
  }).map(function(row) {
    return headers.reduce(function(record, header, index) {
      if (header) record[header] = row[index];
      return record;
    }, {});
  });
}

function asId_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function asNumber_(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}
