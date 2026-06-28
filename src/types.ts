export type Problem = {
  id:number; problem_id:string; source_type:"whitebook"|"past_exam"; category:"S"|"A"|"past_exam";
  chapter:number|null; problem_number:number; title:string; theme:string; priority:string; role:string;
  recommended_mode:string; linked_past_exams:string; linked_s_problems:string; linked_a_problems:string;
  notes:string; completion_status:string;
  display_label?:string; difficulty?:number|null; roadmap_label?:string; normalized_label?:string;
  related_s_problem_ids?:string[]; linked_past_exam_ids?:string[];
};
export type Attempt = {
  id:number; problem_id:string; date:string; mode:string; time_minutes:number; mark:string;
  score_label:string; error_type:string; error_point:string; next_action:string; memo:string;
  score_text?:string; score_numeric?:number|null; score_max?:number|null; result_summary?:string;
  exam_selection_rank?:string; error_types?:string[]; primary_error_type?:string;
  secondary_error_type?:string; ignored_parts?:string[]; auto_imported?:boolean;
  import_confidence?:number;
};
export type Review = {
  id:number; problem_id:string; due_date:string; review_type:string; status:string; generated_from_attempt_id:number;
  duration_minutes?:number; reason?:string;
};
export type WeakNote = {
  id:number; date:string; problem_id:string; error_type:string; theme:string; mistake:string;
  correction_rule:string; is_resolved:number; source_text?:string; auto_generated?:boolean;
};
export type Roadmap = {
  id:number; order_index:number; problem_id:string; block_name:string; expected_mode:string; load_score:number; is_active:number;
};
export type PastSession = Record<string, string|number> & { id:number; year:number; session_type:string; date:string };
export type Task = {
  id?:number; problem_id:string; title:string; kind:string; reason:string; mode:string;
  minutes:number; load:number; status?:string; error_type?:string;
};
export type Dashboard = {
  today:string; weekA:number; weekPast:number; kRecurrence:number; pending:number; overdue:number;
  sStableRate:number; sForgotten:number; scanSuccess:number; examSuccess:number;
  dangerChapters:{chapter:number;count:number}[]; nextTheme:string;
  pace:{label:string;checks:boolean[];a14:number;pastSkeleton:number;kRepeat:number;skeletonRate:number;weakUpdates:number;delayed3:number;suggestion:string};
};
export type Bootstrap = {
  problems:Problem[]; attempts:Attempt[]; reviews:Review[]; roadmap:Roadmap[];
  weakNotes:WeakNote[]; pastSessions:PastSession[]; dashboard:Dashboard;
  today:{tasks:Task[];totalLoad:number;warning:string};
};
export type StudyUpdate = {
  problem_id:string; date:string; mode:string; time_minutes?:number|string; mark:string; score_label:string;
  error_type:string; error_point:string; next_action:string; review_after_days?:number|string;
  linked_s_problem?:string; linked_past_exam?:string; theme?:string; correction_rule?:string;
  display_label?:string; source_type?:"whitebook"|"past_exam"; category?:"S"|"A"|"past_exam";
  chapter?:number|null; problem_number?:number; difficulty?:number|null; themes?:string[];
  related_s_problem_ids?:string[]; linked_s_problems?:string[]; linked_past_exams?:string[];
  ignored_parts?:string[]; score_text?:string; score_numeric?:number|null; score_max?:number|null;
  result_summary?:string; exam_selection_rank?:string; error_types?:string[];
  primary_error_type?:string; secondary_error_type?:string; review_reason?:string;
  weak_note?:{theme:string;error_type:string;mistake:string;correction_rule:string};
  weak_notes?:Array<{theme:string;error_type:string;mistake:string;correction_rule:string}>;
  source_text?:string; auto_imported?:boolean; import_confidence?:number;
  master_matched?:boolean; status?:string; math_localized?:boolean;
};
