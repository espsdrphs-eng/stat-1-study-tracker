import { chromium } from "playwright-core";

const executablePath=process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseURL=process.env.APP_URL||"http://127.0.0.1:4174/";
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820}});
const page=await context.newPage();
page.on("console",message=>console.log(`[browser:${message.type()}] ${message.text()}`));
page.on("pageerror",error=>console.error(`[browser:error] ${error.message}`));
try{
  await page.goto(baseURL,{waitUntil:"networkidle"});
  await page.waitForTimeout(1000);
  if(!await page.getByText("GPT回答取り込み",{exact:true}).count())console.log(`BODY=${(await page.locator("body").innerText()).slice(0,1500)}`);
  await page.getByText("GPT回答取り込み",{exact:true}).first().click();
  const yaml=`study_update:
  problem_id: "WB-6-A-05"
  date: "auto_today"
  task_origin: "first_attempt"
  mode: "check"
  actual_minutes: 5
  mark: "◎"
  score_text: "A"
  score_numeric: 90
  error_types:
    - "none"
  primary_error_type: "none"
  next_action: "型と初手を軽く確認する"
  review_after_days: 14
  rubric_version: "STAT1-GRADE-v5"
  weak_notes: []`;
  await page.locator("textarea.paste-area").fill(yaml);
  await page.getByRole("button",{name:"内容を解析する"}).click();
  const saveButton=page.getByRole("button",{name:/1件を保存する/});
  try{await saveButton.waitFor({timeout:10000})}catch(error){console.log(`PARSE_BODY=${(await page.locator("body").innerText()).slice(-2500)}`);throw error}
  await saveButton.click();
  try{await page.getByText(/1件を保存しました|1件の採点結果を登録しました/).first().waitFor({timeout:15000})}catch(error){console.log(`SAVE_BODY=${(await page.locator("body").innerText()).slice(-3500)}`);throw error}
  const result=await page.evaluate(async()=>{
    const request=indexedDB.open("stat-1-study-tracker");
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const stores=Array.from(db.objectStoreNames);
    const count=await new Promise((resolve,reject)=>{const tx=db.transaction("attempts","readonly"),req=tx.objectStore("attempts").count();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    db.close();return {stores,count};
  });
  if(!result.stores.includes("attempts")||result.count<1)throw new Error(`保存後のDB検証に失敗: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({status:"PASS",url:baseURL,attemptCount:result.count,stores:result.stores},null,2));
}finally{
  await browser.close();
}
