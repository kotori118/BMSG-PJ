/** Shared ID registry for BMSG Universe runtime-owned IDs. */
const UNIVERSE_ID_REGISTRY_HEADERS_ = Object.freeze([
  'EntityType','Scope','IssuedID','NumericValue','Status','RequestID','Source','IssuedAt','UpdatedAt','Note'
]);

function reserveUniverseId_(entityType, scope, liveMax, formatter, source, note) {
  const entity = String(entityType || '').trim().toUpperCase();
  const normalizedScope = String(scope || 'GLOBAL').trim() || 'GLOBAL';
  if (!entity) throw new Error('ID種別を確認できません。');
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.ID_REGISTRY);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(function(v){return String(v||'').trim();});
  UNIVERSE_ID_REGISTRY_HEADERS_.forEach(function(name){
    if (headers.indexOf(name) < 0) throw new Error('IDRegistry に必要な列「' + name + '」がありません。');
  });
  const rows = readSheetObjectsWithRows_(sheet);
  let registryMax = 0;
  rows.forEach(function(row){
    if (String(row.EntityType || '').trim().toUpperCase() !== entity) return;
    if (String(row.Scope || 'GLOBAL').trim() !== normalizedScope) return;
    const value = Number(row.NumericValue);
    if (Number.isFinite(value)) registryMax = Math.max(registryMax, value);
  });
  const numeric = Math.max(Number(liveMax) || 0, registryMax) + 1;
  const requestId = Utilities.getUuid();
  const issuedId = typeof formatter === 'function' ? String(formatter(numeric)) : String(numeric);
  const now = new Date().toISOString();
  appendRawByHeaders_(sheet, {
    EntityType: entity,
    Scope: normalizedScope,
    IssuedID: issuedId,
    NumericValue: numeric,
    Status: 'RESERVED',
    RequestID: requestId,
    Source: String(source || 'BMSG-PJ'),
    IssuedAt: now,
    UpdatedAt: now,
    Note: String(note || '')
  });
  return {entityType:entity, scope:normalizedScope, issuedId:issuedId, numericValue:numeric, requestId:requestId};
}

function finalizeUniverseIdReservation_(reservation, committed, note) {
  if (!reservation || !reservation.requestId) return;
  const sheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.ID_REGISTRY);
  const rows = readSheetObjectsWithRows_(sheet);
  const row = rows.find(function(item){return String(item.RequestID || '') === String(reservation.requestId);});
  if (!row) throw new Error('IDRegistryの予約情報を確認できません。');
  updateByHeaders_(sheet, row.__rowNumber, {
    Status: committed ? 'COMMITTED' : 'ABORTED',
    UpdatedAt: new Date().toISOString(),
    Note: note == null ? String(row.Note || '') : String(note)
  });
}
