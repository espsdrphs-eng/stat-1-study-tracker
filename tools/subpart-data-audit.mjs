import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deriveTaskAnswerScope,taskAnswerScopeText} from '../src/taskAnswerScope.ts';
import {attemptPlanningEligible} from '../src/legacyKPolicy.ts';
const file=process.argv[2];if(!file)throw new Error('Pass the complete export path.');
const bytes=await readFile(file),raw=JSON.parse(bytes);
if(!['problems','attempts','reviews','weakNotes','meta'].every(k=>Array.isArray(raw[k])))throw new Error('Not a complete export');
const pending=raw.reviews.filter(r=>r.status==='pending'&&raw.problems.some(p=>p.problem_id===r.problem_id&&p.source_type==='past_exam'));
const rows=pending.map(task=>{const problem=raw.problems.find(p=>p.problem_id===task.problem_id),scope=deriveTaskAnswerScope({problem,task,attempts:raw.attempts});
return {problemId:problem.problem_id,reviewId:task.id,sourceAttempt:task.grading_contract?.sourceAttemptId||task.source_attempt_id,status:scope.status,text:taskAnswerScopeText(scope),scope};});
const count=status=>rows.filter(r=>r.status===status).length;
const result={file,exportedAt:raw.exported_at,sha256:createHash('sha256').update(bytes).digest('hex'),counts:Object.fromEntries(['problems','attempts','reviews','weakNotes','meta'].map(k=>[k,raw[k].length])),
pendingPastExamReviews:rows.length,identified:count('identified'),unknown:count('unknown'),conflict:count('conflict'),whole:count('whole'),
examples:rows.filter(r=>['PY-2022-Q1','PY-2019-Q3','PY-2018-Q4','PY-2018-Q5'].includes(r.problemId)),
unidentified:rows.filter(r=>r.status==='unknown'||r.status==='conflict').map(r=>({problemId:r.problemId,reviewId:r.reviewId,status:r.status,candidateParts:r.scope.candidateParts})),rows};
await mkdir('outputs/subparts-20261012',{recursive:true});await writeFile('outputs/subparts-20261012/data-audit.json',JSON.stringify(result,null,2));
// The IDs below identify the reviewed cohort, not application selection policy.
const previouslyUnknown=new Set([444,468,469,501,518,521,522,523,524,525,526,528,533,537,539,540]);
const audit=rows.filter(r=>previouslyUnknown.has(r.reviewId)).map(r=>{
 const review=raw.reviews.find(v=>v.id===r.reviewId),source=raw.attempts.find(a=>a.id===r.sourceAttempt),latest=raw.attempts.filter(a=>a.problem_id===r.problemId&&attemptPlanningEligible(a)).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
 const paths=[...new Set(r.scope.targetEvidence.filter(e=>e.role==='primary').map(e=>e.source))];
 const cause=r.status!=='identified'?'有効な複数targetのうち一部しか番号へ一意に結び付かない':paths.some(p=>p.includes('locator'))?'番号付き採点領域と対象の明示名との接続を旧処理が参照していなかった':paths.some(p=>p.startsWith('lineage'))?'補修・保持で番号が省略され、同じpartの契約lineageを旧処理が追っていなかった':paths.includes('attempt.whole_answer_scan.regions')?'最新の番号付き採点領域を旧処理が参照していなかった':r.scope.primaryTargetParts.length>=5?'明示された小問範囲表記を展開できなかった':'「について」「冒頭」「接続」、連続番号や短時間の単独課題を旧処理が扱えなかった';
 return {problem:r.problemId,review:r.reviewId,latest:latest?`${latest.id} / ${latest.date} / ${latest.mark} / ${latest.score_numeric??'―'}点`:null,
 validity:latest?.policy_validity||'未記録',source:source?.id,status:r.status,scope:r.text,cause,paths,
 targeted_parts:source?.targeted_parts||[],review_targets:review.targeted_parts||[],error_point:source?.error_point||'',next_action:source?.next_action||'',
 numbered_regions:(source?.whole_answer_scan?.regions||[]).filter(v=>/小問|設問|\[\d+\]|\(\d+\)|問\d+/.test(v.description)).map(v=>({description:v.description,status:v.status,finding_ids:v.finding_ids})),
 evidence:r.scope.targetEvidence};
});
const cell=s=>String(s??'―').replace(/\|/g,'／').replace(/\n/g,' ');
const lines=[`# 未特定16件の再監査`, `使用原本：${file}`,`exported_at: ${raw.exported_at}`,`SHA-256: ${result.sha256}`,
 `未完了過去問Review ${rows.length}件：自動特定 ${result.identified}／手動指定必要 ${result.unknown}／矛盾 ${result.conflict}`, '',
 '| 年度・問題 | Review | 最新の有効採点（ID／日付／評価） | 対象 | 旧処理の原因 | 特定可否 |','|---|---:|---|---|---|---|',
 ...audit.map(r=>`| ${cell(r.problem)} | ${r.review} | ${cell(r.latest)} | ${cell(r.scope)} | ${cell(r.cause)} | ${r.status==='identified'?'既存記録から特定':'番号の追加確認が必要'} |`), '',
 ...audit.flatMap(r=>[`## ${r.problem} / Review ${r.review}`,`最新採点：${r.latest}（${r.validity}。無効legacy Kは失敗根拠へ採用しない）`,
 `- targeted_parts: ${r.targeted_parts.join(' ／ ')||'なし'}`,`- Review対象記録: ${r.review_targets.join(' ／ ')||'なし'}`,
 `- error_point: ${r.error_point||'なし'}`,`- next_action: ${r.next_action||'なし'}`,
 `- 根拠: ${r.evidence.map(e=>`${e.part} / ${e.role} / ${e.source} / Attempt ${e.attemptId}`).join(' ／ ')||'一意な番号対応なし'}`,''])];
await writeFile('outputs/subparts-20261012/unidentified-16-audit.md',lines.join('\n'));
console.log(JSON.stringify({...result,rows:undefined,examples:result.examples.map(({scope,...r})=>({...r,primary:scope.primaryTargetParts,secondary:scope.secondaryTargetParts,reference:scope.referenceOnlyParts}))},null,2));
