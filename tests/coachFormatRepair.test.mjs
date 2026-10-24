import test from 'node:test';
import assert from 'node:assert/strict';
import * as repair from '../src/coachFormatRepair.ts';
import {parseCoachUpdate} from '../src/coachDiagnosis.ts';
const reply=()=>({coach_update:{schema_version:'stat1-coach-v2',review_context_version:'ctx',data_version:'facts',evidence_cutoff_attempt_id:338,reviewed_at:'2026-10-24T05:45:00+09:00',level:{value:2.5,readiness:'本番再測定待ち',confidence:'medium',refs:['metric:selectedThree','metric:timed','session:9']},bottleneck:{text:'計算の完遂',refs:['attempt:338']},improvements:[],ability_profiles:[{id:'variance-completion',name:'分散の完結',state:'needs_practice',goal:'最終値まで求める',next:'別設定で確認',sources:[{attempt_id:338,part_ids:['first_step','major_calculation']}]}],actions:[],unknowns:[]}});
const broken=()=>JSON.stringify(reply()).replace('["metric:selectedThree","metric:timed","session:9"]','"metric:selectedThree","metric:timed","session:9"').replace('["first_step","major_calculation"]','"first_step","major_calculation"').replace('"improvements":[]','"improvements":');

test('repair proposal separates mechanical array delimiters from a missing judgment',()=>{
 const raw=broken(),p=repair.proposeCoachJsonRepair(raw);assert.equal(p.missingImprovements,true);assert.equal(p.changes.length,3);
 assert.deepEqual(JSON.parse(p.json),reply());assert.equal(raw,broken());
 assert.throws(()=>parseCoachUpdate(raw),'normal parser remains strict');
 assert.throws(()=>repair.resolveCoachImport({text:raw,format_recovery:{confirmed:true}}),/改善点.*確認/);
 const r=repair.resolveCoachImport({text:raw,format_recovery:{confirmed:true,empty_improvements:true}});
 assert.equal(r.originalText,raw);assert.equal(parseCoachUpdate(r.text).level.value,2.5);assert.match(r.note,/本人確認/);
});
test('unconfirmed repairs never silently enter the normal import route',()=>{
 const raw=broken();assert.equal(repair.resolveCoachImport({text:raw}).text,raw);
 assert.throws(()=>repair.resolveCoachImport({text:raw,format_recovery:{confirmed:false}}),/確認/);
});
test('only known compact coach refs/part_ids are repairable; quoted prose, LaTeX, score and context remain exact',()=>{
 const wire=reply();wire.coach_update.bottleneck.text='数式 \\[x\\]、引用 “条件”、文字列 "refs":"x","y" は変更しない';
 const raw=JSON.stringify(wire).replace('"refs":["attempt:338"]','"refs":"attempt:338"'),p=repair.proposeCoachJsonRepair(raw);
 assert.equal(p.missingImprovements,false);assert.deepEqual(JSON.parse(p.json),wire);assert.equal(p.changes.length,1);
 const resolved=repair.resolveCoachImport({text:raw,format_recovery:{confirmed:true}});assert.equal(resolved.originalText,raw);
 assert.equal(repair.proposeCoachJsonRepair(JSON.stringify(wire)),null);
});
test('unknown empty values, arbitrary fields, duplicate keys, extra documents and wrong schema cannot be repaired',()=>{
 for(const raw of [broken().replace('"value":2.5','"value":'),broken().replace('"actions":[]','"actions":"x","y"'),broken().replace('"value":2.5','"value":2.5,"value":4'),broken()+'{}',broken().replace('stat1-coach-v2','stat1-coach-v1'),'{"study_update":{"refs":"a","b"}}'])assert.throws(()=>repair.proposeCoachJsonRepair(raw));
});
test('generated prompts avoid malformed negative examples that can be copied back',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile('src/coachDiagnosis.ts','utf8');
 assert.doesNotMatch(source,/誤例："refs":"metric:selectedThree","metric:timed"/);
});
