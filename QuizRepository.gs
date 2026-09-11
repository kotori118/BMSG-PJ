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

function findQuizGameById_(gameId) {
  const row = readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS)).find(function(item) { return asId_(item.QuizGameID) === gameId; });
  return row ? normalizeQuizGame_(row) : null;
}

function findQuizGameByRoomId_(roomId) {
  const row = readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS)).find(function(item) { return String(item.RoomID || '').padStart(4, '0') === roomId; });
  if (!row) return null;
  const game = normalizeQuizGame_(row);
  return game.expiresAt.getTime() > Date.now() && game.mode === 'ONLINE' ? game : null;
}

function normalizeQuizGame_(row) {
  const pool = quizParseJson_(row.CandidatePoolJSON, {});
  return {
    rowNumber: row.__rowNumber,
    gameId: asId_(row.QuizGameID),
    roomId: row.RoomID === '' ? '' : String(row.RoomID || '').padStart(4, '0'),
    mode: String(row.Mode || '').toUpperCase(),
    genre: normalizeQuizGenre_(row.Genre),
    course: normalizeQuizCourse_(row.Course),
    difficulty: normalizeQuizDifficulty_(row.Difficulty),
    creatorUserId: asId_(row.CreatorUserID),
    createdAt: new Date(row.CreatedAt),
    expiresAt: new Date(row.ExpiresAt),
    players: Array.isArray(pool.players) ? pool.players.map(asId_).filter(Boolean) : []
  };
}

function getQuizQuestionRows_(gameId) {
  return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_QUESTIONS)).filter(function(row) { return asId_(row.QuizGameID) === gameId; }).map(function(row) {
    return { number: Number(row.QuestionNo || 0), type: String(row.QuestionType || ''), text: String(row.QuestionText || ''), source: quizParseJson_(row.SourceRefJSON, {}), choices: quizParseJson_(row.ChoicesJSON, []), correct: quizParseJson_(row.CorrectAnswerJSON, {}) };
  }).sort(function(a, b) { return a.number - b.number; });
}

function getQuizResultRows_(gameId) { return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS)).filter(function(row) { return asId_(row.QuizGameID) === gameId; }); }
function findQuizResult_(gameId, uid) { return getQuizResultRows_(gameId).find(function(row) { return asId_(row.UserID) === uid; }); }
