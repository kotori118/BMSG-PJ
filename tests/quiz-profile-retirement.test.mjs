import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('legacy profile quiz generator is removed',()=>{
  assert.equal(fs.existsSync(path.join(root,'QuizProfileGenerator.gs')),false);
  assert.doesNotMatch(read('QuizApi.gs'),/buildProfileQuizQuestions_|saveOfflineProfileQuizResults_|QUIZ_PROFILE_LIMIT_MS_/);
});
test('only lyrics quiz can be created and old profile sessions cannot resume',()=>{
  const api=read('QuizApi.gs');
  const repo=read('QuizRepository.gs');
  assert.match(api,/QUIZ_GENRES_\s*=\s*Object\.freeze\(\['LYRICS'\]\)/);
  assert.match(api,/genre = validateQuizEnum_\(payload\.genre, QUIZ_GENRES_/);
  assert.match(api,/if \(game\.genre !== 'LYRICS'\) throw new Error/);
  assert.match(api,/buildLyricsQuizQuestions_\(course, difficulty\)/);
  assert.match(repo,/game\.genre === 'LYRICS'/);
  assert.match(api,/getQuizScoreboard\(userId, quizGameId\)/);
});
test('profile quiz screens are removed, lyrics game and both modes remain',()=>{
  for(const page of ['QuizSetup.html','QuizPlay.html']){
    assert.doesNotMatch(read(page),/プロフィール|PROFILE|renderOfflineProfileBody_|renderProfileBodyV3_/);
    const code=read(page).match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(code,'missing script: '+page);
    assert.doesNotThrow(()=>new vm.Script(code[1]));
  }
  const setup=read('QuizSetup.html');
  const play=read('QuizPlay.html');
  assert.match(setup,/quizSetting_\('モード'/);
  assert.match(setup,/quizSetting_\('難易度'/);
  assert.match(play,/renderOnlineLyricsBodyV3_/);
  assert.match(play,/renderOfflineLyricsBodyV3_/);
  assert.match(play,/awardOfflineLyrics_/);
  assert.match(read('QuizLyricsGenerator.gs'),/buildLyricsQuizQuestions_/);
});
test('quiz APIs no longer depend on ProfileSettings, but historical data stays',()=>{
  const api=read('QuizApi.gs');
  assert.doesNotMatch(api,/PROFILE_SETTINGS|readAnalysisProfile|buildProfileQuizQuestions_/);
  assert.match(read('QuizRepository.gs'),/saveQuizUserResult_/);
  assert.match(read('QuizApi.gs'),/function buildQuizScoreboard_\(/);
});
