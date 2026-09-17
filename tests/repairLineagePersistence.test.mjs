import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {parseStudyText} from '../src/importParser.ts';
import {db,localGet,localPost} from '../src/localDb.ts';

test('scaffold source lineage survives GPT import normalization and Attempt persistence',async()=>{
  await localGet('/api/bootstrap');
  const problems=await db.problems.toArray();
  const repairProblem=problems.find(p=>p.category==='A');
  assert.ok(repairProblem);
  const update=parseStudyText(`study_update:
  problem_id: ${repairProblem.problem_id}
  source_problem_id: PY-2021-Q3
  date: 2026-09-18
  mode: main_calc
  learning_purpose: error_repair
  actual_minutes: 7
  actual_reference_level: 0
  score_numeric: 90
  score_max: 100
  error_types: [none]
  grading_confidence: 0.95
  graded_part_ids: [major_calculation]
  graded_findings:
    - graded_part_id: major_calculation
      error_type: none
      resolved: true
      evidence: MGFを期待値の和から正しく計算した。
`,problems).updates[0];
  assert.equal(update.source_problem_id,'PY-2021-Q3');
  await localPost('/api/attempts',update);
  const saved=(await db.attempts.toArray()).filter(a=>a.problem_id===update.problem_id).at(-1);
  assert.equal(saved.source_problem_id,'PY-2021-Q3');
  assert.equal(saved.learning_purpose,'error_repair');
});
