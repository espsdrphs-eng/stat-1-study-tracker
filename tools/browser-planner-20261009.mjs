import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';

// Incognito local origin only; never attaches to production/user browser data.
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:820,height:1180},serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(180000);
await page.clock.install({time:new Date('2026-10-09T05:00:00Z')});
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
await mkdir('outputs/planner-20261009',{recursive:true});
const results=[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4175','--strictPort'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('local server startup timeout')),60000);
  server.stdout.on('data',chunk=>{if(String(chunk).includes('4175')){clearTimeout(timer);resolve();}});
  server.on('error',reject);server.on('exit',code=>reject(new Error(`local server exited ${code}`)));
});
const navigate=async name=>{
  if(page.viewportSize().width<=850){
    await page.locator('.menu-btn').waitFor({state:'visible'});
    await page.locator('.menu-btn').click();
    await page.locator('.sidebar.open').waitFor({state:'visible'});
    await page.clock.runFor(300);
  }
  await page.getByRole('button',{name,exact:true}).click();
};
try{
  await ready;
  await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'});
  await navigate('設定');
  await page.locator('.restore-button input[type=file]').setInputFiles('outputs/planner-20261009/production-copy.json');
  await page.getByText('バックアップを復元しました',{exact:true}).waitFor();
  console.log('UI restore PASS');
  // Inspect the same production entry point after the real file-upload restore.
  const derive=()=>page.evaluate(async()=>{
    const {localGet}=await import('/src/localDb.ts');const s=await localGet('/api/bootstrap');
    return {tasks:s.today.tasks.map(t=>({problem:t.problem_id,key:t.stable_session_key,triage:t.triage,checked:t.checked,
      source:t.repair_lineage?.sourceAttemptId,minutes:t.minutes})),
      blocking:s.integrityAudit?.blockingIntegrityIssueCount};
  });
  const before=await derive();
  assert.ok(!before.tasks.some(t=>!t.checked&&t.problem==='PY-2016-Q4'&&!t.key));
  assert.ok(before.tasks.some(t=>t.problem==='PY-2018-Q3'&&t.source===242&&t.triage==='must'));
  for(const viewport of [{width:820,height:1180},{width:1180,height:820}]){
    await page.setViewportSize(viewport);
    await navigate('今日やること');
    const text=await page.locator('main').innerText();assert.match(text,/2018年.*問3|PY-2018-Q3/);
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(dimensions.scroll-dimensions.width<=1,'horizontal clipping');
    await page.screenshot({path:`outputs/planner-20261009/today-${viewport.width}.png`,fullPage:true});
    results.push({viewport,Today:'PASS',dimensions});
  }
  await page.reload({waitUntil:'networkidle'});assert.deepEqual((await derive()).tasks,before.tasks);
  console.log('UI reload PASS');
  await writeFile('outputs/planner-20261009/browser.json',JSON.stringify({restore:'PASS',reload:'PASS',results},null,2));
}finally{await context.close();await browser.close();server.kill();}
