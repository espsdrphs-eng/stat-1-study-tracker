import type {PastSession} from './types.ts';
import {resolvePastExamProblemId} from './examReferencePack.ts';
export function sessionChoiceIds(s:PastSession){
 const ids=s.final_selected_problem_ids?.length?s.final_selected_problem_ids:s.initial_selected_problem_ids?.length?s.initial_selected_problem_ids:(s.questions||[]).filter(q=>q.selected).map(q=>q.problemId||q.questionLabel);
 return [...new Set(ids.map(id=>resolvePastExamProblemId(s.year,id)))];
}
export function sessionSelectedIds(s:PastSession){
 const frozen=s.exam_selected_problem_ids?.length===3?s.exam_selected_problem_ids:s.answer_finished_at&&s.answered_problem_ids?.length===3?s.answered_problem_ids:undefined;
 return frozen?[...new Set(frozen.map(id=>resolvePastExamProblemId(s.year,id)))]:sessionChoiceIds(s);
}
export function assertSessionSelectionUnchanged(previous:PastSession,next:PastSession){
 if(!previous.answer_finished_at&&!previous.attempt_completed_at&&!previous.simulation_completed_at)return;
 const selected=sessionSelectedIds(previous),signature=(ids:string[])=>JSON.stringify([...ids].sort());
 if(selected.length===3&&(signature(sessionChoiceIds(next))!==signature(selected)||
   (next.questions||[]).some(q=>q.selected!==selected.includes(resolvePastExamProblemId(next.year,q.problemId||q.questionLabel)))||
   next.exam_selected_problem_ids&&signature(next.exam_selected_problem_ids)!==signature(selected)))
  throw new Error('終了した演習の選択3問は変更できません。未選択問題は「後日答案の採点」で記録してください。');
}
