function buildProfileQuizQuestions_(difficulty) {
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

  buildProfileFieldPool_(rows, memberById, activeSettings, facts, pools.PROFILE_FIELD);
  buildProfileIdentifyPool_(rows, memberById, scalarSettings, facts, pools.PROFILE_IDENTIFY);
  buildProfileTokenIdentifyPool_(rows, memberById, multiSettings, facts, pools.PROFILE_TOKEN_IDENTIFY);

  if (difficulty === 'ADVANCED') {
    buildProfileCommonalityPool_(rows, memberById, scalarSettings, facts, pools.PROFILE_COMMONALITY);
    buildProfileOddPool_(rows, memberById, scalarSettings, facts, pools.PROFILE_ODD_ONE_OUT);
    buildProfilePairPool_(rows, memberById, scalarSettings, facts, pools.PROFILE_PAIR);
    buildProfileMultiIdentifyPool_(rows, memberById, scalarSettings, facts, pools.PROFILE_MULTI_IDENTIFY);
  }

  Object.keys(pools).forEach(function(type) { pools[type] = quizShuffle_(pools[type]); });
  const selected = pickProfileQuestions_(pools, QUIZ_QUESTION_COUNT_);
  return {
    candidatePool: selected.map(function(q) { return profileSemanticKey_(q); }),
    questions: selected.slice(0, QUIZ_QUESTION_COUNT_)
  };
}

function splitProfileTokens_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return [];
  const seen = {};
  return text.split(/[、,，\/／|｜;；\n\r]+/).map(function(v) { return v.trim(); }).filter(function(v) {
    if (!v || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

function buildProfileTokenIdentifyPool_(rows, memberById, settings, facts, out) {
  const memberOptions = rows.map(function(row) {
    const id = asId_(row.MemberID);
    return { value: id, label: memberById[id].name };
  });
  if (memberOptions.length < 4) return;

  settings.forEach(function(setting) {
    const pid = asId_(setting.ProfileID);
    const byToken = {};
    Object.keys(facts[pid] || {}).forEach(function(id) {
      splitProfileTokens_(facts[pid][id]).forEach(function(token) {
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

function profileSemanticKey_(question) {
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

function pickProfileQuestions_(pools, count) {
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
    const key = profileSemanticKey_(q);
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
      const key = profileSemanticKey_(q);
      if (used[key]) return;
      used[key] = true;
      result.push(q);
    });
  }
  return result;
}

function buildProfileFieldPool_(rows, memberById, settings, facts, out) {
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

function buildProfileIdentifyPool_(rows, memberById, settings, facts, out) {
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

function buildProfileCommonalityPool_(rows, memberById, settings, facts, out) {
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

function buildProfileOddPool_(rows, memberById, settings, facts, out) {
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

function buildProfilePairPool_(rows, memberById, settings, facts, out) {
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

function buildProfileMultiIdentifyPool_(rows, memberById, settings, facts, out) {
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
