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
