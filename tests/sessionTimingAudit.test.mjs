import test from 'node:test';import assert from 'node:assert/strict';import {runIntegrityAudit} from '../src/integrityEngine.ts';
const audit=(sourceTime,questionTime)=>{
 const a={id:1,problem_id:'PY-2019-Q1',date:'2026-10-16',mode:'full',time_minutes:sourceTime,score_numeric:80,mark:'○',score_label:'A',error_type:'none',error_types:['none'],error_point:'',next_action:'',memo:''};
 const s={id:1,year:2019,date:'2026-10-16',session_type:'scan5',session_kind:'scan_only',scan_minutes:10,questions:[{problemId:a.problem_id,questionLabel:'問1',sourceAttemptId:1,actualScore:80,actualMinutes:questionTime,actualScoreSource:'attempt',actualMinutesSource:'attempt'}]};
 return runIntegrityAudit({attempts:[a],reviews:[],pastSessions:[s],today:'2026-10-16'}).counts.session_attempt_minutes_mismatch;
};
test('unknown session and Attempt times are equal, not zero-minute mismatches',()=>{assert.equal(audit(null,null),0);assert.equal(audit(undefined,null),0)});
test('actual time disagreements and known-versus-unknown still trigger the audit',()=>{assert.equal(audit(12,12),0);assert.equal(audit(12,13),1);assert.equal(audit(12,null),1);assert.equal(audit(null,12),1);assert.equal(audit(null,0),1)});
