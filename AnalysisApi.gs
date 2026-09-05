/**
 * ANALYSIS PHASE4 data adapter.
 * Existing BE:FIRST ANALYSIS calculations are preserved while data is read
 * from BMSG_Universe_DB. The legacy ANALYSIS spreadsheet remains read-only.
 */

const ANALYSIS_CACHE_KEY = 'analysis_bootstrap_v1';
const ANALYSIS_CACHE_SECONDS = 300;
const ANALYSIS_GROUP_ID = '1';
const ANALYSIS_KEYWORDS = ['夢','愛','涙','君','僕','未来','世界','時代','頂点','光','明日','Amazing','Crazy'];

function getAnalysisBootstrap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(ANALYSIS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }

  const data = buildAnalysisDataset_();
  try {
    const serialized = JSON.stringify(data);
    if (serialized.length < 95000) cache.put(ANALYSIS_CACHE_KEY, serialized, ANALYSIS_CACHE_SECONDS);
  } catch (error) {}
  return data;
}

function getAnalysisSong(songId) {
  const id = asId_(songId);
  if (!id) throw new Error('SongID is required.');
  const data = buildAnalysisDataset_();
  const song = data.songDetails[id];
  if (!song) throw new Error('Analysis song not found: ' + id);
  return song;
}

function buildAnalysisDataset_() {
  const spreadsheet = SpreadsheetApp.openById(UNIVERSE_CONFIG.CORE_DB_ID);
  const songsRows = readAnalysisSheetObjects_(spreadsheet, '06_Songs');
  const creditsRows = readAnalysisSheetObjects_(spreadsheet, '07_SongCredits');
  const lyricsRows = readAnalysisSheetObjects_(spreadsheet, '08_LyricsParts');
  const membersRows = readAnalysisSheetObjects_(spreadsheet, '02_Members');
  const groupMembersRows = readAnalysisSheetObjects_(spreadsheet, '04_GroupMembers');
  const transfersRows = readAnalysisSheetObjects_(spreadsheet, '11_PartTransfers');
  const metrics = readAnalysisMetrics_(spreadsheet);

  const groupMemberIds = new Set(groupMembersRows
    .filter(function(row){ return asId_(row.GroupID) === ANALYSIS_GROUP_ID; })
    .map(function(row){ return asId_(row.MemberID); }));

  const members = membersRows
    .filter(function(row){ return groupMemberIds.has(asId_(row.MemberID)) || asId_(row.GroupID) === ANALYSIS_GROUP_ID; })
    .map(function(row){
      return {
        id: asId_(row.MemberID),
        name: String(row.DisplayName || '').trim(),
        color: String(row.ColorHex || '#9cecff').trim() || '#9cecff',
        order: asNumber_(row.DisplayOrder, 999)
      };
    })
    .filter(function(member){ return member.id && member.name; })
    .sort(function(a,b){ return a.order - b.order; });

  const memberIds = members.map(function(member){ return member.id; });
  const memberNames = members.map(function(member){ return member.name; });
  const memberById = {};
  members.forEach(function(member){ memberById[member.id] = member; });

  const creditsBySong = {};
  creditsRows.forEach(function(row){ creditsBySong[asId_(row.SongID)] = row; });

  const songs = songsRows
    .filter(function(row){ return String(row.Artist || '').trim() === 'BE:FIRST'; })
    .map(function(row){
      const id = asId_(row.SongID);
      const releaseDate = row.ReleaseDate instanceof Date ? row.ReleaseDate : new Date(row.ReleaseDate || 0);
      const validDate = releaseDate instanceof Date && !isNaN(releaseDate.getTime());
      const credit = creditsBySong[id] || {};
      return {
        id: id,
        name: String(row.Title || id),
        year: validDate ? String(releaseDate.getFullYear()) : '',
        timeValue: validDate ? releaseDate.getTime() : 0,
        releaseDate: validDate ? Utilities.formatDate(releaseDate, 'Asia/Tokyo', 'yyyy-MM-dd') : '',
        form: String(row.Form || '').trim(),
        isTitleTrack: asBoolean_(row.IsTitleTrack),
        cdTitle: String(row.CDTitle || '').trim(),
        lyricists: splitAnalysisCredit_(credit.Lyricists),
        composers: splitAnalysisCredit_(credit.Composers),
        choreographers: splitAnalysisCredit_(credit.Choreographers)
      };
    })
    .filter(function(song){ return song.id; })
    .sort(function(a,b){ return a.timeValue - b.timeValue || Number(a.id) - Number(b.id); });

  const songById = {};
  songs.forEach(function(song){ songById[song.id] = song; });

  const lyricsBySong = {};
  const lyricTextByKey = {};
  lyricsRows.forEach(function(row){
    const songId = asId_(row.SongID);
    if (!songById[songId]) return;
    const order = asNumber_(row.PartOrder, 0);
    const text = String(row.Lyrics || '');
    const singerIds = parseAnalysisSingerIds_(row.Singer, memberById);
    const singerNames = singerIds.map(function(id){ return id === '99' ? 'ALL' : (memberById[id] ? memberById[id].name : id); });
    if (!lyricsBySong[songId]) lyricsBySong[songId] = [];
    lyricsBySong[songId].push({ order: order, singerIds: singerIds, members: singerNames.join(', '), membersArr: singerNames, text: text });
    lyricTextByKey[songId + '_' + order] = text;
  });
  Object.keys(lyricsBySong).forEach(function(songId){ lyricsBySong[songId].sort(function(a,b){ return a.order - b.order; }); });

  const memberAnalysis = {};
  members.forEach(function(member){ memberAnalysis[member.name] = { songs: [] }; });
  const timeline = [];
  const otherSongs = [];
  const songDetails = {};

  songs.forEach(function(song){
    const metric = metrics[song.id] || { sing:{}, center:{} };
    const lyrics = lyricsBySong[song.id] || [];
    const singValues = memberIds.map(function(id){ return numericOrNull_(metric.sing[id]); });
    const centerValues = memberIds.map(function(id){ return numericOrNull_(metric.center[id]); });
    const singTotal = sumNumeric_(singValues);
    const centerTotal = sumNumeric_(centerValues);
    const hasSing = singTotal > 0;
    const hasCenter = centerTotal > 0;
    const first = lyrics.length ? lyrics[0].membersArr : [];
    const last = lyrics.length ? lyrics[lyrics.length - 1].membersArr : [];

    members.forEach(function(member, index){
      const singRatio = hasSing && singValues[index] !== null ? round1_(singValues[index] / singTotal * 100) : null;
      const centerRatio = hasCenter && centerValues[index] !== null ? round1_(centerValues[index] / centerTotal * 100) : null;
      const hasLyric = lyrics.length > 0;
      if (singRatio === null && centerRatio === null && !hasLyric) return;
      memberAnalysis[member.name].songs.push({
        songId: song.id, songName: song.name, year: song.year, timeValue: song.timeValue,
        singRatio: singRatio, centerRatio: centerRatio, hasLyric: hasLyric,
        isFirst: first.indexOf(member.name) !== -1, isLast: last.indexOf(member.name) !== -1
      });
    });

    const singSec = {}, centerSec = {};
    members.forEach(function(member, index){ singSec[member.name] = singValues[index]; centerSec[member.name] = centerValues[index]; });

    timeline.push({
      id: song.id, name: song.name, year: song.year, timeValue: song.timeValue,
      singSec: singSec, singTotal: singTotal, centerSec: centerSec, centerTotal: centerTotal,
      first: first, last: last
    });
    otherSongs.push({
      id: song.id, name: song.name, form: song.form, isTitleTrack: song.isTitleTrack, cdTitle: song.cdTitle,
      timeValue: song.timeValue, lyricists: song.lyricists, composers: song.composers, choreographers: song.choreographers,
      singSec: singSec, singTotal: singTotal, centerSec: centerSec, centerTotal: centerTotal, first: first, last: last
    });

    const singRatios = singValues.map(function(value){ return hasSing && value !== null ? round1_(value / singTotal * 100) : 0; });
    const centerRatios = centerValues.map(function(value){ return hasCenter && value !== null ? round1_(value / centerTotal * 100) : 0; });
    songDetails[song.id] = {
      id: song.id, name: song.name,
      singData: singRatios, centerData: centerRatios,
      singBalance: calcAnalysisBalance_(singValues.map(function(v){ return v || 0; }), memberNames),
      centerBalance: calcAnalysisBalance_(centerValues.map(function(v){ return v || 0; }), memberNames),
      hasSing: hasSing, hasDance: hasCenter,
      lyrics: lyrics.map(function(item){ return { members:item.members, text:item.text, order:item.order }; }),
      firstSinger: first.length ? first.join(', ') : '-',
      lastSinger: last.length ? last.join(', ') : '-'
    };
  });

  Object.keys(memberAnalysis).forEach(function(name){ memberAnalysis[name].songs.sort(function(a,b){ return a.timeValue - b.timeValue; }); });
  timeline.sort(function(a,b){ return a.timeValue - b.timeValue; });
  otherSongs.sort(function(a,b){ return a.timeValue - b.timeValue; });

  const sequence = buildAnalysisSequence_(songs, lyricsBySong);
  const phrase = buildAnalysisPhrase_(songs, lyricsBySong, memberNames);
  const partTransfer = buildAnalysisPartTransfer_(transfersRows, songById, memberById, lyricTextByKey, memberNames);

  return {
    members: members,
    songList: songs.map(function(song){ return { id:song.id, name:song.name }; }),
    memberAnalysis: memberAnalysis,
    timelineData: timeline,
    otherAllSongsData: otherSongs,
    sequenceData: sequence,
    phraseData: phrase,
    partTransferData: partTransfer,
    songDetails: songDetails
  };
}

function readAnalysisSheetObjects_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Core DB sheet not found: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(value){ return String(value || '').trim(); });
  return values.slice(1).filter(function(row){ return row.some(function(value){ return value !== '' && value !== null; }); }).map(function(row){
    const record = {};
    headers.forEach(function(header, index){ if (header) record[header] = row[index]; });
    return record;
  });
}

function readAnalysisMetrics_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('10_PerformanceMetrics');
  if (!sheet) throw new Error('Core DB sheet not found: 10_PerformanceMetrics');
  const values = sheet.getDataRange().getValues();
  if (values.length < 3) return {};
  const groupHeaders = values[0];
  const memberHeaders = values[1];
  let mode = '';
  const descriptors = memberHeaders.map(function(memberId, index){
    const group = String(groupHeaders[index] || '').trim();
    if (group) mode = group === '歌唱秒数' ? 'sing' : (group === 'センター秒数' ? 'center' : mode);
    return { index:index, mode:mode, memberId:asId_(memberId) };
  });
  const result = {};
  values.slice(2).forEach(function(row){
    const songId = asId_(row[0]);
    if (!songId) return;
    const entry = { sing:{}, center:{} };
    descriptors.forEach(function(descriptor){
      if (descriptor.index === 0 || !descriptor.mode || !descriptor.memberId) return;
      entry[descriptor.mode][descriptor.memberId] = row[descriptor.index];
    });
    result[songId] = entry;
  });
  return result;
}

function parseAnalysisSingerIds_(rawValue, memberById) {
  let raw = String(rawValue === null || typeof rawValue === 'undefined' ? '' : rawValue).trim();
  if (!raw) return [];
  const parts = raw.indexOf(',') !== -1 ? raw.split(',') : [raw];
  const ids = [];
  parts.forEach(function(part){
    let token = String(part).trim().replace(/_(up|down|sub)$/i, '');
    if (!token) return;
    if (/^\d+$/.test(token) && token.length > 3 && token.length % 3 === 0) {
      for (let i=0; i<token.length; i+=3) ids.push(token.substring(i,i+3));
    } else {
      ids.push(token);
    }
  });
  return ids.filter(function(id, index){ return (id === '99' || memberById[id]) && ids.indexOf(id) === index; });
}

function splitAnalysisCredit_(value) {
  return String(value || '').split(',').map(function(item){ return item.trim(); }).filter(Boolean);
}

function numericOrNull_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumNumeric_(values) {
  return values.reduce(function(total, value){ return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0); }, 0);
}

function round1_(value) { return Math.round(value * 10) / 10; }

function calcAnalysisBalance_(values, memberNames) {
  if (!values || !values.length) return { type:'データなし', level:null };
  const sum = values.reduce(function(a,b){ return a + Number(b || 0); }, 0);
  if (!sum) return { type:'データなし', level:null };
  let maxValue = -1, maxIndex = -1;
  values.forEach(function(value,index){ if (value > maxValue) { maxValue=value; maxIndex=index; } });
  const sorted = values.slice().sort(function(a,b){ return a-b; });
  const n = sorted.length;
  let numerator = 0;
  sorted.forEach(function(value,index){ numerator += (index+1)*value; });
  let gini = (2*numerator)/(n*sum) - (n+1)/n;
  if (n > 1) gini = gini / ((n-1)/n);
  const level = Math.round(gini*100);
  let type = 'バランス型';
  if (level > 40) type = '超特化型 (' + memberNames[maxIndex] + ')';
  else if (level > 20) type = '特化型 (' + memberNames[maxIndex] + ')';
  return { type:type, level:level };
}

function buildAnalysisSequence_(songs, lyricsBySong) {
  const transitions = {}, aba = {};
  songs.forEach(function(song){
    const lyrics = lyricsBySong[song.id] || [];
    let prev = [], prevPrev = [], active = new Set();
    lyrics.forEach(function(line){
      const curr = line.membersArr || [];
      prev.forEach(function(p){ curr.forEach(function(c){ if (p !== c) { const key=p+' ➔ '+c; transitions[key]=(transitions[key]||0)+1; } }); });
      const nextActive = new Set();
      prevPrev.forEach(function(pp){ prev.forEach(function(p){ curr.forEach(function(c){
        if (pp === c && pp !== p) {
          const key=[pp,p].sort().join(' & '); nextActive.add(key); if(!active.has(key)) aba[key]=(aba[key]||0)+1;
        }
      }); }); });
      active = nextActive; prevPrev = prev; prev = curr;
    });
  });
  function rank(map){ return Object.keys(map).map(function(key){ return {label:key,count:map[key]}; }).sort(function(a,b){ return b.count-a.count; }).slice(0,15); }
  return { transitions:rank(transitions), abaCombos:rank(aba) };
}

function buildAnalysisPhrase_(songs, lyricsBySong, memberNames) {
  const stats = {};
  ANALYSIS_KEYWORDS.forEach(function(keyword){ stats[keyword]={total:0}; memberNames.forEach(function(name){ stats[keyword][name]=0; }); });
  songs.forEach(function(song){ (lyricsBySong[song.id]||[]).forEach(function(line){
    ANALYSIS_KEYWORDS.forEach(function(keyword){
      if (line.text.indexOf(keyword) === -1) return;
      line.membersArr.forEach(function(name){ if (typeof stats[keyword][name] !== 'undefined') { stats[keyword][name]++; stats[keyword].total++; } });
    });
  }); });
  return ANALYSIS_KEYWORDS.map(function(keyword){ return {keyword:keyword,stats:stats[keyword]}; }).filter(function(item){ return item.stats.total>0; }).sort(function(a,b){ return b.stats.total-a.stats.total; });
}

function buildAnalysisPartTransfer_(rows, songById, memberById, lyricTextByKey, memberNames) {
  const countMap = {}; memberNames.forEach(function(name){ countMap[name]=0; });
  const grouped = {}; let unique=0;
  rows.forEach(function(row){
    const songId=asId_(row.SongID), order=asNumber_(row.PartOrder,0), toId=asId_(row.ToMemberID), group=String(row.TransferGroup||'').trim();
    if (!songById[songId] || !toId) return;
    const memberName=memberById[toId] ? memberById[toId].name : toId;
    const key=group ? songId+'_grp_'+group : 'row_'+(unique++);
    if(!grouped[key]) grouped[key]={songId:songId,songName:songById[songId].name,timeValue:songById[songId].timeValue,order:order,members:new Set(),texts:[]};
    grouped[key].members.add(memberName);
    const text=lyricTextByKey[songId+'_'+order]||''; if(text) grouped[key].texts.push(text);
  });
  const transferList=[];
  Object.keys(grouped).forEach(function(key){ const part=grouped[key]; part.members.forEach(function(name){
    if(typeof countMap[name] !== 'undefined') countMap[name]++;
    transferList.push({songId:part.songId,songName:part.songName,timeValue:part.timeValue,order:part.order,member:name,text:part.texts.join(' / ')});
  }); });
  transferList.sort(function(a,b){ return a.timeValue-b.timeValue || a.order-b.order; });
  const groupedSongs=[]; let currentId='', current=null;
  transferList.forEach(function(item){ if(item.songId!==currentId){currentId=item.songId;current={songId:item.songId,songName:item.songName,parts:[]};groupedSongs.push(current);} current.parts.push({member:item.member,text:item.text,order:item.order}); });
  const ranking=memberNames.map(function(name){ return {name:name,count:countMap[name]}; }).sort(function(a,b){ return b.count-a.count; });
  return { ranking:ranking, songs:groupedSongs };
}
