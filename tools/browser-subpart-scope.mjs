import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
await mkdir('outputs/subparts-20261012',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820},permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(90000);
const nav=async name=>{if(page.viewportSize().width<=850)await page.locator('.menu-btn').click();await page.getByRole('button',{name,exact:true}).first().click();if(page.viewportSize().width<=850)await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);};
const list=async id=>{await nav('問題一覧');await page.getByPlaceholder('問題ID・問題名で検索').fill(id);return page.locator(`tr[data-problem-id="${id}"]`);};
const report={status:'RUNNING',scopes:[],ipad:[],grading:'NOT RUN',manual:'NOT RUN'};
try{
 await page.goto(process.env.APP_URL||'http://127.0.0.1:4186/');await nav('設定');page.on('dialog',d=>d.accept());
 await page.locator('.restore-button input[type=file]').setInputFiles(process.env.STUDY_EXPORT);await page.getByText('バックアップを復元しました',{exact:true}).waitFor();
 const before=await page.evaluate(async()=>{const {db}=await import('/src/localDb.ts');return {attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),weakNotes:await db.weakNotes.toArray()};});
 for(const [id,expected] of [['PY-2022-Q1','主対象：小問2・小問3・小問4'],['PY-2019-Q3','主対象：[6] ／ 補助確認：[1]・[3] ／ 参照のみ：[5]'],['PY-2018-Q4','主対象：[2]・[3]'],['PY-2018-Q5','主対象：[3] ／ 補助確認：[1]・[2]']]){
  const row=await list(id);await row.waitFor();assert.equal(await row.locator('.answer-scope').innerText(),expected);assert.equal(await page.locator('.problem-table thead th').count(),5);
  await row.getByRole('button',{name:'問題を開く',exact:true}).click();await page.locator('.task-introduction').waitFor();assert.ok((await page.locator('.task-introduction').innerText()).includes(expected));
  assert.equal(await page.getByRole('button',{name:'解答作成を開始',exact:true}).count(),0);
  const refs=await page.evaluate(async()=>{const {db}=await import('/src/localDb.ts');return (await db.reviews.toArray()).map(r=>[r.id,r.actual_reference_level,r.hint_used]);});assert.deepEqual(refs,before.reviews.map(r=>[r.id,r.actual_reference_level,r.hint_used]));
  report.scopes.push({id,scope:expected,tableAndDetail:'PASS'});
 }
 await nav('今日やること');
 const expectedToday=await page.evaluate(async()=>{const d=await (await import('/src/localDb.ts')).localGet('/api/bootstrap'),{deriveTaskIntroduction}=await import('/src/learningFeedback.ts');
  return d.today.tasks.filter(t=>t.ranking&&!t.checked&&!t.stable_session_key&&!t.transfer_training_key).map(t=>({id:t.problem_id,title:t.title,scope:deriveTaskIntroduction(d,d.problems.find(p=>p.problem_id===t.problem_id),t).subparts}));});
 const first=expectedToday[0];assert.ok(first);assert.ok((await page.locator('.ranked-study-card').first().innerText()).includes(first.scope));
 const todayCard=page.locator('.ranked-study-card').first();await todayCard.getByRole('button',{name:'学習開始',exact:true}).click();assert.ok((await page.locator('.task-introduction').innerText()).includes(first.scope));
 const firstRow=await list(first.id);assert.equal(await firstRow.locator('.answer-scope').innerText(),first.scope);report.today={problem:first.id,scope:first.scope,tableDetail:'PASS'};
 for(const viewport of [{width:820,height:1180},{width:1180,height:820}]){
  await page.setViewportSize(viewport);await list('PY-2018-Q5');await page.getByLabel('出典',{exact:true}).selectOption('past_exam');await page.getByPlaceholder('問題ID・問題名で検索').fill('');const row=page.locator('.problem-table tbody tr').first();await row.waitFor();
  assert.equal(await page.locator('.problem-table').evaluate(e=>getComputedStyle(e).display),'table');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(await row.locator('th').evaluate(e=>getComputedStyle(e).position),'sticky');
  await page.screenshot({path:`outputs/subparts-20261012/table-${viewport.width}.png`});report.ipad.push({width:viewport.width,table:true,documentOverflow:false});
 }
 // Unknown scope must be explicit and selectable without entering an answer or recording a hint.
 const unknown=await page.evaluate(async()=>{const d=await (await import('/src/localDb.ts')).localGet('/api/bootstrap'),{deriveTaskIntroduction}=await import('/src/learningFeedback.ts');return d.problems.filter(p=>p.source_type==='past_exam').map(p=>({id:p.problem_id,intro:deriveTaskIntroduction(d,p)})).find(p=>p.intro.answerScope.status==='unknown');});
 if(unknown){
 const row=await list(unknown.id);await row.getByRole('button',{name:'問題を開く',exact:true}).click();await page.locator('.task-scope-selection').waitFor();
 await page.getByLabel('主対象の小問',{exact:true}).fill('[3]');await page.getByLabel('補助確認の小問',{exact:true}).fill('[1]');await page.getByLabel('参照のみの小問',{exact:true}).fill('[2]');
 await page.getByRole('button',{name:'今回の対象小問を保存',exact:true}).click();await page.getByText('今回の課題の小問範囲を保存しました',{exact:true}).waitFor();
 await page.locator('.task-scope-selection').waitFor({state:'hidden'});await page.reload();await list(unknown.id);await page.locator(`tr[data-problem-id="${unknown.id}"]`).getByRole('button',{name:'問題を開く',exact:true}).click();assert.ok((await page.locator('.task-introduction').innerText()).includes('主対象：[3] ／ 補助確認：[1] ／ 参照のみ：[2]'));
 report.manual={problem:unknown.id,scopeKey:unknown.intro.answerScope.scopeKey,saveAndReload:'PASS'};
 }else report.manual='Not needed: current copy has no unidentified scope; synthetic persistence regression separately';
 const noChange=await page.evaluate(async()=>{const {db}=await import('/src/localDb.ts');return {attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),weakNotes:await db.weakNotes.toArray()};});
 assert.deepEqual(noChange.attempts,before.attempts);assert.deepEqual(noChange.reviews,before.reviews);assert.deepEqual(noChange.weakNotes,before.weakNotes);
 const gradeRow=await list('PY-2018-Q5');await gradeRow.getByRole('button',{name:'問題を開く',exact:true}).click();await page.getByRole('button',{name:'答案完成・採点へ進む',exact:true}).click();
 await page.locator('.answer-summary').getByRole('button',{name:'採点プロンプトをコピー',exact:true}).click();await page.getByRole('button',{name:'コピー済み',exact:true}).waitFor();
 const prompt=await page.evaluate(()=>navigator.clipboard.readText());assert.match(prompt,/主対象：\[3\]/);assert.match(prompt,/補助確認：\[1\]・\[2\]/);assert.match(prompt,/未回答として減点しない/);assert.match(prompt,/答案画像/);
 const grade=await page.evaluate(async()=>{const d=await (await import('/src/localDb.ts')).localGet('/api/bootstrap'),w=d.learningWorkByProblem['PY-2018-Q5'];const t=w.reviewId?d.reviews.find(r=>r.id===w.reviewId):w.task,c=t.grading_contract;return {study_update:{problem_id:'PY-2018-Q5',date:d.dashboard.today,mode:c.mode,score_numeric:100,mark:'○',score_label:'A',error_type:'none',error_types:['none'],reference_level:0,actual_reference_level:0,hint_used:false,no_hint:true,grading_confidence:99,learning_purpose:c.learningPurpose,learning_stage:c.learningStage,assessment_timing:c.assessmentTiming,target_kind:c.targetKind,review_scope:c.reviewScope,minimum_pass_condition_met:true,target_issue_resolved:true,review_outcome:'success',contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,source_attempt_id:c.sourceAttemptId,source_review_id:c.reviewId,generated_from_review_id:c.reviewId,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 指定の[3]と補助確認[1][2]のみを画像採点。'}))}};});
 await page.locator('.answer-summary').getByRole('button',{name:'GPT採点結果を取り込む',exact:true}).click();await page.locator('.modal .paste-area').fill(JSON.stringify(grade));await page.locator('.modal').getByRole('button',{name:'内容を解析する',exact:true}).click();
 await page.locator('.modal').getByRole('button',{name:'1件を保存する',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.modal')||!!document.querySelector('.toast.danger'));if(await page.locator('.toast.danger').count())throw new Error(await page.locator('.toast.danger').innerText());
 const after=await page.evaluate(async()=>{const {db}=await import('/src/localDb.ts');return (await db.attempts.where('problem_id').equals('PY-2018-Q5').toArray()).at(-1);});assert.equal(after.score_numeric,100);assert.equal(after.time_minutes,null);
 report.grading={method:'fixture JSON (not human ChatGPT roundtrip)',savedAttempt:after.id,netMinutes:after.time_minutes,oldAttemptsPreserved:true};
 await page.reload();const restored=await page.evaluate(async id=>await (await import('/src/localDb.ts')).db.attempts.get(id),after.id);assert.equal(restored.score_numeric,100);
 report.status='PASS';await writeFile('outputs/subparts-20261012/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await page.screenshot({path:'outputs/subparts-20261012/browser-failure.png'});throw e;}finally{await context.close();await browser.close();}
