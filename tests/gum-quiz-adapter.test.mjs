import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const base=path.resolve(import.meta.dirname,'..');
const read=(f)=>fs.readFileSync(path.join(base,f),'utf8');
function scene(){
  const history={
    source:JSON.stringify({songId:'1028',title:'Masterplan',artist:'BE:FIRST',singerIds:['101','102'],memberId:'101'}),
    choices:JSON.stringify({songs:[{value:'1028',label:'Masterplan'}],singers:[{value:'101|102',label:'SOTA / SHUNTO'},{value:'102',label:'SHUNTO'}]}),
    correct:JSON.stringify({songId:'1028',singerValue:'101|102'})
  };
  const records=[{QuizGameID:'g-1',QuestionNo:1,QuestionType:'LYRICS',QuestionText:'test',SourceRefJSON:history.source,ChoicesJSON:history.choices,CorrectAnswerJSON:history.correct}];
  const ctx={
    UNIVERSE_CONFIG:{SHEETS:{QUIZ_QUESTIONS:'QuizQuestions',MEMBERS:'Members'}},
    getLogSheet_:()=>({}),
    readSheetObjects_:()=>records,
    readCoreSheetObjects_:()=>[{MemberID:'M101'},{MemberID:'M102'}],
    asId_:(x)=>String(x??'').trim(),
    quizParseJson_:(s,fallback)=>{try{return JSON.parse(s)}catch{return fallback}}
  };
  vm.createContext(ctx);
  vm.runInContext(read('QuizRepository.gs'),ctx);
  return {ctx,history};
}
test('existing quiz historical JSON is adapted on read, with stored JSON unchanged',()=>{
  const {ctx,history}=scene(),before=JSON.stringify(history),questions=ctx.getQuizQuestionRows_('g-1');
  assert.equal(questions.length,1);
  const q=questions[0];
  assert.equal(q.source.songId,'1028'); // SongIDs never change
  assert.deepEqual(Array.from(q.source.singerIds),['M101','M102']);
  assert.equal(q.source.memberId,'M101');
  assert.equal(q.correct.singerValue,'M101|M102');
  assert.deepEqual(Array.from(q.choices.singers,c=>c.value),['M101|M102','M102']);
  assert.equal(JSON.stringify(history),before);
});
test('new singer parsing accepts M IDs and legacy number strings',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(read('QuizApi.gs'),ctx);
  const names={M101:'SOTA',M102:'SHUNTO'};
  assert.deepEqual(Array.from(ctx.parseQuizSingerIds_('M101,M102',names)),['M101','M102']);
  assert.deepEqual(Array.from(ctx.parseQuizSingerIds_('101,102',names)),['M101','M102']);
  assert.deepEqual(Array.from(ctx.parseQuizSingerIds_('99,109',names)),[]);
});
