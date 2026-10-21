import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {acceptGenerationDraft,acceptGenerationValidation,generationPrompt,validationPrompt,registerGeneratedProblem,validateGeneratedContent,GENERATION_CHECKS} from '../src/generatedTransfer.ts';

// Reported 10/19 scenario: the mathematics is sound, but the rubric demands
// one particular route. Keep both failed checks; never turn them into success.
const hash='4a7bd2b7e0f36c6dc23585fd0ca2c44868f8a0baa0024ab23208bf526ffe5d0e';
const lineage={key:'training:quality-recovery',rootWeaknessId:'fixture-root',rootSkillId:'fixture-operation',sourceProblemId:'PY-2018-Q5',sourceAttemptId:319,sourceFindingIds:['major_calculation'],repairAttemptId:320,retrievalAttemptId:321,matchConfidence:'high',observedFailure:'分散の最終値まで到達していない。共通原因は未確認。',successCriteria:'分散を自力で最終値まで完成する',examImpact:'high'};
const draft={problem_text:'3台の装置A、B、Cが故障したときの損失額は1、2、3万円。通常状態の確率は3/5、繁忙状態は2/5であり、状態内では独立に、それぞれ確率1/4、1/2で故障する。損失合計Lの期待値と分散を求めよ。',reference_solution:'状態を固定すると平均は6p、分散は14p(1-p)。平均21/10、分散703/200。周辺分布の直接列挙でも一致する。',grading_rubric:'状態内変動119/40、状態間変動27/50を必須として採点する（修正前の不適切なfixture）。',difficulty:'統計検定1級',estimated_minutes:12,surface_features:['共有する負荷状態','重みの異なる装置'],generator_pass_id:'3303c578-6f14-4c3a-9d52-e28247453b73'};
const record=()=>({key:lineage.key,lineage,createdAt:'2026-10-19',status:'validation_pending',rounds:[{draft:structuredClone(draft),hash}]});
const quality=()=>({draft_hash:hash,validator_pass_id:'VAL-20261019-7B41C9E2',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:!['rubric_aligned','no_shortcut'].includes(k),evidence:k==='rubric_aligned'?'正当な別解の採点保証が不十分。分布の直接列挙でも正解できる。':k==='no_shortcut'?'分散完遂は必要だが、特定の中間量は必須ではない。':'独立検算で条件・解答・対象能力との対応を確認した。'}]))});
const curly=raw=>raw.replace(/"((?:\\.|[^"\\])*)"/g,'“$1”');

test('reported smart-quote quality imports safely and preserves both failed checks, without registering',()=>{
 const r=acceptGenerationValidation(record(),curly(JSON.stringify(quality())));
 assert.equal(r.status,'requested');assert.equal(r.rounds[0].validation.checks.rubric_aligned.pass,false);assert.equal(r.rounds[0].validation.checks.no_shortcut.pass,false);
 assert.match(r.pendingReason,/採点基準/);assert.match(r.pendingReason,/別解|対象能力/);assert.throws(()=>registerGeneratedProblem(r,'GEN-failed','2026-10-19'),/PASS/);
 const q=quality();q.checks.well_defined.evidence='根拠の引用 “条件付き独立” は値の一部。変更せず保持する。';
 assert.equal(acceptGenerationValidation(record(),JSON.stringify(q)).rounds[0].validation.checks.well_defined.evidence,q.checks.well_defined.evidence);
 assert.equal(acceptGenerationValidation(record(),curly(JSON.stringify(q))).rounds[0].validation.checks.well_defined.evidence,q.checks.well_defined.evidence);
});

test('normalization never invents boolean checks, evidence or identity and gives actionable syntax errors',()=>{
 const q=quality();assert.throws(()=>acceptGenerationValidation(record(),curly(JSON.stringify({...q,draft_hash:'wrong'}))),/hash|対象/);
 assert.throws(()=>acceptGenerationValidation(record(),curly(JSON.stringify({...q,validator_pass_id:draft.generator_pass_id}))),/pass|独立/);
 q.checks.well_defined.pass='true';assert.throws(()=>acceptGenerationValidation(record(),curly(JSON.stringify(q))),/well_defined/);
 assert.throws(()=>acceptGenerationValidation(record(),'{“draft_hash”: ,“checks”:{}}'),/draft_hash.*行.*列/);
 assert.throws(()=>acceptGenerationValidation(record(),JSON.stringify(quality())+JSON.stringify(quality())),/JSON/);
});

test('actual generation and validation prompts preserve target and accept legitimate alternative methods',()=>{
 const r=acceptGenerationValidation(record(),JSON.stringify(quality())),p=generationPrompt(r,[]);
 assert.match(p,/正当な別解/);assert.match(p,/特定の公式/);assert.match(p,/未確認/);assert.ok(p.includes(draft.grading_rubric));assert.ok(p.includes(hash));assert.match(p,/rubric_aligned/);
 const vp=validationPrompt(record(),[]);assert.match(vp,/正当な別解/);assert.match(vp,/別解.*不合格.*しない/);assert.match(vp,/ASCII|U\+0022/);
});

test('rubric repair is a new immutable draft requiring fresh independent checks, not a bypass',async()=>{
 const failed=acceptGenerationValidation(record(),JSON.stringify(quality())),before=JSON.stringify(failed.rounds[0]);
 const fixed={...draft,generator_pass_id:'revised-generation',grading_rubric:'正当な別解をすべて認める。分布の直接列挙、周辺共分散、条件付き計算など、妥当な計算による分散の完遂を評価する。特定の中間量を必須としない。'};
 const r=await acceptGenerationDraft(failed,JSON.stringify(fixed));assert.equal(JSON.stringify(r.rounds[0]),before);assert.notEqual(r.rounds[1].hash,hash);
 assert.throws(()=>acceptGenerationValidation(r,JSON.stringify(quality())),/hash/);
 const check={...quality(),draft_hash:r.rounds[1].hash,validator_pass_id:'new-independent-pass',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'FIXTURE: 修正後の問題と別解の公平な採点基準を独立に再確認。'}]))};
 const ready=acceptGenerationValidation(r,curly(JSON.stringify(check))),p=registerGeneratedProblem(ready,'GEN-repaired','2026-10-19');await validateGeneratedContent(JSON.parse(JSON.stringify(p)));
 assert.equal(p.generated_transfer.evidence_strength,'training');assert.equal(p.generated_transfer.exam_score_eligible,false);
});

test('quality recovery UI explains the extra manual round, labels failures and places errors next to the action',async()=>{
 const ui=await readFile('src/TransferTrainingPanel.tsx','utf8');assert.match(ui,/修正プロンプトをコピー/);assert.match(ui,/自動.*検算|自動.*品質確認/);assert.match(ui,/qualityIssues/);assert.match(ui,/scrollIntoView/);
});
