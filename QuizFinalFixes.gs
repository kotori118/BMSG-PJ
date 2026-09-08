function createQuizGameFinal(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  const mode = validateQuizEnum_(payload.mode, QUIZ_MODES_, 'MODE');
  const genre = validateQuizEnum_(payload.genre, QUIZ_GENRES_, 'GENRE');
  const difficulty = validateQuizEnum_(payload.difficulty, QUIZ_DIFFICULTIES_, 'DIFFICULTY');
  const course = genre === 'PROFILE' ? 'ALL' : validateQuizEnum_(payload.course, QUIZ_COURSES_, 'COURSE');
  const players = validateQuizPlayers_(mode, genre, uid, payload.playerUserIds);

  return withQuizLock_(function() {
    cleanupExpiredQuizGamesUnsafe_();
    const generated = genre === 'LYRICS'
      ? buildLyricsQuizQuestions_(course, difficulty)
      : buildProfileQuizQuestionsFinal_(difficulty);
    if (!generated || generated.questions.length < QUIZ_QUESTION_COUNT_) {
      throw new Error('この条件では10問作れません。難易度を変えてください。');
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

function buildProfileQuizQuestionsFinal_(difficulty) {
  const members = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.MEMBERS);
  const groups = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUPS);
  const memberships = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.GROUP_MEMBERS);
  const profiles = readCoreSheetObjects_(UNIVERSE_CONFIG.SHEETS.PROFILES);
  const settings = readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.PROFILE_SETTINGS));
  const eligibleIds = quizCourseMemberIds_('ALL', members, groups, memberships);
  const memberById = {};
  members.forEach(function(row) {
    const id = asId_(row.MemberID);
    if (id) memberById[id] = { id: id, name: String(row.DisplayName || id), order: Number(row.DisplayOrder || 9999) };
  });

  const wantedDifficulty = difficulty === 'NORMAL' ? '普通' : '上級';
  const activeSettings = settings.filter(function(row) {
    return asBoolean_(row.IsActive) && String(row.QuizDifficulty || '').trim() === wantedDifficulty;
  });
  const scalarSettings = activeSettings.filter(function(row) { return !asBoolean_(row.IsMultiValue); });
  const multiSettings = activeSettings.filter(function(row) { return asBoolean_(row.IsMultiValue); });
  const rows = profiles.filter(function(row) {
    const id = asId_(row.MemberID);
    return !!eligibleIds[id] && !!memberById[id];
  });

  const facts = {};
  activeSettings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID);
    facts[pid] = {};
    rows.forEach(function(row) {
      const memberId = asId_(row.MemberID);
      const value = formatQuizProfileValue_(row[pid], setting);
      if (value) facts[pid][memberId] = value;
    });
  });

  const pools = {
    PROFILE_FIELD: [],
    PROFILE_IDENTIFY: [],
    PROFILE_TOKEN_IDENTIFY: [],
    PROFILE_COMMONALITY: [],
    PROFILE_ODD_ONE_OUT: [],
    PROFILE_PAIR: [],
    PROFILE_MULTI_IDENTIFY: []
  };

  buildProfileFieldPoolV2_(rows, memberById, activeSettings, facts, pools.PROFILE_FIELD);
  buildProfileIdentifyPoolV2_(rows, memberById, scalarSettings, facts, pools.PROFILE_IDENTIFY);
  buildProfileTokenIdentifyPoolFinal_(rows, memberById, multiSettings, facts, pools.PROFILE_TOKEN_IDENTIFY);

  if (difficulty === 'ADVANCED') {
    buildProfileCommonalityPoolV2_(rows, memberById, scalarSettings, facts, pools.PROFILE_COMMONALITY);
    buildProfileOddPoolV2_(rows, memberById, scalarSettings, facts, pools.PROFILE_ODD_ONE_OUT);
    buildProfilePairPoolV2_(rows, memberById, scalarSettings, facts, pools.PROFILE_PAIR);
    buildProfileMultiIdentifyPoolV2_(rows, memberById, scalarSettings, facts, pools.PROFILE_MULTI_IDENTIFY);
  }

  Object.keys(pools).forEach(function(type) { pools[type] = quizShuffle_(pools[type]); });
  const selected = pickProfileQuestionsFinal_(pools, QUIZ_QUESTION_COUNT_);
  return {
    candidatePool: selected.map(function(q) { return profileSemanticKeyFinal_(q); }),
    questions: selected.slice(0, QUIZ_QUESTION_COUNT_)
  };
}

function splitProfileTokensFinal_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return [];
  const seen = {};
  return text.split(/[、,，\/／|｜;；\n\r]+/).map(function(v) { return v.trim(); }).filter(function(v) {
    if (!v || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

function buildProfileTokenIdentifyPoolFinal_(rows, memberById, settings, facts, out) {
  const memberOptions = rows.map(function(row) {
    const id = asId_(row.MemberID);
    return { value: id, label: memberById[id].name };
  });
  if (memberOptions.length < 4) return;

  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID);
    const byToken = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      splitProfileTokensFinal_(facts[pid][id]).forEach(function(token) {
        if (!byToken[token]) byToken[token] = [];
        if (byToken[token].indexOf(id) < 0) byToken[token].push(id);
      });
    });
    Object.keys(byToken).forEach(function(token) {
      const ids = byToken[token];
      if (ids.length !== 1) return;
      const id = ids[0];
      out.push({
        type: 'PROFILE_TOKEN_IDENTIFY',
        text: '「' + String(setting.FieldName || pid) + '」に『' + token + '』を含むのは誰？',
        source: {
          key: id + ':' + pid + ':' + token,
          memberId: id,
          profileId: pid,
          fieldName: String(setting.FieldName || pid),
          factToken: token
        },
        choices: buildQuizChoices_(memberOptions, id),
        correct: { value: id, label: memberById[id].name }
      });
    });
  });
}

function profileSemanticKeyFinal_(question) {
  const q = question || {};
  const source = q.source || {};
  const memberId = String(source.memberId || '');
  const profileId = String(source.profileId || '');
  if ((q.type === 'PROFILE_FIELD' || q.type === 'PROFILE_IDENTIFY') && memberId && profileId) {
    return 'FACT:' + memberId + ':' + profileId;
  }
  if (q.type === 'PROFILE_TOKEN_IDENTIFY' && memberId && profileId) {
    return 'FACTTOKEN:' + memberId + ':' + profileId + ':' + String(source.factToken || '');
  }
  return q.type + ':' + String(source.key || q.text || '');
}

function pickProfileQuestionsFinal_(pools, count) {
  const result = [];
  const used = {};
  const types = Object.keys(pools).filter(function(type) { return pools[type] && pools[type].length; });
  const cursors = {};
  types.forEach(function(type) { cursors[type] = 0; });
  let lastType = '';
  let sameRun = 0;
  let guard = 0;

  while (result.length < count && guard++ < 500) {
    const available = types.filter(function(type) {
      return cursors[type] < pools[type].length && !(type === lastType && sameRun >= 2);
    });
    if (!available.length) break;
    const type = quizShuffle_(available)[0];
    const q = pools[type][cursors[type]++];
    const key = profileSemanticKeyFinal_(q);
    if (used[key]) continue;
    used[key] = true;
    result.push(q);
    if (type === lastType) sameRun += 1;
    else { lastType = type; sameRun = 1; }
  }

  if (result.length < count) {
    const fallback = quizShuffle_([].concat.apply([], types.map(function(type) { return pools[type]; })));
    fallback.forEach(function(q) {
      if (result.length >= count) return;
      const key = profileSemanticKeyFinal_(q);
      if (used[key]) return;
      used[key] = true;
      result.push(q);
    });
  }
  return result;
}
