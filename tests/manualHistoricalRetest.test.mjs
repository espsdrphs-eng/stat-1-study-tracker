import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as planning from '../src/pastExamPlanning.ts';

const catalog=[2024,2025].flatMap(year=>[1,2,3,4,5].map(questionNumber=>({year,questionNumber,canonicalProblemId:`PY-${year}-Q${questionNumber}`,simulationProtected:true,availability:'verified_problem',schedulable:true,gradable:true,exposure:'unseen',fineConceptIds:[]})));
const args={catalog,attempts:[],pastSessions:[],today:'2026-11-06',daysRemaining:9};

test('2025 manual retest requires explicit consent and never unlocks Planner or clean evidence',()=>{
 assert.equal(typeof planning.manuallySelectedPastExamYear,'function');
 const before=JSON.stringify(args),automatic=planning.buildPastExamYearCandidates(args);
 assert.equal(automatic.some(c=>c.year===2025),false);
 const candidate=planning.manuallySelectedPastExamYear({...args,year:2025,confirmed:true});
 assert.equal(candidate.year,2025);assert.equal(candidate.yearRole,'historical_retest');assert.equal(candidate.cleanScanEligible,false);
 assert.deepEqual(candidate.eligibleRows.map(p=>p.canonicalProblemId),[1,2,3,4,5].map(q=>`PY-2025-Q${q}`));
 assert.equal(JSON.stringify(args),before);assert.deepEqual(planning.buildPastExamYearCandidates(args),automatic);
 assert.equal(planning.manuallySelectedPastExamYear({...args,year:2025,confirmed:false}),undefined);
 for(const year of [2024,2026])assert.equal(planning.manuallySelectedPastExamYear({...args,year,confirmed:true}),undefined);
});

test('manual retest cannot bypass missing, non-gradable or duplicate question records',()=>{
 assert.equal(typeof planning.manuallySelectedPastExamYear,'function');
 for(const rows of [catalog.filter(p=>p.canonicalProblemId!=='PY-2025-Q5'),catalog.map(p=>p.canonicalProblemId==='PY-2025-Q5'?{...p,gradable:false}:p),catalog.map(p=>p.canonicalProblemId==='PY-2025-Q5'?{...p,questionNumber:4}:p)])
  assert.equal(planning.manuallySelectedPastExamYear({...args,catalog:rows,year:2025,confirmed:true}),undefined);
});

test('year workspace offers an explicit 2025 practice start without changing recommended eligibility',async()=>{
 const text=await readFile('src/PastExamResults.tsx','utf8');
 assert.match(text,/confirmHistoricalRetest/);assert.match(text,/2025年を再演習として開始/);assert.match(text,/type="checkbox"/);
 assert.doesNotMatch(text,/eligibleYears\.push/);
});
