// Shared repository for BMSG Universe Log sheet access helpers.
function getLogSheet_(name) {
  const sheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.LOG_DB_ID).getSheetByName(name);
  if (!sheet) throw new Error('Log sheet not found: ' + name);
  return sheet;
}

function readSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const object = {};
    headers.forEach(function(header, index) {
      if (header) object[header] = row[index];
    });
    return object;
  });
}

function readSheetObjectsWithRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value) { return String(value).trim(); });
  return values.slice(1).map(function(row, index) {
    const object = {__rowNumber:index + 2};
    headers.forEach(function(header, columnIndex) {
      if (header) object[header] = row[columnIndex];
    });
    return object;
  }).filter(function(row) {
    return Object.keys(row).some(function(key) {
      return key !== '__rowNumber' && row[key] !== '';
    });
  });
}

function appendByHeaders_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
  }));
}
