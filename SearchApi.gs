/**
 * READ ONLY cross-content search for BMSG Universe.
 * Sources remain the existing Core DB / Log DB masters; no search index sheet is persisted.
 */
const UNIVERSE_SEARCH_CACHE_KEY_ = 'UNIVERSE_SEARCH_INDEX_V1';
const UNIVERSE_SEARCH_CACHE_SECONDS_ = 300;
const UNIVERSE_SEARCH_CARD_RARITIES_ = Object.freeze({N:true,R:true,SR:true,SSR:true});
const UNIVERSE_SEARCH_TYPE_ORDER_ = Object.freeze({MEMBER:0,SONG:1,CARD:2,LYRICS:3});

function getUniverseSearchResults(query) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return {ok:true, query:'', results:[]};

  try {
    const index = getUniverseSearchIndex_();
    const results = [];

    index.members.forEach(function(member) {
      const nameRank = searchNameRank_(member.displayName, q);
      let rank = nameRank;
      let matchedField = '';
      if (rank === null) {
        for (let i = 0; i < member.profileValues.length; i++) {
          if (searchContains_(member.profileValues[i].value, q)) {
            rank = 2;
            matchedField = member.profileValues[i].label;
            break;
          }
        }
      }
      if (rank !== null) {
        results.push({
          type:'MEMBER', id:member.memberId, memberId:member.memberId,
          title:member.displayName,
          subtitle:matchedField ? 'PROFILE · ' + matchedField : 'PROFILE',
          rank:rank
        });
      }
    });

    index.songs.forEach(function(song) {
      const titleRank = searchNameRank_(song.title, q);
      const artistMatch = searchContains_(song.artist, q);
      if (titleRank !== null || artistMatch) {
        results.push({
          type:'SONG', id:song.songId, songId:song.songId,
          title:song.title,
          subtitle:'SONG · ' + song.artist,
          rank:titleRank !== null ? titleRank : 2
        });
      }
    });

    index.cards.forEach(function(card) {
      const memberRank = searchNameRank_(card.memberName, q);
      const attributeMatch = searchContains_(card.rarity, q) || card.groupNames.some(function(groupName) {
        return searchContains_(groupName, q);
      });
      if (memberRank !== null || attributeMatch) {
        results.push({
          type:'CARD', id:card.imageId, memberId:card.memberId,
          imageId:card.imageId, rarity:card.rarity,
          title:card.memberName + ' · ' + card.rarity,
          subtitle:'TRADING CARD' + (card.groupNames.length ? ' · ' + card.groupNames.join(' / ') : ''),
          rank:memberRank !== null ? memberRank : 2
        });
      }
    });

    index.lyrics.forEach(function(song) {
      if (!searchContains_(song.lyricsText, q)) return;
      results.push({
        type:'LYRICS', id:song.songId, songId:song.songId,
        title:song.title,
        subtitle:'LYRICS · ' + song.artist,
        rank:3
      });
    });

    results.sort(function(a, b) {
      return a.rank - b.rank ||
        UNIVERSE_SEARCH_TYPE_ORDER_[a.type] - UNIVERSE_SEARCH_TYPE_ORDER_[b.type] ||
        String(a.title || '').localeCompare(String(b.title || ''), 'ja') ||
        String(a.id || '').localeCompare(String(b.id || ''), 'ja');
    });

    return {ok:true, query:q, results:results};
  } catch (error) {
    console.error(error);
    return {ok:false, error:{code:'UNIVERSE_SEARCH_FAILED', message:'検索に失敗しました。'}};
  }
}

function getUniverseSearchIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(UNIVERSE_SEARCH_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }

  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const memberships = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const profiles = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.PROFILES);
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
  const lyricParts = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
  const images = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.IMAGES);
  const profileSettings = readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS))
    .filter(function(row) { return asBoolean_(row.IsActive) && asId_(row.ProfileID); })
    .sort(function(a, b) { return asNumber_(a.DisplayOrder, 9999) - asNumber_(b.DisplayOrder, 9999); });

  const groupNameById = groups.reduce(function(map, row) {
    const id = asId_(row.GroupID);
    if (id) map[id] = String(row.GroupName || '').trim();
    return map;
  }, {});
  const groupNamesByMemberId = memberships.reduce(function(map, row) {
    const memberId = asId_(row.MemberID);
    const groupName = groupNameById[asId_(row.GroupID)];
    if (!memberId || !groupName) return map;
    if (!map[memberId]) map[memberId] = [];
    if (map[memberId].indexOf(groupName) < 0) map[memberId].push(groupName);
    return map;
  }, {});
  const memberNameById = members.reduce(function(map, row) {
    const id = asId_(row.MemberID);
    if (id) map[id] = String(row.DisplayName || '').trim();
    return map;
  }, {});
  const profileByMemberId = profiles.reduce(function(map, row) {
    const id = asId_(row.MemberID);
    if (id) map[id] = row;
    return map;
  }, {});

  const memberIndex = members.map(function(row) {
    const memberId = asId_(row.MemberID);
    const profile = profileByMemberId[memberId] || {};
    return {
      memberId:memberId,
      displayName:String(row.DisplayName || '').trim(),
      profileValues:profileSettings.map(function(setting) {
        const profileId = asId_(setting.ProfileID);
        return {
          label:String(setting.FieldName || profileId).trim(),
          value:String(profile[profileId] == null ? '' : profile[profileId]).trim()
        };
      }).filter(function(item) { return item.value; })
    };
  }).filter(function(item) { return item.memberId && item.displayName; });

  const songIndex = songs.map(function(row) {
    return {
      songId:asId_(row.SongID),
      title:String(row.Title || '').trim(),
      artist:String(row.Artist || '').trim()
    };
  }).filter(function(item) { return item.songId && item.title; });
  const songById = songIndex.reduce(function(map, song) { map[song.songId] = song; return map; }, {});

  const lyricsBySongId = lyricParts.reduce(function(map, row) {
    const songId = asId_(row.SongID);
    const lyrics = String(row.Lyrics || '').trim();
    if (!songId || !lyrics) return map;
    if (!map[songId]) map[songId] = [];
    map[songId].push(lyrics);
    return map;
  }, {});
  const lyricsIndex = Object.keys(lyricsBySongId).map(function(songId) {
    const song = songById[songId];
    if (!song) return null;
    return {
      songId:songId,
      title:song.title,
      artist:song.artist,
      lyricsText:lyricsBySongId[songId].join('\n')
    };
  }).filter(Boolean);

  const cardIndex = images.filter(function(row) {
    const type = String(row.TargetType || '').trim().toLowerCase();
    const rarity = String(row.Rarity || '').trim().toUpperCase();
    const memberId = asId_(row.TargetID);
    return type === 'member' && UNIVERSE_SEARCH_CARD_RARITIES_[rarity] && memberNameById[memberId] && asId_(row.ImageID);
  }).map(function(row) {
    const memberId = asId_(row.TargetID);
    return {
      imageId:asId_(row.ImageID),
      memberId:memberId,
      memberName:memberNameById[memberId],
      groupNames:(groupNamesByMemberId[memberId] || []).slice(),
      rarity:String(row.Rarity || '').trim().toUpperCase()
    };
  });

  const index = {members:memberIndex, songs:songIndex, lyrics:lyricsIndex, cards:cardIndex};
  const serialized = JSON.stringify(index);
  if (serialized.length < 95000) cache.put(UNIVERSE_SEARCH_CACHE_KEY_, serialized, UNIVERSE_SEARCH_CACHE_SECONDS_);
  return index;
}

function searchNameRank_(value, query) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (text === query) return 0;
  return text.indexOf(query) >= 0 ? 1 : null;
}

function searchContains_(value, query) {
  return String(value == null ? '' : value).indexOf(query) >= 0;
}
