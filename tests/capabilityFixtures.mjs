export function capabilityFacts(){
 const part=(ok)=>({graded_part_id:'major_calculation',error_type:ok?'none':'N',resolved:ok,evidence:ok?'分散を最終値まで自力で計算した':'分散の最終値に到達していない'});
 const a=(id,problem_id,date,ok)=>({id,problem_id,date,mode:'full',score_numeric:ok?100:45,score_label:ok?'A':'D',mark:ok?'○':'×',error_type:ok?'none':'N',error_point:ok?'':'分散未完了',graded_findings:[part(ok)],actual_reference_level:0,hint_used:false,grading_confidence:99});
 const reproduction={...a(2,'PY-2018-Q5','2026-11-01',true),learning_purpose:'error_repair',assessment_timing:'same_session_correction',reference_closed_reproduction:true};
 return {problems:[{problem_id:'PY-2018-Q5',source_type:'past_exam',title:'元問題'},{problem_id:'GEN-TEST',source_type:'generated',title:'生成した別問題'},{problem_id:'PY-2024-Q3',source_type:'past_exam',title:'別の過去問'}],attempts:[a(1,'PY-2018-Q5','2026-11-01',false),reproduction,a(3,'PY-2024-Q3','2026-11-08',true)],reviews:[],pastSessions:[],records:[]};
}
export function capabilityWire(context,overrides={}){
 return {schema_version:'stat1-capability-v1',catalog_version:context.catalogVersion,context_version:context.version,evaluated_at:'2026-11-11T10:00:00+09:00',evaluations:[{ability_id:'distributions.expectation-variance',state:'immediate_confirmed',certainty:'confirmed',judgement:'元の問題で分散を自力再現。別問題での遅延確認はまだない。',first_error:'分散計算が未完了',evidence:[{attempt_id:2,part_ids:['major_calculation'],kind:'immediate_reproduction',outcome:'success',baseline_attempt_id:1,observation:'最終分散まで参照なしで完成'}],next_check:{kind:'delayed_transfer',due_date:'2026-11-18',task:'異なる分布の別問題で分散を完遂する',success_condition:'支持条件を保持して最終分散まで自力計算する'},...overrides}]};
}
