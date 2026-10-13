import type {StudyUpdate} from './types.ts';
/** Identity of a grading result, not identity of a problem or a mastery state. */
export async function gradingSubmissionKey(update:StudyUpdate&Record<string,unknown>){
 const fields=['problem_id','date','mode','contract_id','contract_hash','contract_version','source_attempt_id','source_review_id','generated_from_review_id','replacement_for_attempt_id',
  'score_numeric','score_max','score_label','error_type','error_types','primary_error_type','graded_part_ids','graded_findings','uncertain_points','grading_confidence',
  'result_summary','error_point','next_action','target_issue_resolved','minimum_pass_condition_met','resolution_evidence','review_outcome',
  'actual_reference_level','reference_level','hint_used','no_hint','one_line_hint','previous_mistake','official_answer','external_reference','reference_closed_reproduction',
  'actual_minutes','time_minutes','whole_answer_scan','observed_out_of_scope_findings','target_skill_assessment','task_context'];
 // UI notes, derived scheduling fields and random IDs are not a second grade.
 const payload:Record<string,unknown>=Object.fromEntries(fields.filter(k=>update[k]!==undefined).map(k=>[k,update[k]]));
 // One bound contract represents one execution. A retry on a later day is not
 // a second execution; a new exercise must have its own current contract.
 if(payload.contract_id)delete (payload as Record<string,unknown>).date;
 const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
 const text=JSON.stringify(stable(payload));
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return {key:`grading-submission:${Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')}`,payload:text};
}
export type GradingSaveReceipt={ok:true;savedAttemptIds:number[];replayed:boolean;projectionWarning?:string};
