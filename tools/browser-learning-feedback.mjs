import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import yaml from 'js-yaml';
const base=process.env.APP_URL||'http://127.0.0.1:4186/';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820},permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(90000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const settleMenu=async()=>{if(page.viewportSize().width<=850)await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1)};
const nav=async name=>{if(page.viewportSize().width<=850){await page.locator('.menu-btn').click()}await page.getByRole('button',{name,exact:true}).first().click();await settleMenu()};
const state=()=>page.evaluate(async()=>{const d=await (await import('/src/localDb.ts')).localGet('/api/bootstrap');return {
  attempts:d.attempts.map(a=>({id:a.id,problem_id:a.problem_id,memo:a.memo,transfer_lineage:a.transfer_lineage,exam_score_eligible:a.exam_score_eligible})),
  reviews:d.reviews.map(r=>({id:r.id,problem_id:r.problem_id,status:r.status})),problems:d.problems.map(p=>({problem_id:p.problem_id,generated_transfer:p.generated_transfer})),
  dashboard:{readiness:{evidence:d.dashboard.readiness.evidence}},today:{tasks:d.today.tasks}}});
const results={data:'2026-10-11 full lossless COPY; production data untouched',externalModel:'NOT RUN: generation/validation/grading JSON are explicit fixtures, not live GPT'};
const draft={problem_text:'正の確率変数Zは0<z<1で密度3z²を持つ。記録値A=5Zに対し、0<t<5でF(t)=E[A^{-1}1{A>t}]を求めよ。',
  difficulty:'統計検定1級',estimated_minutes:10,
  surface_features:['切断された重み付き平均','連続記録値'],generator_pass_id:'browser-fixture-generation'};
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});await nav('設定');
  page.on('dialog',d=>d.accept());
  await page.locator('.restore-button input[type=file]').setInputFiles('outputs/learning-flow-20261011/latest-full.json');
  await page.getByText('バックアップを復元しました',{exact:true}).waitFor();
  const initial=await state();results.restore={attempts:initial.attempts.length,reviews:initial.reviews.length};results.transferStatus=initial.dashboard.readiness.evidence.transfer.statusCounts;
  results.rankComparison=initial.today.tasks.filter(t=>['PY-2019-Q3','PY-2018-Q4','PY-2018-Q2','PY-2022-Q2','PY-2022-Q4'].includes(t.problem_id)&&t.ranking).map(t=>({problem:t.problem_id,rank:t.ranking.rank,purpose:t.learning_purpose}));console.log('RESTORE PASS');
  await nav('今日やること');while(await page.getByRole('button',{name:/続きを表示/}).count())await page.getByRole('button',{name:/続きを表示/}).click();
  const task=initial.today.tasks.find(t=>t.problem_id==='PY-2018-Q5'&&!t.stable_session_key);assert.ok(task);
  const card=page.locator('.ranked-study-card').filter({has:page.getByText(task.title,{exact:true})}).first();
  assert.doesNotMatch(await card.innerText(),/Y3|Jacobian|逆変換|fZ\(/);
  await card.getByRole('button',{name:'学習開始',exact:true}).click();
  const pre=await page.locator('main').innerText();assert.doesNotMatch(pre,/前回の|最新評価|修正|Y3|Jacobian|fZ\(/);assert.ok(await page.getByRole('button',{name:'解答を開始',exact:true}).isVisible());
  await page.screenshot({path:'outputs/learning-flow-20261011/detail-after.png'});
  await page.getByRole('button',{name:'解答を開始',exact:true}).click();await page.locator('.blind-problem textarea').fill('独立答案の検証用入力（数学的採点はfixtureで代替）');
  assert.doesNotMatch(await page.locator('main').innerText(),/Y3|Jacobian|fZ\(/);
  await page.getByRole('button',{name:'答案を書き終えた（採点へ）',exact:true}).click();
  assert.match(await page.locator('.answer-summary').innerText(),/採点結果はまだ保存/);
  await page.locator('.post-answer-details > summary').click();assert.match(await page.locator('.post-answer-details').innerText(),/解答履歴|主要計算/);
  await page.getByRole('button',{name:'GPT採点結果を取り込む',exact:true}).first().click();
  const normalGrade=await page.evaluate(t=>{
    const c=t.grading_contract;
    return {study_update:{problem_id:t.problem_id,problem_id_confirmed:true,date:'auto_today',mode:c.mode,
      task_origin:'review_attempt',actual_minutes:12,mark:'○',score_numeric:100,score_text:'100',error_type:'none',error_types:['none'],primary_error_type:'none',
      next_action:'後日の参照なし保持確認',review_after_days:7,reference_level:0,actual_reference_level:0,hint_used:false,grading_confidence:.99,
      source_review_id:t.id||c.reviewId,generated_from_review_id:t.id||c.reviewId,source_attempt_id:c.sourceAttemptId,target_kind:c.targetKind,
      learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,assessment_timing:'delayed_retrieval',allowed_reference_level:c.allowedReferenceLevel,
      contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,
      review_outcome:'success',target_issue_resolved:true,minimum_pass_condition_met:true,
      graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 指定範囲の再現を採点'}))}};
  },task);
  const importModal=page.locator('.modal');await importModal.locator('.paste-area').fill(yaml.dump(normalGrade));
  await importModal.getByRole('button',{name:'内容を解析する',exact:true}).click();
  await importModal.getByRole('button',{name:'1件を保存する',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.answer-summary')?.textContent.includes('今回：100点')||document.querySelector('.toast')?.textContent.includes('画面に表示した課題'));
  assert.doesNotMatch(await page.locator('main').innerText(),/画面に表示した課題とGPT採点範囲が一致しません/);
  await page.locator('.answer-summary').getByText(/今回：100点/).waitFor();
  assert.ok((await state()).attempts.some(a=>a.problem_id===task.problem_id&&a.memo?.includes('独立答案の検証用入力')));
  results.blind={status:'PASS',scope:'Today → detail → timed answer → post-answer expandable history'};
  results.normalGrading='PASS: actual import UI and storage; grading JSON is FIXTURE';console.log('ANSWER/SAVE PASS');
  await nav('弱点傾向');const diagnosis=page.locator('.current-learning-diagnosis');assert.ok(await diagnosis.isVisible());assert.match(await diagnosis.innerText(),/本番対応力 2.5/);assert.equal(await diagnosis.locator('article.card').count(),3);
  assert.doesNotMatch(await diagnosis.innerText(),/640件|合格確率\s*\d/);results.deficits=(await diagnosis.innerText()).slice(0,1500);
  assert.doesNotMatch(await diagnosis.innerText(),/\[object Object\]/);
  for(const viewport of [{width:820,height:1180},{width:1180,height:820},{width:390,height:844}]){
    await page.setViewportSize(viewport);const dims=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dims.scroll<=dims.width+1,JSON.stringify(dims));
    await settleMenu();
    await page.screenshot({path:`outputs/learning-flow-20261011/diagnosis-${viewport.width}.png`});results[`ipad${viewport.width}`]='PASS';
  }
  await nav('今日やること');while(await page.getByRole('button',{name:/続きを表示/}).count())await page.getByRole('button',{name:/続きを表示/}).click();
  const training=page.getByRole('region',{name:'転移確認',exact:true}).first();
  // Candidate is from actual source 251 / repair 269 / retrieval 307. No synthetic prerequisites.
  await page.setViewportSize({width:820,height:1180});await settleMenu();
  assert.ok(await training.getByRole('button',{name:'生成プロンプトをコピー',exact:true}).isVisible());
  await training.getByRole('button',{name:'生成プロンプトをコピー',exact:true}).click();
  await training.getByRole('status').filter({hasText:'コピーしました'}).waitFor();
  const prompt=await page.evaluate(()=>navigator.clipboard.readText());assert.match(prompt,/coefficient_tracking_scale_reciprocal/);
  assert.doesNotMatch(prompt,/reference_solution|grading_rubric/);
  results.actualJit='PASS: real retained root → Today → generation request; no problem until validated';
  console.log('REAL JIT REQUEST PASS');
  await training.locator('textarea').fill(JSON.stringify(draft));await training.getByRole('button',{name:'問題を登録（品質確認へ）',exact:true}).click();
  await training.getByRole('button',{name:'品質確認プロンプトをコピー',exact:true}).waitFor();
  const validation=await page.evaluate(async()=>{const {db}=await import('/src/localDb.ts');const {GENERATION_CHECKS}=await import('/src/generatedTransfer.ts');const r=JSON.parse((await db.meta.get('transfer-generation:training:coefficient_tracking_scale_reciprocal')).value);
    return {draft_hash:r.rounds.at(-1).hash,validator_pass_id:'browser-independent-fixture-validation',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'FIXTURE: 新しい会話で解答可能性と技能対応を独立に検算'}]))}});
  await training.locator('textarea').fill(JSON.stringify(validation));await training.getByRole('button',{name:'品質確認して問題を登録',exact:true}).click();
  await training.getByRole('button',{name:/答案を確定する/}).waitFor();
  const blind=(await state()).problems.find(p=>p.generated_transfer);assert.ok(blind);
  assert.doesNotMatch(await training.innerText(),/coefficient_tracking|source：|対象能力|1\/\(5Z\)/);
  assert.equal(blind.generated_transfer.reference_solution,'');assert.equal(blind.generated_transfer.grading_rubric,'');
  await page.screenshot({path:'outputs/learning-flow-20261011/manual-transfer-ipad.png'});
  await training.locator('textarea').first().fill('A^{-1}=1/(5Z)、A>tはZ>t/5。F(t)=(3/5)∫_{t/5}^1 z dz=(3/10)(1-t²/25)。');await training.getByRole('button',{name:/答案を確定する/}).click();
  await training.getByRole('button',{name:'採点プロンプトをコピー',exact:true}).waitFor();
  await training.getByRole('button',{name:'採点プロンプトをコピー',exact:true}).click();
  await training.getByRole('status').filter({hasText:'コピーしました'}).waitFor();
  const update=await page.evaluate(async pid=>{const {db}=await import('/src/localDb.ts'),{buildInitialGradingContract}=await import('/src/gradingContract.ts');const p=await db.problems.get(pid),c=buildInitialGradingContract({problem:p,mode:'full'});
    return {mathematical_review:{problem_id:pid,content_hash:p.generated_transfer.content_hash,reference_solution:'A^{-1}=1/(5Z)、A>tはZ>t/5。F(t)=(3/5)∫_{t/5}^1 z dz=(3/10)(1-t²/25)。',grading_rubric:'尺度変更と逆数の係数、範囲、積分、結論の対応を採点する。',checks:Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'FIXTURE: 範囲・密度・積分を独立に照合し一致'}]))},study_update:{problem_id:pid,problem_id_confirmed:true,date:'auto_today',mode:'full',score_numeric:100,score_label:'A',mark:'○',error_type:'none',error_types:['none'],grading_confidence:99,
      learning_purpose:'transfer_check',learning_stage:'transfer',review_scope:'full_answer',contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,
      graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 尺度と逆数の係数を保持'})),
      target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'FIXTURE: 1/(5Z)と下限t/5を選び積分した'}}}},blind.problem_id);
  const invalid={...update,study_update:{...update.study_update,score_numeric:101}};
  await training.locator('textarea').fill(JSON.stringify(invalid));await training.getByRole('button',{name:'結果を保存',exact:true}).click();await training.getByRole('alert').filter({hasText:'点数'}).waitFor();
  assert.ok(!(await state()).attempts.some(a=>a.problem_id===blind.problem_id));
  const badMath={...update,mathematical_review:{...update.mathematical_review,checks:{...update.mathematical_review.checks,well_defined:{pass:false,evidence:'FIXTURE: 条件不足の品質不合格'}}}};
  await training.locator('textarea').fill(JSON.stringify(badMath));await training.getByRole('button',{name:'結果を保存',exact:true}).click();await training.getByRole('alert').filter({hasText:'採点不能'}).waitFor();
  assert.ok(!(await state()).attempts.some(a=>a.problem_id===blind.problem_id));
  await training.locator('textarea').fill(JSON.stringify(update));await training.getByRole('button',{name:'結果を保存',exact:true}).click();
  await page.getByText('今回保存した転移結果',{exact:true}).waitFor();
  await page.getByText('training transfer success',{exact:true}).waitFor();
  await page.getByText('今回の得点：100 / 100',{exact:true}).waitFor();
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('FIXTURE: clipboard permission denied')}}));
  await page.getByRole('button',{name:'採点を再確認するプロンプトをコピー',exact:true}).click();
  await page.getByRole('status').filter({hasText:'自動コピーが許可されていません'}).waitFor();
  const fallback=page.getByRole('textbox',{name:'コピー用プロンプト',exact:true});assert.match(await fallback.inputValue(),/確定答案/);
  results.clipboardFallback='PASS: simulated clipboard refusal → selectable prompt; no lost registration or grading';
  const after=await state();const a=after.attempts.find(a=>a.problem_id===blind.problem_id);assert.ok(a);assert.equal(a.transfer_lineage.sourceAttemptId,251);assert.equal(a.exam_score_eligible,false);
  assert.equal(after.problems.find(p=>p.problem_id===blind.problem_id).generated_transfer.input_format,'statement_only_v1');
  assert.ok(after.problems.find(p=>p.problem_id===blind.problem_id).generated_transfer.grading_reference);
  assert.match(a.memo,/手動ChatGPT/);
  assert.deepEqual(after.dashboard.readiness.evidence.selectedThree,initial.dashboard.readiness.evidence.selectedThree);assert.deepEqual(after.dashboard.readiness.evidence.transfer,initial.dashboard.readiness.evidence.transfer);
  await nav('弱点傾向');assert.match(await page.locator('.current-learning-diagnosis').innerText(),/訓練成功 1件/);assert.match(await page.locator('.current-learning-diagnosis').innerText(),/転移成功 0件/);
  await page.reload();const reloaded=await state();assert.equal(reloaded.problems.find(p=>p.generated_transfer)?.problem_id,blind.problem_id);assert.equal(reloaded.attempts.find(a=>a.problem_id===blind.problem_id).transfer_lineage.key,a.transfer_lineage.key);
  const preservation=await page.evaluate(async()=>{
    const {localGet,localPost,exportBackup,restoreBackup}=await import('/src/localDb.ts');
    // Completed display overlays are ephemeral; completed Attempt facts are not.
    const snapshot=d=>({tasks:d.today.tasks.filter(t=>t.ranking&&!t.checked).map(t=>({problem:t.problem_id,key:t.transfer_training_key||t.stable_session_key||t.id,rank:t.ranking?.rank,purpose:t.learning_purpose})),
      history:d.attempts.map(a=>({id:a.id,problem:a.problem_id,date:a.date,mark:a.mark,score:a.score_numeric,memo:a.memo})).sort((a,b)=>a.id-b.id),
      level:d.dashboard.kpis.assessment.level,evidence:d.dashboard.readiness.evidence,
      generated:d.problems.filter(p=>p.generated_transfer).map(p=>p.generated_transfer),lineages:d.attempts.filter(a=>a.transfer_lineage).map(a=>a.transfer_lineage)});
    const audit=await localPost('/api/integrity/audit',{});const first=snapshot(await localGet('/api/bootstrap'));
    const second=snapshot(await localGet('/api/bootstrap'));const exported=await exportBackup();await restoreBackup(exported);
    const restored=snapshot(await localGet('/api/bootstrap'));
    const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
    const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
    const different=Object.keys(second).filter(k=>!same(second[k],restored[k])).map(k=>({field:k,before:JSON.stringify(second[k]).slice(0,500),after:JSON.stringify(restored[k]).slice(0,500)}));
    const taskDifference=Array.from({length:Math.max(second.tasks.length,restored.tasks.length)},(_,i)=>({before:second.tasks[i],after:restored.tasks[i]})).filter(p=>!same(p.before,p.after)).slice(0,5);
    return {before:audit.blockingIntegrityIssueCount,violations:audit.plannerPolicyViolationCount,stale:audit.stale,
      idempotent:same(first,second),roundtrip:same(second,restored),different,taskDifference};
  });
  console.log('PRESERVATION',JSON.stringify(preservation));
  assert.equal(preservation.before,0);assert.equal(preservation.violations,0);assert.equal(preservation.stale,false);assert.equal(preservation.idempotent,true);assert.equal(preservation.roundtrip,true);results.preservation=preservation;
  await nav('今日やること');while(await page.getByRole('button',{name:/続きを表示/}).count())await page.getByRole('button',{name:/続きを表示/}).click();
  const hintTask=(await state()).today.tasks.find(t=>t.id&&t.review_type&&!t.transfer_training_key&&!t.checked);
  assert.ok(hintTask);const hintCard=page.locator('.ranked-study-card').filter({has:page.getByText(hintTask.title,{exact:true})}).first();
  await hintCard.getByRole('button',{name:'学習開始',exact:true}).click();
  await page.getByRole('button',{name:'ヒントを開く（参照ありとして記録）',exact:true}).click();await page.getByRole('status').filter({hasText:'参照あり：'}).waitFor();
  await page.getByRole('button',{name:'← 戻る',exact:true}).click();
  while(await page.getByRole('button',{name:/続きを表示/}).count())await page.getByRole('button',{name:/続きを表示/}).click();
  await hintCard.getByRole('button',{name:'復習結果を記録',exact:true}).click();
  await page.locator('.modal').getByRole('button',{name:/^0\. /}).click();
  await page.getByRole('button',{name:'結果を保存',exact:true}).click();await page.locator('.modal').waitFor({state:'hidden'});
  const hinted=await page.evaluate(async reviewId=>{const {db}=await import('/src/localDb.ts');return (await db.attempts.toArray()).filter(a=>a.generated_from_review_id===reviewId||a.source_review_id===reviewId).sort((a,b)=>b.id-a.id)[0]},hintTask.id);
  assert.ok(hinted);assert.ok(hinted.actual_reference_level>=2);assert.equal(hinted.hint_used,true);assert.notEqual(hinted.mark,'◎');
  results.explicitHint='PASS: user opened hint → persisted reference → quick result claiming 0 cannot become independent success';
  results.generatedFixtureFlow={status:'PASS',problemId:blind.problem_id,sourceAttempt:251,repairAttempt:269,retrievalAttempt:307,grading:'FIXTURE only',trainingSuccess:1,strongSuccess:0,kpi:'unchanged',reload:'PASS'};
  assert.deepEqual(errors,[]);console.log(JSON.stringify(results,null,2));
}catch(e){console.log(JSON.stringify({failed:e.message,errors,text:(await page.locator('main').innerText().catch(()=>'' )).slice(0,1800)}));throw e}
finally{await context.close();await browser.close()}
