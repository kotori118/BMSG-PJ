function getQuizSongCatalog_(course) {
  return readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS)
    .filter(function(row) { return quizCourseMatchesSong_(row, course); })
    .map(function(row) {
      return { value: asId_(row.SongID), label: String(row.Title || row.SongID), artist: String(row.Artist || '') };
    })
    .filter(function(row) { return row.value && row.label; })
    .sort(function(a, b) { return a.label.localeCompare(b.label, 'ja'); });
}

function getQuizMemberCatalog_(course) {
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const memberships = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const eligible = quizCourseMemberIds_(course, members, groups, memberships);
  return members.filter(function(row) { return !!eligible[asId_(row.MemberID)]; }).map(function(row) {
    return { value: asId_(row.MemberID), label: String(row.DisplayName || row.MemberID), order: Number(row.DisplayOrder || 9999) };
  }).sort(function(a, b) { return a.order - b.order || a.label.localeCompare(b.label, 'ja'); });
}

function buildLyricsQuizQuestions_(course, difficulty) {
  const songs = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS);
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const parts = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.LYRICS_PARTS);
  const memberById = {};
  members.forEach(function(row) { memberById[asId_(row.MemberID)] = String(row.DisplayName || row.MemberID); });
  const eligibleSongs = songs.filter(function(row) { return quizCourseMatchesSong_(row, course); });
  const songById = {};
  eligibleSongs.forEach(function(row) { songById[asId_(row.SongID)] = row; });
  const partsBySong = {};
  parts.forEach(function(row) {
    const songId = asId_(row.SongID);
    const lyrics = String(row.Lyrics || '').trim();
    const singerIds = parseQuizSingerIds_(row.Singer, memberById);
    if (!songById[songId] || !lyrics || !singerIds.length) return;
    if (!partsBySong[songId]) partsBySong[songId] = [];
    partsBySong[songId].push({ lyrics: lyrics, singerIds: singerIds, order: Number(row.PartOrder || 0) });
  });

  const candidates = Object.keys(partsBySong).map(function(songId) {
    const validParts = partsBySong[songId].filter(function(part) {
      return Array.from(stripQuizWhitespace_(part.lyrics)).length >= (difficulty === 'NORMAL' ? 11 : 5);
    });
    return validParts.length ? { songId: songId, title: String(songById[songId].Title || songId), artist: String(songById[songId].Artist || ''), parts: validParts } : null;
  }).filter(Boolean);
  if (candidates.length < QUIZ_QUESTION_COUNT_) return { candidatePool: candidates.map(function(x) { return x.songId; }), questions: [] };

  const selected = quizShuffle_(candidates).slice(0, QUIZ_QUESTION_COUNT_);
  const titlePool = candidates.map(function(item) { return { value: item.songId, label: item.title }; });
  const singerPool = [];
  const seenSingerLabels = {};
  candidates.forEach(function(item) { item.parts.forEach(function(part) {
    const value = part.singerIds.slice().sort().join('|');
    if (!seenSingerLabels[value]) {
      seenSingerLabels[value] = true;
      singerPool.push({ value: value, label: part.singerIds.map(function(id) { return memberById[id]; }).join(' / ') });
    }
  }); });

  return {
    candidatePool: candidates.map(function(item) { return item.songId; }),
    questions: selected.map(function(item) {
      const part = quizShuffle_(item.parts)[0];
      const singerValue = part.singerIds.slice().sort().join('|');
      return {
        type: 'LYRICS',
        text: makeQuizSnippet_(part.lyrics, difficulty),
        source: { songId: item.songId, title: item.title, artist: item.artist, partOrder: part.order, singerIds: part.singerIds, singerNames: part.singerIds.map(function(id) { return memberById[id]; }) },
        choices: { songs: buildQuizChoices_(titlePool, item.songId), singers: buildQuizChoices_(singerPool, singerValue) },
        correct: { songId: item.songId, singerValue: singerValue }
      };
    })
  };
}