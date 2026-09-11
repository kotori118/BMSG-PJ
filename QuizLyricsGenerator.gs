const QUIZ_LYRICS_LIMIT_MS_ = 30000;
const QUIZ_PROFILE_LIMIT_MS_ = 20000;

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
