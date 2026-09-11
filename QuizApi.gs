const QUIZ_USERS_ = Object.freeze(['U001', 'U002', 'U003']);
const QUIZ_MODES_ = Object.freeze(['ONLINE', 'OFFLINE']);
const QUIZ_GENRES_ = Object.freeze(['LYRICS', 'PROFILE']);
const QUIZ_COURSES_ = Object.freeze(['BE:FIRST', 'MAZZEL', 'STARGLOW', 'HANA', 'UNIT', 'ALL']);
const QUIZ_DIFFICULTIES_ = Object.freeze(['NORMAL', 'ADVANCED']);
const QUIZ_QUESTION_COUNT_ = 10;
const QUIZ_RETENTION_MS_ = 30 * 24 * 60 * 60 * 1000;
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
      const expiresAt = new Date(game.ExpiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > Date.now()) {
        response.room = buildQuizGameStateV2_(game, uid);
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
  const players = validateQuizPlayers_(mode, genre, uid, payload.playerUserIds);

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

function joinQuizRoom(userId, roomId) {
  const uid = validateQuizUser_(userId);
  cleanupExpiredQuizGames_();
  return getQuizGameByRoomV2_(uid, roomId);
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

    if (game.mode === 'OFFLINE' && game.genre === 'LYRICS') {
      payload.totalAnswerTimeMs = 0;
      return saveOfflineLyricsQuizResults_(game, questions, payload);
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

function buildQuizGameState_(game, uid) {
  if (!game) throw new Error('クイズが見つかりません。');
  const result = findQuizResult_(game.gameId, uid);
  return {
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
}

function getQuizGameByRoom_(uid, roomId) {
  const id = String(roomId || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(id)) throw new Error('4桁のROOM IDを入力してください。');
  const game = findQuizGameByRoomId_(id);
  if (!game) throw new Error('有効なQUIZ ROOMが見つかりません。');
  return buildQuizGameState_(game, uid);
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
  players.forEach(function(id) { saveQuizUserResult_(game, id, playerMap[id], Number(payload.totalAnswerTimeMs || 0), detailsByUser[id]); });
  return { ok: true, alreadySaved: false, scoreboard: buildQuizScoreboard_(game) };
}

function saveQuizUserResult_(game, uid, score, totalMs, details) {
  const now = new Date();
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS), { QuizGameID: game.gameId, UserID: uid, Score: score, TotalAnswerTimeMs: Math.max(0, Math.round(totalMs || 0)), AnswerDetailsJSON: JSON.stringify(details || []), AnsweredAt: now });
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_SCORES), { QuizScoreID: Utilities.getUuid(), SourceGameID: game.gameId, UserID: uid, Mode: game.mode, Genre: quizGenreStorage_(game.genre), Course: quizCourseStorage_(game.course), Difficulty: quizDifficultyStorage_(game.difficulty), Score: score, PlayedAt: now });
  appendByHeaders_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.RECENT_ACTIVITIES), { ActivityID: Utilities.getUuid(), UserID: uid, ActivityType: 'PLAY_QUIZ', TargetID: game.gameId, OccurredAt: now });
}

function buildQuizScoreboard_(game) {
  const users = getQuizUsers_().reduce(function(map, user) { map[user.userId] = user.displayName; return map; }, {});
  const rows = getQuizResultRows_(game.gameId).map(function(row) { return { userId: asId_(row.UserID), displayName: users[asId_(row.UserID)] || asId_(row.UserID), score: Number(row.Score || 0), answerTimeMs: Number(row.TotalAnswerTimeMs || 0), answeredAt: quizIso_(row.AnsweredAt) }; });
  rows.sort(function(a, b) { return b.score - a.score || a.answerTimeMs - b.answerTimeMs || a.userId.localeCompare(b.userId); });
  let lastScore = null;
  rows.forEach(function(row, index) { row.rank = lastScore === row.score ? rows[index - 1].rank : index + 1; lastScore = row.score; });
  return rows;
}

function getQuizResultRows_(gameId) { return readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_RESULTS)).filter(function(row) { return asId_(row.QuizGameID) === gameId; }); }
function findQuizResult_(gameId, uid) { return getQuizResultRows_(gameId).find(function(row) { return asId_(row.UserID) === uid; }); }

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

function createQuizRoomId_() {
  const used = {};
  readSheetObjects_(getLogSheet_(UNIVERSE_CONFIG.SHEETS.QUIZ_ROOMS)).forEach(function(row) { if (row.RoomID !== '') used[String(row.RoomID || '').padStart(4, '0')] = true; });
  for (let i = 0; i < 100; i++) { const id = String(Math.floor(1000 + Math.random() * 9000)); if (!used[id]) return id; }
  throw new Error('ROOM IDを発行できませんでした。');
}

function validateQuizPlayers_(mode, genre, uid, values) {
  if (!(mode === 'OFFLINE' && genre === 'LYRICS')) return [uid];
  const players = Array.isArray(values) ? values.map(validateQuizUser_).filter(function(id, index, all) { return all.indexOf(id) === index; }) : [];
  if (players.length < 2 || players.length > 3) throw new Error('歌詞OFFLINEは2〜3人を選択してください。');
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
