function validateQuizPartyPlayersFinal_(values) {
  const players = Array.isArray(values)
    ? values.map(validateQuizUser_).filter(function(id, index, all) { return all.indexOf(id) === index; })
    : [];
  if (players.length < 2 || players.length > 3) throw new Error('オフラインは2〜3人を選択してください。');
  return players;
}

function createQuizOfflinePartyFinal(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  const genre = validateQuizEnum_(payload.genre, QUIZ_GENRES_, 'GENRE');
  const difficulty = validateQuizEnum_(payload.difficulty, QUIZ_DIFFICULTIES_, 'DIFFICULTY');
  const course = genre === 'PROFILE' ? 'ALL' : validateQuizEnum_(payload.course, QUIZ_COURSES_, 'COURSE');
  const players = validateQuizPartyPlayersFinal_(payload.playerUserIds);

  return withQuizLock_(function() {
    cleanupExpiredQuizGamesUnsafe_();
    const generated = genre === 'LYRICS'
      ? buildLyricsQuizQuestions_(course, difficulty)
      : buildProfileQuizQuestionsFinal_(difficulty);
    if (!generated || generated.questions.length < QUIZ_QUESTION_COUNT_) {
      throw new Error('この条件では10問作れません。難易度を変えてください。');
    }

    const gameId = Utilities.getUuid();
    const createdAt = new Date();
    appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS), {
      QuizGameID: gameId,
      RoomID: '',
      Mode: 'OFFLINE',
      Genre: quizGenreStorage_(genre),
      Course: quizCourseStorage_(course),
      Difficulty: quizDifficultyStorage_(difficulty),
      CreatorUserID: uid,
      CreatedAt: createdAt,
      ExpiresAt: new Date(createdAt.getTime() + QUIZ_RETENTION_MS_),
      CandidatePoolJSON: JSON.stringify({ candidates: generated.candidatePool, players: players })
    });

    const questionSheet = getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_QUESTIONS);
    generated.questions.slice(0, QUIZ_QUESTION_COUNT_).forEach(function(question, index) {
      appendByHeaders_(questionSheet, {
        QuizGameID: gameId,
        QuestionNo: index + 1,
        QuestionType: question.type,
        QuestionText: question.text,
        SourceRefJSON: JSON.stringify(question.source || {}),
        ChoicesJSON: JSON.stringify(question.choices || []),
        CorrectAnswerJSON: JSON.stringify(question.correct || {})
      });
    });
    return buildQuizGameStateV2_(findQuizGameById_(gameId), uid);
  });
}

function submitQuizOfflinePartyFinal(payload) {
  payload = payload || {};
  validateQuizUser_(payload.userId);
  return withQuizLock_(function() {
    const game = findQuizGameById_(asId_(payload.quizGameId));
    if (!game) throw new Error('クイズが見つかりません。');
    if (game.mode !== 'OFFLINE') throw new Error('オフラインクイズではありません。');
    if (game.expiresAt.getTime() <= Date.now()) throw new Error('このクイズの保存期間は終了しました。');
    const questions = getQuizQuestionRows_(game.gameId);
    if (questions.length !== QUIZ_QUESTION_COUNT_) throw new Error('問題データが揃っていません。');

    payload.totalAnswerTimeMs = 0;
    if (game.genre === 'LYRICS') return saveOfflineLyricsQuizResults_(game, questions, payload);
    return saveOfflineProfileQuizResultsFinal_(game, questions, payload);
  });
}

function saveOfflineProfileQuizResultsFinal_(game, questions, payload) {
  const players = Array.isArray(game.players) ? game.players.map(String) : [];
  if (players.length < 2 || players.length > 3) throw new Error('プレイヤー情報が正しくありません。');
  const awards = Array.isArray(payload.awards) ? payload.awards : [];
  if (awards.length < questions.length) throw new Error('10問すべて採点してください。');

  const scores = {};
  const detailsByPlayer = {};
  players.forEach(function(id) { scores[id] = 0; detailsByPlayer[id] = []; });

  questions.forEach(function(question, index) {
    const award = awards[index] || {};
    const winner = String(award.profileWinner || '');
    if (winner && players.indexOf(winner) < 0) throw new Error('正解者が参加プレイヤーに含まれていません。');
    if (winner) scores[winner] += 1;
    players.forEach(function(id) {
      detailsByPlayer[id].push({
        questionNo: question.number,
        type: question.type,
        winnerUserId: winner,
        awarded: winner === id,
        correctValue: question.correct && question.correct.value != null ? String(question.correct.value) : '',
        correctLabel: question.correct && question.correct.label != null ? String(question.correct.label) : ''
      });
    });
  });

  players.forEach(function(id) {
    if (!findQuizResult_(game.gameId, id)) {
      saveQuizUserResult_(game, id, scores[id], 0, detailsByPlayer[id]);
    }
  });

  return {
    ok: true,
    maxScore: QUIZ_QUESTION_COUNT_,
    scoreboard: buildQuizScoreboard_(game)
  };
}
