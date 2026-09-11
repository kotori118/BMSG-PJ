const QUIZ_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const QUIZ_MODES_ = Object.freeze(['ONLINE', 'OFFLINE']);
const QUIZ_GENRES_ = Object.freeze(['LYRICS', 'PROFILE']);
const QUIZ_COURSES_ = Object.freeze(['BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA', 'UNIT', 'ALL']);
const QUIZ_DIFFICULTIES_ = Object.freeze(['NORMAL', 'ADVANCED']);
const QUIZ_QUESTION_COUNT_ = 10;
const QUIZ_LYRICS_LIMIT_MS_ = 30000;
const QUIZ_PROFILE_LIMIT_MS_ = 20000;
const QUIZ_MAJOR_ARTISTS_ = Object.freeze(['BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA']);

function getQuizBootstrap(userId, requestedRoomId) {
  const uid = validateQuizUser_(userId);
  const response = {
    users: getQuizUsers_(),
    courses: getQuizCourses_(),
    room: null
  };
  const roomId = String(requestedRoomId || '').replace(/\D/g, '');
  if (roomId) {
    const game = findQuizGameByRoomId_(roomId);
    if (game) {
      const expiresAt = new Date(game.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > Date.now()) {
        response.room = buildQuizGameState_(game, uid);
      }
    }
  }
  return response;
}

function createQuizGame(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  const mode = validateQuizEnum_(payload.mode, QUIZ_MODES_, 'MODE');
  const genre = validateQuizEnum_(payload.genre, QUIZ_GENRES_, 'GENRE');
  const difficulty = validateQuizEnum_(payload.difficulty, QUIZ_DIFFICULTIES_, 'DIFFICULTY');
  const course = genre === 'PROFILE' ? 'ALL' : validateQuizEnum_(payload.course, QUIZ_COURSES_, 'COURSE');
  const players = validateQuizPlayers_(mode, uid, payload.playerUserIds);

  return withQuizLock_(function() {
    cleanupExpiredQuizGamesUnsafe_();
    const generated = genre === 'LYRICS'
      ? buildLyricsQuizQuestions_(course, difficulty)
      : buildProfileQuizQuestions_(difficulty);
    if (!generated || generated.questions.length < QUIZ_QUESTION_COUNT_) {
      throw new Error('この条件では10問作れません。難易度を変えてください。');
    }

    const gameId = Utilities.getUuid();
    const roomId = mode === 'ONLINE' ? createQuizRoomId_() : '';
    const createdAt = new Date();
    saveQuizGameRows_({
      gameId: gameId,
      roomId: roomId,
      mode: mode,
      genre: genre,
      course: course,
      difficulty: difficulty,
      creatorUserId: uid,
      createdAt: createdAt,
      players: players
    }, generated);
    return buildQuizGameState_(findQuizGameById_(gameId), uid);
  });
}

function joinQuizRoom(userId, roomId) {
  const uid = validateQuizUser_(userId);
  cleanupExpiredQuizGames_();
  return getQuizGameByRoom_(uid, roomId);
}

function getRecentQuizRooms(userId) {
  return getRecentQuizRooms_(validateQuizUser_(userId));
}

function getQuizScoreboard(userId, quizGameId) {
  validateQuizUser_(userId);
  const game = findQuizGameById_(asId_(quizGameId));
  if (!game) throw new Error('クイズが見つかりません。');
  return buildQuizScoreboard_(game);
}

function submitQuizResult(payload) {
  payload = payload || {};
  const uid = validateQuizUser_(payload.userId);
  return withQuizLock_(function() {
    const game = findQuizGameById_(asId_(payload.quizGameId));
    if (!game) throw new Error('クイズが見つかりません。');
    if (game.expiresAt.getTime() <= Date.now()) throw new Error('このクイズの保存期間は終了しました。');
    const questions = getQuizQuestionRows_(game.gameId);
    if (questions.length !== QUIZ_QUESTION_COUNT_) throw new Error('問題データが揃っていません。');

    if (game.mode === 'OFFLINE') {
      payload.totalAnswerTimeMs = 0;
      return game.genre === 'LYRICS'
        ? saveOfflineLyricsQuizResults_(game, questions, payload)
        : saveOfflineProfileQuizResults_(game, questions, payload);
    }

    const existing = findQuizResult_(game.gameId, uid);
    if (existing) return { ok: true, alreadySaved: true, scoreboard: buildQuizScoreboard_(game) };
    const checked = scoreQuizAnswers_(game, questions, payload.answers);
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

function abandonQuizGame(userId, quizGameId) {
  validateQuizUser_(userId);
  const game = findQuizGameById_(asId_(quizGameId));
  if (!game) return { ok: true };
  if (game.mode === 'OFFLINE' && !getQuizResultRows_(game.gameId).length) {
    withQuizLock_(function() { deleteQuizGameRows_(game.gameId); });
  }
  return { ok: true };
}

function buildQuizGameState_(game, uid) {
  if (!game) throw new Error('クイズが見つかりません。');
  const result = findQuizResult_(game.gameId, uid);
  const state = {
    gameId: game.gameId,
    roomId: game.roomId,
    mode: game.mode,
    genre: game.genre,
    course: game.course,
    difficulty: game.difficulty,
    creatorUserId: game.creatorUserId,
    expiresAt: game.expiresAt.toISOString(),
    players: game.players,
    hasAnswered: !!result,
    questions: getQuizQuestionRows_(game.gameId).map(function(question) {
      return { number: question.number, type: question.type, text: question.text, source: question.source, choices: question.choices, correct: question.correct };
    }),
    scoreboard: buildQuizScoreboard_(game)
  };
  state.ready = !state.hasAnswered;
  state.timeLimitMs = state.genre === 'LYRICS' ? QUIZ_LYRICS_LIMIT_MS_ : QUIZ_PROFILE_LIMIT_MS_;
  state.songCatalog = state.genre === 'LYRICS' ? getQuizSongCatalog_(game.course) : [];
  state.memberCatalog = state.genre === 'LYRICS' ? getQuizMemberCatalog_(game.course) : [];
  return state;
}

function getQuizGameByRoom_(uid, roomId) {
  const id = String(roomId || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(id)) throw new Error('4桁のROOM IDを入力してください。');
  const game = findQuizGameByRoomId_(id);
  if (!game) throw new Error('有効なQUIZ ROOMが見つかりません。');
  return buildQuizGameState_(game, uid);
}

function scoreQuizAnswers_(game, questions, answers) {
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

function saveOfflineLyricsQuizResults_(game, questions, payload) {
  const players = game.players;
  if (players.length < 2) throw new Error('プレイヤー情報が見つかりません。');
  if (getQuizResultRows_(game.gameId).length) return { ok: true, alreadySaved: true, scoreboard: buildQuizScoreboard_(game) };
  const awards = Array.isArray(payload.awards) ? payload.awards : [];
  if (awards.length !== questions.length) throw new Error('10問すべて採点してください。');
  const playerMap = {}; players.forEach(function(id) { playerMap[id] = 0; });
  const detailsByUser = {}; players.forEach(function(id) { detailsByUser[id] = []; });
  awards.forEach(function(award, index) {
    const songWinner = asId_(award.songWinner);
    const singerWinner = asId_(award.singerWinner);
    if (songWinner && !Object.prototype.hasOwnProperty.call(playerMap, songWinner)) throw new Error('曲名の採点先が正しくありません。');
    if (singerWinner && !Object.prototype.hasOwnProperty.call(playerMap, singerWinner)) throw new Error('歌唱Memberの採点先が正しくありません。');
    if (songWinner) playerMap[songWinner] += 1;
    if (singerWinner) playerMap[singerWinner] += 1;
    players.forEach(function(id) { detailsByUser[id].push({ questionNo: index + 1, songPoint: id === songWinner ? 1 : 0, singerPoint: id === singerWinner ? 1 : 0 }); });
  });
  players.forEach(function(id) { saveQuizUserResult_(game, id, playerMap[id], 0, detailsByUser[id]); });
  return { ok: true, alreadySaved: false, scoreboard: buildQuizScoreboard_(game) };
}

function saveOfflineProfileQuizResults_(game, questions, payload) {
  const players = Array.isArray(game.players) ? game.players.map(String) : [];
  if (players.length < 2 || players.length > 3) throw new Error('プレイヤー情報が正しくありません。');
  if (getQuizResultRows_(game.gameId).length) return { ok: true, alreadySaved: true, scoreboard: buildQuizScoreboard_(game) };
  const awards = Array.isArray(payload.awards) ? payload.awards : [];
  if (awards.length !== questions.length) throw new Error('10問すべて採点してください。');

  const scores = {};
  const detailsByPlayer = {};
  players.forEach(function(id) { scores[id] = 0; detailsByPlayer[id] = []; });
  questions.forEach(function(question, index) {
    const award = awards[index] || {};
    const winner = asId_(award.profileWinner);
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
  players.forEach(function(id) { saveQuizUserResult_(game, id, scores[id], 0, detailsByPlayer[id]); });
  return { ok: true, alreadySaved: false, maxScore: QUIZ_QUESTION_COUNT_, scoreboard: buildQuizScoreboard_(game) };
}

function buildQuizScoreboard_(game) {
  const users = getQuizUsers_().reduce(function(map, user) { map[user.userId] = user.displayName; return map; }, {});
  const rows = getQuizResultRows_(game.gameId).map(function(row) { return { userId: asId_(row.UserID), displayName: users[asId_(row.UserID)] || asId_(row.UserID), score: Number(row.Score || 0), answerTimeMs: Number(row.TotalAnswerTimeMs || 0), answeredAt: quizIso_(row.AnsweredAt) }; });
  rows.sort(function(a, b) { return b.score - a.score || a.answerTimeMs - b.answerTimeMs || a.userId.localeCompare(b.userId); });
  let lastKey = null;
  rows.forEach(function(row, index) {
    const key = String(row.score) + '|' + String(row.answerTimeMs);
    row.rank = lastKey === key ? rows[index - 1].rank : index + 1;
    lastKey = key;
  });
  return rows;
}

function quizCourseMatchesSong_(row, course) {
  const artist = String(row.Artist || '').trim();
  if (course === 'ALL') return true;
  if (course === 'UNIT') return QUIZ_MAJOR_ARTISTS_.indexOf(artist) < 0;
  return artist.toUpperCase() === course;
}

function quizCourseMemberIds_(course, members, groups, memberships) {
  const result = {};
  if (course === 'ALL') { members.forEach(function(row) { const id = asId_(row.MemberID); if (id) result[id] = true; }); return result; }
  const groupIds = {};
  groups.forEach(function(row) {
    const name = String(row.GroupName || '').trim();
    if ((course === 'UNIT' && QUIZ_MAJOR_ARTISTS_.indexOf(name) < 0) || name.toUpperCase() === course) groupIds[asId_(row.GroupID)] = true;
  });
  memberships.forEach(function(row) { if (groupIds[asId_(row.GroupID)]) result[asId_(row.MemberID)] = true; });
  if (course === 'UNIT') members.forEach(function(row) { if (!asId_(row.GroupID)) result[asId_(row.MemberID)] = true; });
  return result;
}

function parseQuizSingerIds_(value, memberById) {
  return String(value || '').split(/[^0-9]+/).map(function(id) { return id.trim(); }).filter(function(id, index, all) { return id && memberById[id] && all.indexOf(id) === index; });
}

function makeQuizSnippet_(lyrics, difficulty) {
  const chars = Array.from(stripQuizWhitespace_(lyrics));
  const min = difficulty === 'NORMAL' ? 11 : 5;
  const max = difficulty === 'NORMAL' ? 20 : 10;
  const length = Math.min(chars.length, min + Math.floor(Math.random() * (max - min + 1)));
  const start = chars.length > length ? Math.floor(Math.random() * (chars.length - length + 1)) : 0;
  return chars.slice(start, start + length).join('');
}

function stripQuizWhitespace_(value) { return String(value || '').replace(/[\s　]+/g, ''); }
function formatQuizProfileValue_(value, setting) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  if (String(setting.DataType || '').toUpperCase() === 'DATE') {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年M月d日');
  }
  return String(value).trim().replace(/[\r\n]+/g, '・');
}

function buildQuizChoices_(pool, correctValue) {
  const unique = uniqueQuizOptions_(pool);
  const correct = unique.find(function(option) { return String(option.value) === String(correctValue); });
  if (!correct) throw new Error('正解候補を作成できませんでした。');
  const others = quizShuffle_(unique.filter(function(option) { return String(option.value) !== String(correctValue); })).slice(0, 3);
  if (others.length < 3) throw new Error('4択の候補を作成できませんでした。');
  return quizShuffle_([correct].concat(others));
}

function uniqueQuizOptions_(options) {
  const seen = {};
  return (options || []).filter(function(option) {
    const key = String(option.value);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function quizShuffle_(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const value = copy[i]; copy[i] = copy[j]; copy[j] = value; }
  return copy;
}

function validateQuizPlayers_(mode, uid, values) {
  if (mode !== 'OFFLINE') return [uid];
  const players = Array.isArray(values) ? values.map(validateQuizUser_).filter(function(id, index, all) { return all.indexOf(id) === index; }) : [];
  if (players.length < 2 || players.length > 3) throw new Error('オフラインは2〜3人を選択してください。');
  return players;
}

function validateQuizUser_(value) { const id = asId_(value); if (QUIZ_USERS_.indexOf(id) < 0) throw new Error('利用ユーザーを選択してください。'); return id; }
function validateQuizEnum_(value, allowed, label) { const normalized = String(value || '').trim().toUpperCase(); if (allowed.indexOf(normalized) < 0) throw new Error(label + 'を選択してください。'); return normalized; }
function quizGenreStorage_(value) { return value === 'LYRICS' ? '歌詞' : 'プロフィール'; }
function quizCourseStorage_(value) { return value === 'UNIT' ? 'ユニット' : value === 'ALL' ? '全部' : value; }
function quizDifficultyStorage_(value) { return value === 'NORMAL' ? '普通' : '上級'; }
function normalizeQuizGenre_(value) { const text = String(value || '').trim(); return text === '歌詞' ? 'LYRICS' : text === 'プロフィール' ? 'PROFILE' : text.toUpperCase(); }
function normalizeQuizCourse_(value) { const text = String(value || '').trim(); return text === 'ユニット' ? 'UNIT' : text === '全部' ? 'ALL' : text.toUpperCase(); }
function normalizeQuizDifficulty_(value) { const text = String(value || '').trim(); return text === '普通' ? 'NORMAL' : text === '上級' ? 'ADVANCED' : text.toUpperCase(); }
function getQuizUsers_() { const map = {}; readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.USERS)).forEach(function(row) { map[asId_(row.UserID)] = String(row.DisplayName || row.UserID); }); return QUIZ_USERS_.map(function(id) { return { userId: id, displayName: map[id] || id }; }); }
function getQuizCourses_() { return [{ value: 'BE:FIRST', label: 'BE:FIRST' }, { value: 'MAZZEL', label: 'MAZZEL' }, { value: 'STARGLOW', label: 'STARGLOW' }, { value: 'HANA', label: 'HANA' }, { value: 'UNIT', label: 'ユニット' }, { value: 'ALL', label: '全部' }]; }
function quizParseJson_(value, fallback) { try { const parsed = JSON.parse(String(value || '')); return parsed === null ? fallback : parsed; } catch (error) { return fallback; } }
function quizIso_(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; }
function withQuizLock_(callback) { const lock = LockService.getScriptLock(); lock.waitLock(20000); try { return callback(); } finally { lock.releaseLock(); } }