import {chromium} from "playwright-core";
import yaml from "js-yaml";

const executablePath=process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseURL=process.env.APP_URL||"http://127.0.0.1:4174/";
const problemId="WB-6-A-05";
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820}});
const page=await context.newPage();

async function importUpdate(update){
  await page.getByRole("button",{name:"GPT回答取り込み",exact:true}).first().click();
  const restart=page.getByRole("button",{name:/次の取り込みを始める/});
  if(await restart.count())await restart.click();
  await page.locator("textarea.paste-area").fill(`\`\`\`yaml\n${yaml.dump({study_update:update},{noRefs:true,lineWidth:120})}\`\`\``);
  await page.getByRole("button",{name:"内容を解析する"}).click();
  const save=page.getByRole("button",{name:/1件を保存する/});
  await save.waitFor({timeout:15000});
  if(!await save.isEnabled())throw new Error(`replacement preview blocked: ${(await page.locator("body").innerText()).slice(-3000)}`);
  await save.click();
  await page.getByText(/1件の採点結果を登録しました/).waitFor({timeout:20000});
}

async function attempts(){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open("stat-1-study-tracker");open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,get=db.transaction("attempts","readonly").objectStore("attempts").getAll();
      get.onerror=()=>reject(get.error);get.onsuccess=()=>{resolve(get.result);db.close()};
    };
  }));
}

try{
  await page.goto(baseURL,{waitUntil:"networkidle"});
  await importUpdate({submission_id:"browser-replace-A",problem_id:problemId,problem_id_confirmed:true,date:today,
    task_origin:"first_attempt",mode:"main_calc",actual_minutes:10,score_label:"B",score_numeric:60,
    error_type:"W",error_types:["W"],primary_error_type:"W",error_point:"主要計算を誤った",next_action:"主要計算を直す"});
  const attemptA=(await attempts()).filter(row=>row.problem_id===problemId&&row.error_point==="主要計算を誤った").sort((a,b)=>b.id-a.id)[0];
  if(!attemptA)throw new Error("Attempt A missing");

  await page.getByRole("button",{name:"問題一覧",exact:true}).first().click();
  await page.getByPlaceholder("問題ID・テーマで検索").fill(problemId);
  await page.locator("button.problem-chip").first().click();
  const rowA=page.locator("tbody tr").filter({hasText:"主要計算を誤った"}).first();
  await rowA.getByRole("button",{name:"解答を差し替える"}).click();
  await page.getByRole("heading",{name:"解答を差し替えて再採点"}).waitFor();
  await page.getByRole("button",{name:"GPT回答取り込みへ"}).click();

  await page.locator("textarea.paste-area").fill(`\`\`\`yaml\n${yaml.dump({study_update:{submission_id:"browser-replace-B",
    replacement_for_attempt_id:attemptA.id,replacement_reason:"ブラウザE2E答案差し替え",problem_id:problemId,
    problem_id_confirmed:true,date:today,task_origin:"first_attempt",mode:"main_calc",actual_minutes:10,
    score_label:"S",score_numeric:100,error_type:"none",error_types:["none"],primary_error_type:"none",
    error_point:"大きな問題なし",next_action:"別問題へ進む"}},{noRefs:true,lineWidth:120})}\`\`\``);
  await page.getByRole("button",{name:"内容を解析する"}).click();
  await page.getByText("解答を差し替えて正式再採点します").waitFor();
  const save=page.getByRole("button",{name:/1件を保存する/});
  if(!await save.isEnabled())throw new Error("replacement save disabled");
  await save.click();await page.getByText(/1件の採点結果を登録しました/).waitFor({timeout:20000});

  const rows=await attempts(),savedA=rows.find(row=>row.id===attemptA.id),attemptB=rows.find(row=>row.replaces_attempt_id===attemptA.id);
  if(!attemptB||savedA?.superseded_by_attempt_id!==attemptB.id||!savedA.exclude_from_metrics||attemptB.replaces_attempt_id!==attemptA.id)
    throw new Error(`replacement lineage mismatch: ${JSON.stringify({savedA,attemptB})}`);

  await page.getByRole("button",{name:"問題一覧",exact:true}).first().click();
  await page.getByPlaceholder("問題ID・テーマで検索").fill(problemId);await page.locator("button.problem-chip").first().click();
  await page.getByText(new RegExp(`差替済 → #${attemptB.id}`)).waitFor();
  const currentRow=page.locator("tbody tr").filter({hasText:"別問題へ進む"}).first();
  await currentRow.getByRole("button",{name:"答案全体を再診断"}).click();
  await page.getByRole("heading",{name:"答案全体を再診断"}).waitFor();
  await page.locator(".modal .modal-head button").click();
  let deleteMessage="";page.once("dialog",async dialog=>{deleteMessage=dialog.message();await dialog.dismiss()});
  await currentRow.getByRole("button",{name:"削除"}).click();
  if(!/解答を差し替えて再採点/.test(deleteMessage))throw new Error(`delete guidance missing: ${deleteMessage}`);
  console.log(JSON.stringify({status:"PASS",attemptA:attemptA.id,attemptB:attemptB.id,historyPreserved:true,
    threeActionsVisible:true,deleteGuidance:true},null,2));
}finally{await browser.close()}
