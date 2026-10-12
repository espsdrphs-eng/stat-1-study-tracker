import test from 'node:test';import assert from 'node:assert/strict';
import {gradingSubmissionKey} from '../src/gradingSubmission.ts';
test('same bound result is stable across random submission IDs, key order and retry date, but a changed grade is distinct',async()=>{
 const a={problem_id:'PY-2000-Q1',contract_id:'review:1:1',contract_hash:'hash',date:'2026-10-12',score_numeric:55,graded_findings:[{graded_part_id:'conclusion',resolved:false,error_type:'W'}]};
 assert.equal((await gradingSubmissionKey(a)).key,(await gradingSubmissionKey({...a,date:'2026-10-13',submission_id:'new',problem_id_confirmed:true})).key);
 assert.notEqual((await gradingSubmissionKey(a)).key,(await gradingSubmissionKey({...a,score_numeric:56})).key);
 assert.notEqual((await gradingSubmissionKey(a)).key,(await gradingSubmissionKey({...a,contract_id:'review:2:1'})).key);
});
