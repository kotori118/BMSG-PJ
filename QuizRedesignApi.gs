const QUIZ_V2_LYRICS_LIMIT_MS_ = 30000;
const QUIZ_V2_PROFILE_LIMIT_MS_ = 20000;

function getQuizBootstrapV2(userId, requestedRoomId) {
  const uid = validateQuizUser_(userId);
  cleanupExpiredQuizGames_();
  const response = { users: getQuizUsers_(), courses: getQuizCourses_(), room: null };
  const roomId = String(requestedRoomId || '').replace(/\D/g, '');
  if (roomId) response.room = getQuizGameByRoomV2_(uid, roomId);
  return response;
}

function createQuizGameV2(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  const mode = validateQuizEnum_(payload.mode, QUIZ_MODES_, 'MODE');
  const genre = validateQuizEnum_(payload.genre, QUIZ_GENRES_, 'GENRE');
  const course = validateQuizEnum_(payload.course, QUIZ_COURSES_, 'COURSE');
  const difficulty = validateQuizEnum_(payload.difficulty, QUIZ_DIFFICULTIES_, 'DIFFICULTY');
  const players = validateQuizPlayers_(mode, genre, uid, payload.playerUserIds);

  return withQuizLock_(function() {
    cleanupExpiredQuizGamesUnsafe_();
    const generated = genre === 'LYRICS'
      ? buildLyricsQuizQuestions_(course, difficulty)
      : buildProfileQuizQuestionsV2_(course, difficulty);
    if (!generated || generated.questions.length < QUIZ_QUESTION_COUNT_) {
      throw new Error('この条件では10問作れません。コースか難易度を変えてください。');
    }

    const gameId = Utilities.getUuid();
    const roomId = mode === 'ONLINE' ? createQuizRoomId_() : '';
    const createdAt = new Date();
    appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS), {
      QuizGameID: gameId,
      RoomID: roomId,
      Mode: mode,
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

function joinQuizRoomV2(userId, roomId) {
  const uid = validateQuizUser_(userId);
  cleanupExpiredQuizGames_();
  return getQuizGameByRoomV2_(uid, roomId);
}

function getQuizGameByRoomV2_(uid, roomId) {
  const id = String(roomId || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(id)) throw new Error('4桁のROOM IDを入力してください。');
  const game = findQuizGameByRoomId_(id);
  if (!game) throw new Error('有効なQUIZ ROOMが見つかりません。');
  return buildQuizGameStateV2_(game, uid);
}

function buildQuizGameStateV2_(game, uid) {
  const state = buildQuizGameState_(game, uid);
  state.ready = !state.hasAnswered;
  state.timeLimitMs = state.genre === 'LYRICS' ? QUIZ_V2_LYRICS_LIMIT_MS_ : QUIZ_V2_PROFILE_LIMIT_MS_;
  state.songCatalog = state.genre === 'LYRICS' ? getQuizSongCatalogV2_(game.course) : [];
  state.memberCatalog = state.genre === 'LYRICS' ? getQuizMemberCatalogV2_(game.course) : [];
  return state;
}

function getQuizSongCatalogV2_(course) {
  return readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.SONGS)
    .filter(function(row) { return quizCourseMatchesSong_(row, course); })
    .map(function(row) {
      return { value: asId_(row.SongID), label: String(row.Title || row.SongID), artist: String(row.Artist || '') };
    })
    .filter(function(row) { return row.value && row.label; })
    .sort(function(a, b) { return a.label.localeCompare(b.label, 'ja'); });
}

function getQuizMemberCatalogV2_(course) {
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const memberships = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const eligible = quizCourseMemberIds_(course, members, groups, memberships);
  return members.filter(function(row) { return !!eligible[asId_(row.MemberID)]; }).map(function(row) {
    return { value: asId_(row.MemberID), label: String(row.DisplayName || row.MemberID), order: Number(row.DisplayOrder || 9999) };
  }).sort(function(a, b) { return a.order - b.order || a.label.localeCompare(b.label, 'ja'); });
}

function submitQuizResultV2(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  return withQuizLock_(function() {
    const game = findQuizGameById_(asId_(payload.quizGameId));
    if (!game) throw new Error('クイズが見つかりません。');
    if (game.expiresAt.getTime() <= Date.now()) throw new Error('このクイズの保存期間は終了しました。');
    const questions = getQuizQuestionRows_(game.gameId);
    if (questions.length !== QUIZ_QUESTION_COUNT_) throw new Error('問題データが揃っていません。');

    if (game.mode === 'OFFLINE' && game.genre === 'LYRICS') {
      payload.totalAnswerTimeMs = 0;
      return saveOfflineLyricsQuizResults_(game, questions, payload);
    }

    const existing = findQuizResult_(game.gameId, uid);
    if (existing) return { ok: true, alreadySaved: true, scoreboard: buildQuizScoreboard_(game) };
    const checked = scoreQuizAnswersV2_(game, questions, payload.answers);
    const totalMs = Math.max(0, Number(payload.totalAnswerTimeMs || 0));
    saveQuizUserResult_(game, uid, checked.score, totalMs, checked.details);
    return {
      ok: true,
      alreadySaved: false,
      score: checked.score,
      maxScore: game.genre === 'LYRICS' ? 20 : 10,
      scoreboard: buildQuizScoreboard_(game)
    };
  });
}

function scoreQuizAnswersV2_(game, questions, answers) {
  const submitted = Array.isArray(answers) ? answers : [];
  if (submitted.length !== questions.length) throw new Error('10問すべて回答してください。');
  let score = 0;
  const details = [];

  questions.forEach(function(question, index) {
    const answer = submitted[index] || {};
    if (game.genre === 'PROFILE') {
      const expected = String(question.correct && question.correct.value != null ? question.correct.value : '');
      const actual = String(answer.value != null ? answer.value : '');
      const correct = !!expected && actual === expected;
      if (correct) score += 1;
      details.push({ questionNo: question.number, type: question.type, value: actual, correct: correct, timedOut: !!answer.timedOut });
      return;
    }

    const expectedSongId = String(question.correct && question.correct.songId || question.source && question.source.songId || '');
    const actualSongId = String(answer.songId || '');
    const songCorrect = !answer.timedOut && !!expectedSongId && actualSongId === expectedSongId;
    const singerIds = Array.isArray(question.source && question.source.singerIds) ? question.source.singerIds.map(String) : [];
    const actualSingerId = String(answer.singerId || '');
    const singerCorrect = songCorrect && !!actualSingerId && singerIds.indexOf(actualSingerId) >= 0;
    if (songCorrect) score += 1;
    if (singerCorrect) score += 1;
    details.push({
      questionNo: question.number,
      type: question.type,
      songId: actualSongId,
      singerId: actualSingerId,
      songCorrect: songCorrect,
      singerCorrect: singerCorrect,
      timedOut: !!answer.timedOut,
      answerTimeMs: Number(answer.answerTimeMs || 0)
    });
  });
  return { score: score, details: details };
}

function buildProfileQuizQuestionsV2_(course, difficulty) {
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const memberships = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const profiles = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.PROFILES);
  const settings = readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS));
  const eligibleIds = quizCourseMemberIds_(course, members, groups, memberships);
  const memberById = {};
  members.forEach(function(row) {
    const id = asId_(row.MemberID);
    memberById[id] = { id: id, name: String(row.DisplayName || id), order: Number(row.DisplayOrder || 9999) };
  });
  const wantedDifficulty = difficulty === 'NORMAL' ? '普通' : '上級';
  const activeSettings = settings.filter(function(row) {
    return asBoolean_(row.IsActive) && String(row.QuizDifficulty || '').trim() === wantedDifficulty;
  });
  const rows = profiles.filter(function(row) {
    const id = asId_(row.MemberID);
    return !!eligibleIds[id] && !!memberById[id];
  });
  const facts = {};
  const settingById = {};
  activeSettings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID);
    settingById[pid] = setting;
    facts[pid] = {};
    rows.forEach(function(row) {
      const memberId = asId_(row.MemberID);
      const value = formatQuizProfileValue_(row[pid], setting);
      if (value) facts[pid][memberId] = value;
    });
  });

  const pools = { PROFILE_FIELD: [], PROFILE_IDENTIFY: [], PROFILE_COMMONALITY: [], PROFILE_ODD_ONE_OUT: [], PROFILE_PAIR: [], PROFILE_MULTI_IDENTIFY: [] };
  buildProfileFieldPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_FIELD);
  buildProfileIdentifyPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_IDENTIFY);
  if (difficulty === 'ADVANCED') {
    buildProfileCommonalityPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_COMMONALITY);
    buildProfileOddPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_ODD_ONE_OUT);
    buildProfilePairPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_PAIR);
    buildProfileMultiIdentifyPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_MULTI_IDENTIFY);
  }

  Object.keys(pools).forEach(function(key) { pools[key] = quizShuffle_(pools[key]); });
  const selected = pickDiverseProfileQuestionsV2_(pools, QUIZ_QUESTION_COUNT_);
  if (selected.length < QUIZ_QUESTION_COUNT_) {
    const fallback = quizShuffle_(pools.PROFILE_FIELD.concat(pools.PROFILE_IDENTIFY));
    fallback.forEach(function(q) {
      if (selected.length < QUIZ_QUESTION_COUNT_ && !profileQuestionDuplicateV2_(selected, q)) selected.push(q);
    });
  }
  return {
    candidatePool: selected.map(function(q) { return q.type + ':' + String(q.source && q.source.key || q.text); }),
    questions: selected.slice(0, QUIZ_QUESTION_COUNT_)
  };
}

function buildProfileFieldPoolV2_(rows, memberById, settings, facts, out) {
  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID);
    const options = uniqueQuizOptions_(Object.keys(facts[pid] || {}).map(function(id) { return { value: facts[pid][id], label: facts[pid][id] }; }));
    if (options.length < 4) return;
    rows.forEach(function(row) {
      const id = asId_(row.MemberID), value = facts[pid] && facts[pid][id];
      if (!value) return;
      out.push({
        type: 'PROFILE_FIELD',
        text: memberById[id].name + 'の「' + String(setting.FieldName || pid) + '」は？',
        source: { key: id + ':' + pid, memberId: id, memberName: memberById[id].name, profileId: pid, fieldName: String(setting.FieldName || pid) },
        choices: buildQuizChoices_(options, value),
        correct: { value: value, label: value }
      });
    });
  });
}

function buildProfileIdentifyPoolV2_(rows, memberById, settings, facts, out) {
  const memberOptions = rows.map(function(row) { const id = asId_(row.MemberID); return { value: id, label: memberById[id].name }; });
  if (memberOptions.length < 4) return;
  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID), byValue = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      const value = facts[pid][id];
      if (!byValue[value]) byValue[value] = [];
      byValue[value].push(id);
    });
    Object.keys(byValue).forEach(function(value) {
      if (byValue[value].length !== 1) return;
      const id = byValue[value][0];
      out.push({
        type: 'PROFILE_IDENTIFY',
        text: '「' + String(setting.FieldName || pid) + '」が『' + value + '』なのは誰？',
        source: { key: pid + ':' + value, memberId: id, profileId: pid, fieldName: String(setting.FieldName || pid), factValue: value },
        choices: buildQuizChoices_(memberOptions, id),
        correct: { value: id, label: memberById[id].name }
      });
    });
  });
}

function buildProfileCommonalityPoolV2_(rows, memberById, settings, facts, out) {
  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID), byValue = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      const value = facts[pid][id];
      if (!byValue[value]) byValue[value] = [];
      byValue[value].push(id);
    });
    Object.keys(byValue).forEach(function(value) {
      const ids = byValue[value];
      if (ids.length < 2) return;
      const others = Object.keys(byValue).filter(function(v) { return v !== value; });
      if (others.length < 3) return;
      const pair = quizShuffle_(ids).slice(0, 2);
      const options = [{ value: value, label: value }].concat(quizShuffle_(others).slice(0, 3).map(function(v) { return { value: v, label: v }; }));
      out.push({
        type: 'PROFILE_COMMONALITY',
        text: memberById[pair[0]].name + 'と' + memberById[pair[1]].name + 'に共通する「' + String(setting.FieldName || pid) + '」は？',
        source: { key: pid + ':' + pair.join('-') + ':' + value, profileId: pid, memberIds: pair, fieldName: String(setting.FieldName || pid) },
        choices: quizShuffle_(options),
        correct: { value: value, label: value }
      });
    });
  });
}

function buildProfileOddPoolV2_(rows, memberById, settings, facts, out) {
  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID), byValue = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      const value = facts[pid][id];
      if (!byValue[value]) byValue[value] = [];
      byValue[value].push(id);
    });
    Object.keys(byValue).forEach(function(value) {
      if (byValue[value].length < 3) return;
      const otherIds = [].concat.apply([], Object.keys(byValue).filter(function(v) { return v !== value; }).map(function(v) { return byValue[v]; }));
      if (!otherIds.length) return;
      const same = quizShuffle_(byValue[value]).slice(0, 3), odd = quizShuffle_(otherIds)[0];
      const ids = quizShuffle_(same.concat([odd]));
      out.push({
        type: 'PROFILE_ODD_ONE_OUT',
        text: '「' + String(setting.FieldName || pid) + '」で仲間外れは誰？',
        source: { key: pid + ':' + same.join('-') + ':' + odd, profileId: pid, sharedValue: value, memberIds: ids },
        choices: ids.map(function(id) { return { value: id, label: memberById[id].name }; }),
        correct: { value: odd, label: memberById[odd].name }
      });
    });
  });
}

function buildProfilePairPoolV2_(rows, memberById, settings, facts, out) {
  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID), byValue = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      const value = facts[pid][id];
      if (!byValue[value]) byValue[value] = [];
      byValue[value].push(id);
    });
    const repeated = Object.keys(byValue).filter(function(v) { return byValue[v].length >= 2; });
    if (!repeated.length || rows.length < 4) return;
    repeated.forEach(function(value) {
      const correctPair = quizShuffle_(byValue[value]).slice(0, 2);
      const allIds = rows.map(function(r) { return asId_(r.MemberID); });
      const wrongPairs = [];
      for (let tries = 0; tries < 40 && wrongPairs.length < 3; tries++) {
        const pair = quizShuffle_(allIds).slice(0, 2);
        if (pair.length < 2) continue;
        const a = facts[pid] && facts[pid][pair[0]], b = facts[pid] && facts[pid][pair[1]];
        if (!a || !b || a === b) continue;
        const key = pair.slice().sort().join('|');
        if (!wrongPairs.some(function(x) { return x.value === key; })) wrongPairs.push({ value: key, label: memberById[pair[0]].name + ' × ' + memberById[pair[1]].name });
      }
      if (wrongPairs.length < 3) return;
      const correctValue = correctPair.slice().sort().join('|');
      out.push({
        type: 'PROFILE_PAIR',
        text: '「' + String(setting.FieldName || pid) + '」が同じペアは？',
        source: { key: pid + ':' + correctValue, profileId: pid, sharedValue: value },
        choices: quizShuffle_([{ value: correctValue, label: memberById[correctPair[0]].name + ' × ' + memberById[correctPair[1]].name }].concat(wrongPairs)),
        correct: { value: correctValue, label: memberById[correctPair[0]].name + ' × ' + memberById[correctPair[1]].name }
      });
    });
  });
}

function buildProfileMultiIdentifyPoolV2_(rows, memberById, settings, facts, out) {
  const memberOptions = rows.map(function(row) { const id = asId_(row.MemberID); return { value: id, label: memberById[id].name }; });
  if (memberOptions.length < 4) return;
  for (let a = 0; a < settings.length; a++) {
    for (let b = a + 1; b < settings.length; b++) {
      const pa = asId_(settings[a].ProfileID), pb = asId_(settings[b].ProfileID);
      rows.forEach(function(row) {
        const id = asId_(row.MemberID), va = facts[pa] && facts[pa][id], vb = facts[pb] && facts[pb][id];
        if (!va || !vb) return;
        const matches = rows.filter(function(r) {
          const mid = asId_(r.MemberID);
          return facts[pa] && facts[pb] && facts[pa][mid] === va && facts[pb][mid] === vb;
        });
        if (matches.length !== 1) return;
        out.push({
          type: 'PROFILE_MULTI_IDENTIFY',
          text: '「' + String(settings[a].FieldName || pa) + '」が『' + va + '』で、「' + String(settings[b].FieldName || pb) + '」が『' + vb + '』なのは誰？',
          source: { key: id + ':' + pa + ':' + pb, memberId: id, profileIds: [pa, pb] },
          choices: buildQuizChoices_(memberOptions, id),
          correct: { value: id, label: memberById[id].name }
        });
      });
    }
  }
}

function pickDiverseProfileQuestionsV2_(pools, count) {
  const result = [], types = Object.keys(pools).filter(function(type) { return pools[type].length; });
  const cursors = {};
  types.forEach(function(t) { cursors[t] = 0; });
  let lastType = '', sameRun = 0, guard = 0;
  while (result.length < count && guard++ < 200) {
    const available = types.filter(function(t) { return cursors[t] < pools[t].length && !(t === lastType && sameRun >= 2); });
    if (!available.length) break;
    const type = quizShuffle_(available)[0], q = pools[type][cursors[type]++];
    if (profileQuestionDuplicateV2_(result, q)) continue;
    result.push(q);
    if (type === lastType) sameRun += 1; else { lastType = type; sameRun = 1; }
  }
  return result;
}

function profileQuestionDuplicateV2_(list, question) {
  const key = question.type + ':' + String(question.source && question.source.key || question.text);
  return list.some(function(item) {
    return item.type + ':' + String(item.source && item.source.key || item.text) === key;
  });
}
