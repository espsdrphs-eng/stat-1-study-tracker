export const concept=(id="c1",name="変数変換")=>({
  concept_id:id,display_name:name,whitebook_chapter_number:4,whitebook_chapter_title:"多次元分布",
  past_exam_problem_ids:["PE-2021-Q01","PE-2022-Q01"],status:"verified",id_stability:"stable",
  source_confidence:"official_and_reviewed"
});

export const pastProblem=(year,question=1,conceptIds=["c1"],patch={})=>({
  problem_id:`PE-${year}-Q${String(question).padStart(2,"0")}`,year,question_number:question,subject:"統計数理",
  availability:"verified_problem",schedulable:true,gradable:true,title:`${year}年問${question}`,
  summary:"正規化済みメタデータ",fine_concept_ids:conceptIds,coarse_topics:["確率分布"],
  difficulty_by_source:{},selection_note:null,exposure_default:"unknown",
  simulation_protection_default:[2024,2025].includes(year),source_references:[],
  classification_confidence:"verified",whitebook_candidate_ids:[],whitebook_candidate_ids_unresolved:[],
  notes:[],...patch
});

export const record=(patch={})=>({
  packHash:"fixture-hash",importedAt:"2026-07-01T00:00:00.000Z",
  shadowStartedAt:"2026-07-01T00:00:00.000Z",plannerMode:"shadow",
  validation:{valid:true,packHash:"fixture-hash",errors:[],warnings:[],verifiedFiles:[],
    schemaVersions:["stat1-exam-reference-v1","stat1-concept-master-v1","stat1-whitebook-exam-links-v1","stat1-adaptive-planner-policy-v1"]},
  reconciliation:{existingPastExam:0,safePastExamAdditions:0,safePastExamEnrichments:0,pastExamConflicts:0,
    resolvedWhitebookLinks:0,aliasResolvedWhitebookLinks:0,unresolvedWhitebookLinks:0,unresolvedWhitebookIds:[],
    knownLegacyConflicts:0,orphanPastAttempts:0,orphanPastSessions:0,pastExamRows:[],whitebookRows:[]},
  data:{
    manifest:{pack_name:"stat1_exam_reference_pack_v1",created_at:"2026-07-01T00:00:00Z",files:[],
      counts:{past_exam_records:2,core_schedulable:2,metadata_only:0,concepts:1,whitebook_links:0}},
    pastExamMetadata:{schema_version:"stat1-exam-reference-v1"},
    pastExamProblems:[pastProblem(2021),pastProblem(2022)],
    conceptMetadata:{schema_version:"stat1-concept-master-v1"},concepts:[concept()],
    linkMetadata:{schema_version:"stat1-whitebook-exam-links-v1"},whitebookLinks:[],
    plannerPolicy:{metadata:{schema_version:"stat1-adaptive-planner-policy-v1",created_at:"2026-07-01",
      purpose:"test",exam_date:"2026-11-15",timezone:"Asia/Tokyo",default_daily_minutes:150},
      daily_slots:[],phases:[],weakness_evidence:{},past_exam_loop:[],exposure_states:[],
      exposure_rules:[],snapshot_rule:"immutable",non_goals:[]},
    legacyConflictReport:{do_not_use_as_canonical:[],reason:"",examples:[],required_action:""},
    sourceManifest:"",validationReport:"",readme:""
  },
  ...patch
});

export const problem=(id,chapter=4,category="A")=>({
  id:Number(id.replace(/\D/g,"").slice(0,8)||1),problem_id:id,source_type:"whitebook",category,chapter,
  problem_number:Number(id.match(/(\d+)$/)?.[1]||1),title:id,display_label:id,theme:id,
  canonical_title:id,canonical_problem_type:id,canonical_keywords:[],priority:"A",role:"score_building",
  recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
  notes:"",completion_status:"active",strategy_rank:"A"
});

export const attempt=(id,problemId,date,patch={})=>({
  id,problem_id:problemId,date,mode:"full",time_minutes:30,mark:"△",score_label:"C",
  error_type:"W",error_types:["W"],error_point:"計算",next_action:"再現",review_after_days:3,
  actual_reference_level:0,hint_used:false,...patch
});
