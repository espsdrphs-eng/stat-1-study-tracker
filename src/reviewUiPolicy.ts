import type {ReviewExecutionState} from "./integrityEngine.ts";

/** Result recording and canonical prompt copy intentionally share this gate. */
export function shouldShowReviewPrompt(args:{reviewId?:number;problemId?:string;executionState:ReviewExecutionState;hasResolvedCard:boolean}){
  return !!args.reviewId&&!!args.problemId&&args.executionState==="actionable"&&args.hasResolvedCard;
}
