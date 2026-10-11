import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:820,height:1180},serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});
await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
const page=await context.newPage();page.setDefaultTimeout(90000);
await page.clock.install({time:new Date('2026-10-11T05:00:00Z')});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4186','--strictPort'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),45000);
 server.stdout.on('data',b=>{if(String(b).includes('4186')){clearTimeout(timer);resolve()}});server.on('error',reject)});
const nav=async(name)=>{if(page.viewportSize().width<=850){await page.locator('.menu-btn').click();await page.clock.runFor(200)}await page.getByRole('button',{name,exact:true}).click()};
const derive=()=>page.evaluate(async()=>{const {localGet}=await import('/src/localDb.ts');const s=await localGet('/api/bootstrap');return {tasks:s.today.tasks.filter(t=>t.ranking&&!t.checked),waiting:s.today.canonicalStudyPlan.ranked.waiting,audit:s.masterStatus.integrity_summary}});
const results={data:'10/9 lossless copy evaluated 10/11; NOT latest 10/11 full export',generationGrading:'model output stub in separate API sandbox; no external model called'};
try{
 await ready;await mkdir('outputs/redesign-20261011',{recursive:true});
 await page.goto('http://127.0.0.1:4186/dist/index.html',{waitUntil:'domcontentloaded'});console.log('local build document loaded');await nav('設定');
 await page.locator('.restore-button input[type=file]').setInputFiles('outputs/planner-20261009/production-copy.json');
 await page.getByText('バックアップを復元しました',{exact:true}).waitFor();
 console.log('isolated restore PASS');
 const initial=await derive();assert.ok(initial.tasks.length>10);
 await nav('今日やること');await page.locator('.ranked-study-card').first().waitFor();
 assert.equal(await page.locator('.ranked-study-card').count(),10);
 assert.doesNotMatch(await page.locator('.today-mini').innerText(),/確定課題の残り|追加可能|目標まであと/);
 await page.getByRole('button',{name:/続きを表示/}).click();assert.equal(await page.locator('.ranked-study-card').count(),20);
 assert.ok(!await page.getByRole('button',{name:/追加学習を始める|計画を作り直す/}).count());
 await page.locator('.ranked-study-card').first().getByRole('button',{name:'学習開始',exact:true}).click();
 assert.match(await page.locator('main').innerText(),/指定scope|今回の学習scope|局所|主要計算/);
 results.scopeStart='PASS';await nav('今日やること');
 while(await page.getByRole('button',{name:/続きを表示/}).count())await page.getByRole('button',{name:/続きを表示/}).click();
 const card=page.locator('.ranked-study-card').filter({has:page.getByRole('button',{name:'復習結果を記録',exact:true})}).first();
 await card.waitFor();const index=await card.evaluate(el=>Array.from(document.querySelectorAll('.ranked-study-card')).indexOf(el));
 const recorded=(await derive()).tasks[index];assert.ok(recorded.id);
 await card.getByRole('button',{name:'復習結果を記録',exact:true}).click();
 await page.getByRole('button',{name:'自力で再現できた',exact:true}).click();
 await page.getByRole('button',{name:'結果を保存',exact:true}).click();
 await page.getByText('復習結果を保存し、次回間隔を再計算しました',{exact:true}).waitFor();
 const saved=await derive();assert.ok(!saved.tasks.some(t=>t.id===recorded.id));
 results.recordSaveRerank={status:'PASS',reviewId:recorded.id,problem:recorded.problem_id,method:'self-reported unreferenced result via real modal; not GPT grading'};
 const fp=s=>s.tasks.map(t=>[t.id,t.problem_id,t.stable_session_key,t.ranking]);
 await page.reload({waitUntil:'networkidle'});assert.deepEqual(fp(await derive()),fp(saved));results.reload='PASS';
 for(const viewport of [{width:820,height:1180},{width:1180,height:820}]){
  await page.setViewportSize(viewport);await nav('今日やること');
  const dims=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dims.scroll<=dims.client+1,JSON.stringify(dims));
  await page.screenshot({path:`outputs/redesign-20261011/ranked-today-${viewport.width}.png`,fullPage:true});
  results[`viewport${viewport.width}`]={status:'PASS',dims};
 }
 // Fresh, isolated synthetic sandbox: a pending anchor repair must not leak
 // its solution into the blind annual session card/start form.
 await page.evaluate(async()=>{
  const {db,localGet,localPost}=await import('/src/localDb.ts');
  for(const name of ['attempts','reviews','weakNotes','pastSessions','sMemory'])await db[name].clear();
  for(const row of await db.meta.toArray())if(row.key.startsWith('today-plan-snapshot:')||row.key.startsWith('task-postpone:'))await db.meta.delete(row.key);
  const {EXAM_REFERENCE_EXPOSURE_META_KEY}=await import('/src/examReferencePack.ts');await db.meta.delete(EXAM_REFERENCE_EXPOSURE_META_KEY);
  await localPost('/api/attempts',{problem_id:'PY-2022-Q1',problem_id_confirmed:true,problem_id_source:'manual',date:'2026-10-10',mode:'full',mark:'△',score_label:'C',score_numeric:35,error_type:'W',error_types:['W'],error_point:'BLIND_SECRET_FAILURE',corrected_answer:'BLIND_SECRET_SOLUTION',next_action:'BLIND_SECRET_HINT',actual_reference_level:0,review_after_days:1});
  return localGet('/api/bootstrap');
 });
 await page.reload({waitUntil:'networkidle'});await nav('今日やること');
 const sandbox=await derive(),session=sandbox.tasks.find(t=>t.past_exam_year===2022&&t.minutes===90&&t.stable_session_key);
 assert.ok(session,'clean/measurement session remains eligible without daily quota');
 const sessionCard=page.locator('.ranked-study-card').filter({has:page.getByText(session.title,{exact:true})});
 assert.doesNotMatch(await sessionCard.innerText(),/BLIND_SECRET/);
 await sessionCard.getByRole('button',{name:'学習開始',exact:true}).click();
 assert.doesNotMatch(await page.locator('#past-session-form').innerText(),/BLIND_SECRET/);
 assert.doesNotMatch(await page.locator('main').innerText(),/BLIND_SECRET/,'blind start must also hide historical solution/weakness panels');
 assert.equal(await page.locator('.past-workspace-next h2').innerText(),session.title);
 results.blindSession={status:'PASS',key:session.stable_session_key,coverage:'card + entire start screen; synthetic anchor repair'};
 assert.deepEqual(errors,[]);
 await writeFile('outputs/redesign-20261011/ranked-browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){console.log(JSON.stringify({failed:e.message,errors,text:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1800)}));throw e}
finally{await context.close();await browser.close();server.kill()}
