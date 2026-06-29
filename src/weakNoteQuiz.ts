import type { WeakNote } from "./types.ts";

export function applyWeakNoteQuizResult(note:WeakNote,result:"remembered"|"retry",now=new Date().toISOString()){
  const remembered=result==="remembered";
  const correct=remembered?(note.quiz_correct_count||0)+1:0;
  return {
    last_quizzed_at:now,quiz_correct_count:correct,
    quiz_wrong_count:(note.quiz_wrong_count||0)+(remembered?0:1),
    is_resolved:correct>=2?1:0
  };
}
