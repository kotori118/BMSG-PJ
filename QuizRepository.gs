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

function saveQuizUserResult_(game, uid, score, totalMs, details) {
  const now = new Date();
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS), { QuizGameID: game.gameId, UserID: uid, Score: score, TotalAnswerTimeMs: Math.max(0, Math.round(totalMs || 0)), AnswerDetailsJSON: JSON.stringify(details || []), AnsweredAt: now });
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_SCORES), { QuizScoreID: Utilities.getUuid(), SourceGameID: game.gameId, UserID: uid, Mode: game.mode, Genre: quizGenreStorage_(game.genre), Course: quizCourseStorage_(game.course), Difficulty: quizDifficultyStorage_(game.difficulty), Score: score, PlayedAt: now });
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES), { ActivityID: Utilities.getUuid(), UserID: uid, ActivityType: 'PLAY_QUIZ', TargetID: game.gameId, OccurredAt: now });
}

function saveQuizGameRows_(params, generated) {
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS), {
    QuizGameID: params.gameId,
    RoomID: params.roomId,
    Mode: params.mode,
    Genre: quizGenreStorage_(params.genre),
    Course: quizCourseStorage_(params.course),
    Difficulty: quizDifficultyStorage_(params.difficulty),
    CreatorUserID: params.creatorUserId,
    CreatedAt: params.createdAt,
    ExpiresAt: new Date(params.createdAt.getTime() + QUIZ_RETENTION_MS_),
    CandidatePoolJSON: JSON.stringify({ candidates: generated.candidatePool, players: params.players })
  });

  const questionSheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_QUESTIONS);
  generated.questions.slice(0, QUIZ_QUESTION_COUNT_).forEach(function(question, index) {
    appendByHeaders_(questionSheet, {
      QuizGameID: params.gameId,
      QuestionNo: index + 1,
      QuestionType: question.type,
      QuestionText: question.text,
      SourceRefJSON: JSON.stringify(question.source || {}),
      ChoicesJSON: JSON.stringify(question.choices || []),
      CorrectAnswerJSON: JSON.stringify(question.correct || {})
    });
  });
}

function createQuizRoomId_() {
  const used = {};
  readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS)).forEach(function(row) { if (row.RoomID !== '') used[String(row.RoomID || '').padStart(4, '0')] = true; });
  for (let i = 0; i < 100; i++) { const id = String(Math.floor(1000 + Math.random() * 9000)); if (!used[id]) return id; }
  throw new Error('ROOM IDを発行できませんでした。');
}

function cleanupExpiredQuizGames_() { return withQuizLock_(cleanupExpiredQuizGamesUnsafe_); }
function cleanupExpiredQuizGamesUnsafe_() {
  const games = readSheetObjectsWithRows_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS)).filter(function(row) { const date = new Date(row.ExpiresAt); return !Number.isFinite(date.getTime()) || date.getTime() <= Date.now(); });
  games.forEach(function(row) { deleteQuizGameRows_(asId_(row.QuizGameID)); });
}

function deleteQuizGameRows_(gameId) {
  [UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS, UNIVERSE_CONFIG.SHEETS.QUIZ_QUESTIONS, UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS].forEach(function(name) {
    const sheet = getLogSheet_(name);
    readSheetObjectsWithRows_(sheet).filter(function(row) { return asId_(row.QuizGameID) === gameId; }).sort(function(a, b) { return b.__rowNumber - a.__rowNumber; }).forEach(function(row) { sheet.deleteRow(row.__rowNumber); });
  });
}
