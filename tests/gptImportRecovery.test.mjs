import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as syntax from '../src/jsonSyntax.ts';
import * as coach from '../src/coachDiagnosis.ts';
import {parseStructuredStudyText} from '../src/importParser.ts';
import {transferJson} from '../src/generatedTransfer.ts';

const p={problem_id:'PY-2021-Q4',source_type:'past_exam',year:2021,problem_number:4,title:'2021年問4',theme:'統計数理'};
const grading={study_update:{problem_id:p.problem_id,date:'2026-10-22',mode:'full',mark:'△',score_numeric:45,error_type:'W',error_point:'最終結論が未完',next_action:'未完の小問を再確認',review_after_days:3,uncertain_points:['条件 “A” の判読は保留'],memo:'LaTeX \\[x\\] / 引用 “値” / [1,2]'}};
const curly=s=>s.replace(/"((?:\\.|[^"\\])*)"/g,'“$1”');
const reply=()=>({coach_update:{schema_version:'stat1-coach-v2',review_context_version:'ctx',data_version:'facts',evidence_cutoff_attempt_id:1,reviewed_at:'2026-10-22T12:00:00+09:00',level:{value:2.5,readiness:'本番再測定待ち',confidence:'medium',refs:['metric:selectedThree','metric:timed']},bottleneck:{text:'計算の完遂',refs:['attempt:1']},improvements:[],actions:[],unknowns:[]}});

test('grading JSON uses the same lossless quote and Markdown-bracket normalization as assessment',()=>{
 const source=curly(JSON.stringify(grading)).replace('“uncertain_points”:[','“uncertain_points”:\\[').replace('保留”]','保留”\\]');
 const before=JSON.stringify(grading),r=parseStructuredStudyText(source,[p]);
 assert.equal(r.updates.length,1);assert.equal(r.updates[0].score_numeric,45);
 assert.equal(r.updates[0].raw_import_data.memo,grading.study_update.memo);
 assert.equal(r.updates[0].raw_import_data.uncertain_points[0],grading.study_update.uncertain_points[0]);
 assert.equal(JSON.stringify(grading),before);
});

test('only outside-string bracket escapes normalize; mathematical strings and missing data are untouched',()=>{
 assert.equal(typeof syntax.normalizeCompatibleJson,'function');
 const raw='{“a”:\\[“x”\\],“text”:“数式 \\\\[x\\\\] と [1]”}';
 const r=syntax.normalizeCompatibleJson(raw);assert.equal(r.normalized,true);
 assert.deepEqual(JSON.parse(r.json),{a:['x'],text:'数式 \\[x\\] と [1]'});
 assert.throws(()=>JSON.parse(syntax.normalizeCompatibleJson('{“improvements”: ,“refs”:"x","y"}').json));
});

test('orphan evidence strings report the array field, not a fabricated key named metric:timed',()=>{
 const invalid=JSON.stringify(reply()).replace('["metric:selectedThree","metric:timed"]','"metric:selectedThree","metric:timed"');
 assert.throws(()=>coach.parseCoachUpdate(invalid),e=>e.stage==='parse'&&e.path==='coach_update.level.refs'&&/配列/.test(e.reason));
});

test('assessment never fills absent improvements or accepts scalar refs or scalar part IDs',()=>{
 const r=reply(),json=JSON.stringify(r);
 assert.throws(()=>coach.parseCoachUpdate(json.replace('"improvements":[]','"improvements":')));
 for(const mutate of [u=>u.level.refs='metric:timed',u=>u.ability_profiles=[{id:'operation',name:'操作',state:'needs_practice',goal:'完遂',next:'別設定',sources:[{attempt_id:1,part_ids:'major_calculation'}]}]]){
  const bad=structuredClone(r);mutate(bad.coach_update);assert.throws(()=>coach.parseCoachUpdate(JSON.stringify(bad)));
 }
 const good=coach.parseCoachUpdate(curly(json));assert.equal(good.level.value,2.5);assert.deepEqual(good.improvements,[]);
});

test('assessment and grading replies explain the correct tab instead of being misclassified',()=>{
 assert.throws(()=>parseStructuredStudyText(JSON.stringify(reply()),[p]),/総合評価/);
 assert.throws(()=>coach.parseCoachUpdate(JSON.stringify(grading)),/GPT結果|JSON/);
});

test('generated problem JSON uses identical copy/paste compatibility without overriding quality checks',()=>{
 const text='{“surface_features”:\\[“別設定”,“同じ操作”\\],“self_check”:{“solution_correct”:{“pass”:false}},“problem_text”:“数式 \\\\[x\\\\] と引用 “条件””}';
 const r=transferJson(text);assert.deepEqual(r.surface_features,['別設定','同じ操作']);assert.equal(r.self_check.solution_correct.pass,false);assert.equal(r.problem_text,'数式 \\[x\\] と引用 “条件”');
 assert.throws(()=>transferJson('{“self_check”:{“pass”: }}'));
});

test('repair request keeps the exact original separately and requires missing facts to be confirmed, not invented',()=>{
 assert.equal(typeof coach.buildCoachRecoveryPrompt,'function');
 const raw='{ “improvements”: , “refs”: "metric:timed", "session:9" }';
 const prompt=coach.buildCoachRecoveryPrompt({rawText:raw,error:'coach_update.level.refs：配列が必要',reviewPrompt:'CURRENT-FACT-AND-CONTRACT'});
 assert.ok(prompt.includes(JSON.stringify(raw)));assert.match(prompt,/CURRENT-FACT-AND-CONTRACT/);
 assert.match(prompt,/推測|捏造/);assert.match(prompt,/不足.*確認|確認.*不足/);
 assert.match(prompt,/JSON/);assert.doesNotMatch(prompt,/APIキー/);
});

test('assessment UI persists drafts and offers raw-only retention and a correction prompt without applying grades',async()=>{
 const ui=await readFile('src/LearningDashboard.tsx','utf8');
 assert.match(ui,/stat1:coach-import-draft:v1/);assert.match(ui,/修正依頼をコピー/);
 assert.match(ui,/RawGPTArchive/);assert.match(ui,/原文だけを保管/);
});
