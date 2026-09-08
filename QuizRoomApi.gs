function getRecentQuizRooms(userId) {
  const uid = validateQuizUser_(userId);
  cleanupExpiredQuizGames_();

  const resultRows = readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS));
  const resultsByGame = {};
  resultRows.forEach(function(row) {
    const gameId = asId_(row.QuizGameID);
    const resultUserId = asId_(row.UserID);
    if (!gameId || !resultUserId) return;
    if (!resultsByGame[gameId]) resultsByGame[gameId] = {};
    resultsByGame[gameId][resultUserId] = true;
  });

  return readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS))
    .map(normalizeQuizGame_)
    .filter(function(game) {
      return game.mode === 'ONLINE' &&
        /^\d{4}$/.test(game.roomId) &&
        Number.isFinite(game.createdAt.getTime()) &&
        Number.isFinite(game.expiresAt.getTime()) &&
        game.expiresAt.getTime() > Date.now();
    })
    .sort(function(a, b) { return b.createdAt.getTime() - a.createdAt.getTime(); })
    .slice(0, 5)
    .map(function(game) {
      const gameResults = resultsByGame[game.gameId] || {};
      return {
        roomId: game.roomId,
        genre: game.genre,
        course: game.course,
        difficulty: game.difficulty,
        creatorUserId: game.creatorUserId,
        createdAt: game.createdAt.toISOString(),
        expiresAt: game.expiresAt.toISOString(),
        participantCount: Object.keys(gameResults).length,
        hasAnswered: !!gameResults[uid]
      };
    });
}
