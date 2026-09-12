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
  if (sheet.getName() === UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES) {
    appendRecentActivity_(sheet, record);
    return;
  }
  appendRawByHeaders_(sheet, record);
}

function appendRawByHeaders_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
  }));
}

function appendRecentActivity_(sheet, record) {
  const userId = String(record && record.UserID || '').trim();
  const activityType = String(record && record.ActivityType || '').trim();
  const targetId = String(record && record.TargetID || '').trim();
  if (!userId || !activityType || !targetId) throw new Error('Recent activity requires UserID, ActivityType and TargetID.');

  const rows = readSheetObjectsWithRows_(sheet)
    .filter(function(row) { return String(row.UserID || '').trim() === userId; })
    .sort(function(a, b) { return a.__rowNumber - b.__rowNumber; });
  const latest = rows.length ? rows[rows.length - 1] : null;
  const isViewActivity = activityType === 'VIEW_MEMBER' || activityType === 'VIEW_LYRICS';
  const shouldMerge = latest &&
    String(latest.ActivityType || '').trim() === activityType &&
    (!isViewActivity || String(latest.TargetID || '').trim() === targetId);

  if (shouldMerge) {
    updateByHeaders_(sheet, latest.__rowNumber, {OccurredAt: record.OccurredAt || new Date()});
  } else {
    appendRawByHeaders_(sheet, record);
  }

  const currentRows = readSheetObjectsWithRows_(sheet)
    .filter(function(row) { return String(row.UserID || '').trim() === userId; })
    .sort(function(a, b) { return a.__rowNumber - b.__rowNumber; });
  const excess = currentRows.length - 10;
  if (excess > 0) {
    currentRows.slice(0, excess)
      .map(function(row) { return row.__rowNumber; })
      .sort(function(a, b) { return b - a; })
      .forEach(function(rowNumber) { sheet.deleteRow(rowNumber); });
  }
}

function updateByHeaders_(sheet, rowNumber, record) {
  if (!rowNumber || rowNumber < 2) throw new Error('Invalid row number.');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  headers.forEach(function(header, index) {
    if (Object.prototype.hasOwnProperty.call(record, header)) values[index] = record[header];
  });
  range.setValues([values]);
}
