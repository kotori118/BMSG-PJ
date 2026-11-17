/**
 * Read a Core DB sheet as header-keyed objects.
 * No write methods are defined in this repository.
 */
function getCoreSpreadsheet_() {
  return SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
}

function getCoreSheetFromSpreadsheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Core DB sheet not found: ' + sheetName);
  return sheet;
}

function readCoreSheetObjects_(sheetName) {
  return readCoreSheetObjectsFromSpreadsheet_(getCoreSpreadsheet_(), sheetName);
}

function readCoreSheetObjectsFromSpreadsheet_(spreadsheet, sheetName) {
  const sheet = getCoreSheetFromSpreadsheet_(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  return coreRowsToObjects_(values);
}

function readCoreSheetDisplayObjects_(sheetName) {
  const sheet = getCoreSheetFromSpreadsheet_(getCoreSpreadsheet_(), sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  return coreRowsToObjects_(values);
}

function coreRowsToObjects_(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(function(header) {
    return String(header || '').trim();
  });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) {
      return value !== '' && value !== null && value !== false;
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

function splitUniverseCreditNames_(value) {
  return String(value || '').split(',').map(function(item) {
    return item.trim();
  }).filter(Boolean);
}
