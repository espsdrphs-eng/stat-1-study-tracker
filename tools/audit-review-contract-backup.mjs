import { readFile } from "node:fs/promises";
import { auditLegacyReviewContracts, buildGradingContractSnapshot } from "../src/gradingContract.ts";
import { analyzeSourceMismatchRepair } from "../src/reviewOrigin.ts";
import { analyzeLegacyKReorganization } from "../src/legacyKRepair.ts";

const file=process.argv[2];
if(!file)throw new Error("Usage: node --experimental-strip-types tools/audit-review-contract-backup.mjs <backup.json>");
const data=JSON.parse(await readFile(file,"utf8"));
const problems=data.problems||[],attempts=data.attempts||[],reviews=data.reviews||[],aliases=data.problemAliases||[];
const audit=auditLegacyReviewContracts({reviews,attempts,aliases});
const source=analyzeSourceMismatchRepair({attempts,reviews,problems,aliases,relations:[]});
const afterReviews=reviews.map(row=>{
  const action=source.actions.find(item=>item.reviewId===row.id);
  return action?.patch?{...row,...action.patch}:row;
});
const afterReplacements=source.actions.flatMap(item=>item.replacement?[{...item.replacement,id:100000+item.reviewId}]:[]);
const sourceAfter=analyzeSourceMismatchRepair({attempts,reviews:[...afterReviews,...afterReplacements],problems,aliases,relations:[]});
const legacy=analyzeLegacyKReorganization({attempts,reviews,problems});
const active=reviews.filter(row=>["pending","overdue","review_needed","id_review_needed"].includes(row.status));
let retrievalChecks=0,contractNeedsReview=0,successEvidenceTargets=0;
const contracts=[];
for(const review of active){
  const problem=problems.find(row=>row.problem_id===review.problem_id);
  const sourceAttempt=attempts.find(row=>row.id===(review.source_attempt_id||review.generated_from_attempt_id));
  if(!problem)continue;
  const result=buildGradingContractSnapshot({review,problem,sourceAttempt,createdAt:"fixture-audit"});
  if(result.contract.learningPurpose==="retrieval_check")retrievalChecks++;
  if(result.needsReview)contractNeedsReview++;
  const success=new Set([...(sourceAttempt?.required_work_shown||[]),sourceAttempt?.resolution_evidence].filter(Boolean));
  if(result.contract.targetedParts.some(part=>success.has(part)))successEvidenceTargets++;
  contracts.push({reviewId:review.id,problemId:review.problem_id,purpose:result.contract.learningPurpose,mode:result.contract.mode,
    scope:result.contract.reviewScope,sheet:result.contract.sheetType,minutes:result.contract.estimatedMinutes,needsReview:result.needsReview});
}
const pick=ids=>contracts.filter(row=>ids.includes(row.reviewId));
console.log(JSON.stringify({counts:{problems:problems.length,attempts:attempts.length,reviews:reviews.length,
  pending:active.length,weakNotes:(data.weakNotes||[]).length,pastSessions:(data.pastSessions||[]).length},audit,
  sourceRepair:{active_source_mismatch:source.activeSourceMismatchCount,pending_verified_link_needs_migration:source.pendingVerifiedLinkNeedsMigrationCount,
    invalid_legacy_cards_to_supersede:source.invalidLegacyCardsToSupersedeCount,historical_completed_linked_reviews:source.historicalCompletedLinkedReviewsCount,
    superseded:source.supersededCount,regenerated:source.regeneratedCount,unresolved:source.unresolvedNeedsReviewCount,
    actions:source.actions.map(row=>({reviewId:row.reviewId,action:row.action})),active_source_mismatch_after:sourceAfter.activeSourceMismatchCount},
  legacyK:{invalid:legacy.invalidLegacyKCount,needsReview:legacy.needsReviewCount,superseded:legacy.supersededTaskCount,resolved:legacy.resolvedTaskCount},
  contractPreview:{retrievalChecks,contractNeedsReview,successEvidenceTargets},
  review87:pick([87]),lightChecks:pick([87,88,98,99,117,118,131,162]),modeMismatch:pick([87,88,98,99,117,118,131,162,175,186,200,212,214,216,220,223,231])},null,2));
