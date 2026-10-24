import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {subscribeStudyDataChanged} from '../src/appEvents.ts';
import {readTransferDraft,writeTransferDraft} from '../src/transferDraft.ts';
import * as draftApi from '../src/transferDraft.ts';
import {transferWorkspaceItems} from '../src/transferWorkspaceIndex.ts';
const {db,localGet,localPost}=await import('../src/localDb.ts');
test('pending transfer drafts remain discoverable after the source profile has changed, without exposing solutions or writing records',async()=>{
 await localGet('/api/bootstrap');
 const key='training:ability:old-profile:fixture:1';
 const record={key,status:'validation_pending',createdAt:'2026-10-18T22:16:34Z',lineage:{key,rootWeaknessId:'ability:old-profile',rootSkillId:'ability:old-profile',sourceProblemId:'PY-2018-Q5',sourceAttemptId:319,sourceFindingIds:['answer_conclusion'],repairAttemptId:0,retrievalAttemptId:0,abilityProfile:{id:'old-profile',name:'最終結論まで完了',sources:[]}},rounds:[{hash:'fixture-hash',draft:{problem_text:'FIXTURE: 別設定で分散を求めよ。',reference_solution:'SECRET SOLUTION',grading_rubric:'SECRET RUBRIC'}}]};
 await db.meta.put({key:`transfer-generation:${key}`,value:JSON.stringify(record)});
 let events=0;const off=subscribeStudyDataChanged(()=>events++);
 const before=await db.meta.toArray(),list=await localPost('/api/transfer-training',{action:'list'}),row=list.items.find(i=>i.key===key);
 await new Promise(r=>setTimeout(r,30));off();assert.equal(events,0,'a read-only list cannot trigger a data reload loop');
 assert.ok(row);assert.equal(row.phase,'quality');assert.equal(row.sourceAttemptId,319);
 assert.equal(row.registered,false);assert.equal(row.attemptId,undefined);
 assert.ok(!JSON.stringify(list).includes('SECRET'));assert.deepEqual(await db.meta.toArray(),before);
});
test('existing-problem assignments and completed training are indexed without inventing a generated problem or natural success',()=>{
 const key='training:fixture-existing',lineage={key,sourceProblemId:'PY-source',sourceAttemptId:10,sourceFindingIds:['major_calculation'],rootSkillId:'skill-fixture',rootWeaknessId:'root-fixture',successCriteria:'対象計算を自力で完了'};
 const p={problem_id:'WB-destination',source_type:'whitebook'},source={id:10,problem_id:'PY-source',date:'2026-10-01'};
 const assignment={problemId:p.problem_id,lineage,answerSubmitted:true};
 const first=transferWorkspaceItems([],[p],[source],[assignment]);assert.equal(first.length,1);assert.equal(first[0].phase,'grading');assert.equal(first[0].kind,'existing');assert.equal(first[0].attemptId,undefined);
 const grade={id:20,problem_id:p.problem_id,date:'2026-10-24',transfer_lineage:lineage,exam_score_eligible:false,target_skill_assessment:{self_selected:true,major_calculation_success:false,no_major_error:false,evidence:'FIXTURE: 主要計算で停止'},actual_reference_level:0,grading_confidence:.99};
 const last=transferWorkspaceItems([],[p],[source,grade]);assert.equal(last.length,1);assert.equal(last[0].phase,'result');assert.equal(last[0].kind,'existing');assert.equal(last[0].attemptId,20);assert.ok(!last[0].outcome?.includes('natural'));
});
test('reference usage before paper submission survives a pause, and malformed preparation cannot silently become unassisted',()=>{
 assert.equal(typeof draftApi.readTransferPreparation,'function');assert.equal(typeof draftApi.writeTransferPreparation,'function');
 const map=new Map(),store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 draftApi.writeTransferPreparation(store,'training:A',{referenceLevel:3,minutes:'12'});
 assert.deepEqual(draftApi.readTransferPreparation(store,'training:A'),{referenceLevel:3,minutes:'12'});
 assert.equal(draftApi.readTransferPreparation(store,'training:B').referenceLevel,0);
 store.setItem(draftApi.transferDraftKey('training:A','preparation'),'{broken');assert.throws(()=>draftApi.readTransferPreparation(store,'training:A'));
});
test('transfer inputs are isolated by opportunity and stage; storage failure does not clear another input',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const raw=' { "original": "入力原文を保持" }\r\n';
 writeTransferDraft(store,'training:A','requested',raw);assert.equal(readTransferDraft(store,'training:A','requested'),raw);
 assert.equal(readTransferDraft(store,'training:B','requested'),'');assert.equal(readTransferDraft(store,'training:A','validation_pending'),'');
 writeTransferDraft(store,'training:A','validation_pending','quality');writeTransferDraft(store,'training:A','requested','');
 assert.equal(readTransferDraft(store,'training:A','validation_pending'),'quality');
 assert.throws(()=>writeTransferDraft({...store,setItem(){throw Error('quota')}},'training:A','submitted',raw),/quota/);
 assert.equal(readTransferDraft(store,'training:A','validation_pending'),'quality');
});
