import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentIssueTaskRows,studyEvidenceKind,scheduleRows,deriveWorkspaceEvidence} from '../src/studyWorkspace.ts';
import * as importParser from '../src/importParser.ts';

test('the daily navigation has five entries, with legacy pages available as secondary routes',async()=>{
 const app=await readFile('src/App.tsx','utf8');
 for(const title of ['問題・答案履歴','復習・転移','現在の課題','GPT連携'])assert.ok(app.includes(title),title);
 const navigation=await import('../src/studyWorkspace.ts').catch(()=>({}));
 assert.deepEqual(navigation.studyScreens?.map(x=>x.key),['dashboard','problems','reviews','weak','import']);
 assert.ok(app.includes('SettingsView')&&app.includes('PastView')&&app.includes('TodayView'));
});
test('evidence types do not combine generated training, post-session work, repair, retention and formal scores',()=>{
 const a={problem_id:'PY-fixture-Q1',exam_score_eligible:true,parent_past_session_id:1};
 assert.equal(studyEvidenceKind(a),'本番形式');
 assert.equal(studyEvidenceKind({...a,learning_purpose:'error_repair'}),'補修');
 assert.equal(studyEvidenceKind({...a,learning_purpose:'retrieval_check'}),'保持確認');
 assert.equal(studyEvidenceKind({...a,session_role:'counterfactual_calibration'}),'後日・選択検証');
 assert.equal(studyEvidenceKind({...a,problem_id:'GEN-fixture',source_type:'generated'}),'生成訓練');
});
test('historical completed unknown scopes are not counted as current issues, and waiting Reviews keep the earliest date',()=>{
 const d={problems:[{problem_id:'PY-2022-Q4',category:'past_exam'}],attempts:[],reviews:[
  {id:1,problem_id:'PY-2022-Q4',status:'completed',due_date:'2026-10-01'},
  {id:2,problem_id:'PY-2022-Q4',status:'pending',earliest_date:'2026-10-25',due_date:'2026-10-26',learning_purpose:'retrieval_check'}],dashboard:{today:'2026-10-20'},taskAnswerScopeOverrides:{}};
 const copy=JSON.stringify(d),r=scheduleRows(d);
 assert.equal(r[0].bucket,'done');assert.equal(r[1].waiting,true);assert.equal(r[1].earliest,'2026-10-25');
 assert.equal(JSON.stringify(d),copy);
});
test('unknown or legacy flag-only evidence cannot manufacture an ability progress graph',()=>{
 const d={problems:[],attempts:[{id:1,problem_id:'PY-fixture-Q1',date:'2026-10-18',mark:'◎',score_numeric:100,error_type:'none',transfer_evidence:true}],reviews:[],problemAliases:[],masteryByProblem:{},dashboard:{today:'2026-10-20'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 const before=JSON.stringify(d),v=deriveWorkspaceEvidence(d);
 assert.equal(v.events.length,0);assert.equal(v.timeline.length,0);assert.equal(JSON.stringify(d),before);
});
test('current issues present one card per shared ranked repair task, without inventing a skill for unknown evidence',()=>{
 const d={attempts:[],reviews:[],problems:[],problemAliases:[],masteryByProblem:{},dashboard:{today:'2026-10-20'},today:{canonicalStudyPlan:{ranked:{waiting:[]}},tasks:[
  {id:1,problem_id:'PY-fixture-Q1',learning_purpose:'error_repair',ranking:{eligible:true,rank:1}},
  {id:2,problem_id:'PY-fixture-Q2',learning_purpose:'error_repair',ranking:{eligible:true,rank:2}},
  {id:3,problem_id:'PY-fixture-Q3',learning_purpose:'error_repair',ranking:{eligible:false,rank:3}}]}};
 const copy=JSON.stringify(d),rows=currentIssueTaskRows(d);
 assert.deepEqual(rows.map(r=>r.task.id),[1,2]);assert.ok(rows.every(r=>r.sources.length===0));assert.equal(JSON.stringify(d),copy);
});
test('daily GPT input never infers grading or weaknesses from ordinary prose; structured legacy JSON/YAML still work',()=>{
 assert.equal(typeof importParser.parseStructuredStudyText,'function');
 const problems=[{problem_id:'WB-2-S-06',category:'S',source_type:'whitebook',chapter:2,problem_number:6,title:'第2章S問6',theme:'期待値'}];
 assert.throws(()=>importParser.parseStructuredStudyText('WB-2-S-06 を相談しました。80点かもしれない。保持は未確認。',problems),/構造化|原文/);
 for(const text of [JSON.stringify({study_update:{problem_id:'WB-2-S-06',score_numeric:72,error_types:['W']}}),'study_update:\n  problem_id: WB-2-S-06\n  score_numeric: 72\n  error_types: [W]']){
  const parsed=importParser.parseStructuredStudyText(text,problems);assert.equal(parsed.structured,true);assert.equal(parsed.updates[0].score_numeric,72);
 }
});
test('changing or failing to parse a GPT reply invalidates the previous unsaved grading preview without losing raw text',async()=>{
 const view=await readFile('src/AdvancedImportView.tsx','utf8');
 const parse=view.slice(view.indexOf('const parse=()=>'),view.indexOf('const change='));
 assert.match(parse,/setUpdates\(\[\]\)/);
 const input=view.slice(view.indexOf('<textarea className="paste-area"'),view.indexOf('<button className="primary wide-btn" onClick={parse}'));
 assert.match(input,/setUpdates\(\[\]\)/);
 assert.match(input,/setText\(event.target.value\)/);
});
test('completion notification has a dismiss button and is positioned away from the top navigation',async()=>{
 const app=await readFile('src/App.tsx','utf8'),css=await readFile('src/studyWorkspace.css','utf8');
 assert.match(app,/aria-label="通知を閉じる"/);assert.match(css,/\.five-screen-shell \.toast\{top:auto;bottom:/);
});
test('dashboard uses the shared Today task before readiness and has no invented mastery percentage',async()=>{
 const view=await readFile('src/LearningDashboard.tsx','utf8');
 assert.ok(view.indexOf('今日やるべき学習')>=0);
 assert.ok(view.indexOf('今日やるべき学習')<view.indexOf('現在の合格準備状況'));
 const module=await import('../src/studyWorkspace.ts').catch(()=>({}));
 assert.equal(typeof module.deriveWorkspaceEvidence,'function');
});
