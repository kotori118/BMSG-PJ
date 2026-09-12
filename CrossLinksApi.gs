/**
 * PHASE5 cross-feature read-only adapters.
 * Cross-feature data belongs here so PROFILE / LYRICS / ANALYSIS / CARD / COVER
 * can stay focused on their own service responsibilities.
 */
function getUniverseMemberCreativeCredits(memberId) {
  try {
    const id = asId_(memberId);
    if (!id) throw new Error('MemberID is required.');

    const cache = CacheService.getScriptCache();
    const cacheKey = 'UNIVERSE_CROSSLINK_CREDITS_V1_' + id;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
    const member = members.find(function(row) { return asId_(row.MemberID) === id; });
    if (!member) throw new Error('Member not found: ' + id);
    const memberName = String(member.DisplayName || '').trim();
    if (!memberName) throw new Error('Member name is empty: ' + id);

    const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
    const credits = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONG_CREDITS);
    const creditsBySong = {};
    credits.forEach(function(row) { creditsBySong[asId_(row.SongID)] = row; });

    function hasExactCredit(value) {
      return String(value || '').split(',').map(function(token) {
        return token.trim();
      }).filter(Boolean).indexOf(memberName) >= 0;
    }

    const creditSongs = songs.map(function(song) {
      const songId = asId_(song.SongID);
      const credit = creditsBySong[songId] || {};
      const roles = [];
      if (hasExactCredit(credit.Lyricists)) roles.push('作詞');
      if (hasExactCredit(credit.Composers)) roles.push('作曲');
      if (hasExactCredit(credit.Choreographers)) roles.push('コレオ');
      if (!roles.length) return null;
      return {
        songId: songId,
        title: String(song.Title || songId).trim(),
        artist: String(song.Artist || '').trim(),
        roles: roles
      };
    }).filter(Boolean);

    const response = { ok: true, data: { memberId: id, memberName: memberName, songs: creditSongs } };
    cache.put(cacheKey, JSON.stringify(response), UNIVERSE_CONFIG.PROFILE_CACHE_SECONDS);
    return response;
  } catch (error) {
    console.error(error);
    return { ok: false, error: { code: 'CROSS_LINK_CREDITS_LOAD_FAILED', message: 'クレジット参加曲の読み込みに失敗しました。' } };
  }
}
