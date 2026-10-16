import type {Bootstrap,Task} from './types.ts';
import {currentTaskIdentity} from './examOptimizationPolicy.ts';
/** Advice can change presentation, never the measured KPIs or Today ordering. */
export function coachDashboardAdvice(data:Pick<Bootstrap,'coach'|'today'>){
 const {current,stale,reviewContext}=data.coach;
 if(!current||stale||current.reviewContextVersion!==reviewContext?.version)return null;
 const action=current.nextActions[0];
 const task=action?.taskIdentity?data.today.tasks.find(t=>!t.checked&&t.ranking?.eligible&&currentTaskIdentity(t)===action.taskIdentity):undefined;
 const blind=task&&(task.stable_session_key||task.transfer_training_key||(task.grading_contract?.learningPurpose||task.learning_purpose)==='transfer_check');
 return {level:current.level.value,readiness:current.level.label,bottleneck:current.primaryBottleneck.title,
  changes:current.improvements.slice(0,3).map(r=>r.title),action:blind?task.stable_session_key?'本番形式で自力確認':'別問題での転移訓練':action?.title,successCondition:action?.successCondition,task};
}
/** Presentation of existing measurements; never a new score, budget or planner. */
export function deriveLearningOverview(data:Bootstrap){
 const d=data.dashboard,e=d.readiness.evidence,k=d.kpis!;
 const measurement=(m?:{evidenceCount:number;value:number|null})=>m&&m.evidenceCount>0&&m.value!=null?Number(m.value):null;
 const transfer=e?.transfer,counts=transfer?.statusCounts;
 const metrics=[
  {key:'score',label:'本番得点力',value:measurement(e?.selectedThree),date:e?.selectedThree?.lastUpdated||null,detail:e?.selectedThree?.evidenceCount?'本番形式の選択3問':'未測定'},
  {key:'timed',label:'時間内完走',value:measurement(e?.timed),date:e?.timed?.lastUpdated||null,detail:e?.timed?.evidenceCount?'scanを含む90分・3問完遂':'未測定'},
  {key:'transfer',label:'自然な別問題への転移',value:counts?.attempted?100*counts.successful/counts.attempted:null,date:transfer?.lastUpdated||null,
   detail:counts?`成功${counts.successful}・失敗${counts.failed}・保留${counts.uncertain} ／ 未測定${counts.unattempted}`:'未測定'}
 ];
 const measured=metrics.some(m=>m.value!==null);
 return {daysRemaining:k.support.daysRemaining,level:measured?k.assessment?.level??null:null,
  judgement:measured?k.passZone?.value||k.assessment?.passJudgement||'判定材料不足':'判定材料不足',
  confidence:k.examReadiness?.confidence||'low',metrics,bottleneck:k.bottleneck.value};
}
export function priorityRepairTasks(data:Bootstrap){
 return data.today.tasks.filter(t=>!t.checked&&t.ranking?.eligible&&!t.stable_session_key&&!t.transfer_training_key&&
  (t.grading_contract?.learningPurpose||t.learning_purpose)==='error_repair').sort((a,b)=>(a.ranking?.rank||Infinity)-(b.ranking?.rank||Infinity)).slice(0,3);
}
export function weaknessTransferAction(task:Task,transfers:Task[]){
 const candidate=transfers.find(t=>t.problem_id===task.problem_id&&t.ranking?.eligible&&!t.checked&&t.transfer_training_key&&
  (task.repair_lineage?.weaknessSkillIds||[]).includes(t.transfer_training_key.replace(/^training:/,'')));
 return candidate?{key:candidate.transfer_training_key,reason:null}:{key:undefined,reason:task.repair_lineage?.weaknessSkillIds?.length?'先に対象の補修と参照なしの遅延保持を確認します。':'採点根拠による技能の対応付けと、補修・遅延保持の確認が必要です。'};
}
export function overviewNextTask(data:Bootstrap):Task|undefined{
 const current=data.today.currentTask;if(current&&!current.checked&&(current.ranking?.eligible||!data.today.canonicalStudyPlan.ranked))return current;
 return [...data.today.tasks].filter(t=>!t.checked&&t.ranking?.eligible).sort((a,b)=>(a.ranking?.rank||Infinity)-(b.ranking?.rank||Infinity))[0];
}
