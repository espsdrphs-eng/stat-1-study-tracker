import {chromium} from "playwright-core";
import yaml from "js-yaml";
import {mkdir} from "node:fs/promises";

const executablePath=process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseURL=process.env.APP_URL||"http://127.0.0.1:4174/";
const problemId="WB-6-A-05";
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const oldDate=(()=>{const value=new Date(`${today}T12:00:00+09:00`);value.setDate(value.getDate()-14);return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(value)})();

const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820},acceptDownloads:true});
const page=await context.newPage();
page.on("dialog",dialog=>dialog.accept());
page.on("pageerror",error=>console.error(`[browser:error] ${error.message}`));

async function importUpdate(update,{expectRebind=false}={}){
  const nav=page.getByRole("button",{name:"GPT回答取り込み",exact:true}).first();
  await nav.waitFor({timeout:20000});
  await nav.click();
  const restart=page.getByRole("button",{name:/次の取り込みを始める/});
  if(await restart.count())await restart.click();
  const paste=page.locator("textarea.paste-area");
  try{await paste.waitFor({timeout:10000})}catch(error){console.log(`IMPORT_BODY=${(await page.locator("body").innerText()).slice(0,3000)}`);throw error}
  await paste.fill(`\`\`\`yaml\n${yaml.dump({study_update:update},{noRefs:true,lineWidth:120})}\`\`\``);
  await page.getByRole("button",{name:"内容を解析する"}).click();
  if(expectRebind)await page.getByText("現在のReviewへ安全に適用します",{exact:true}).waitFor({timeout:15000});
  const save=page.getByRole("button",{name:/1件を保存する/});
  await save.waitFor({timeout:15000});
  if(!await save.isEnabled())throw new Error(`import preview is not savable: ${(await page.locator("body").innerText()).slice(-4000)}`);
  await save.click();
  await page.getByText(/1件の採点結果を登録しました/).waitFor({timeout:20000});
}

async function readStore(name){
  return page.evaluate(storeName=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("stat-1-study-tracker");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction(storeName,"readonly"),get=tx.objectStore(storeName).getAll();
      get.onerror=()=>reject(get.error);get.onsuccess=()=>{resolve(get.result);db.close()};};
  }),name);
}

try{
  await page.goto(baseURL,{waitUntil:"networkidle"});
  await importUpdate({submission_id:"browser-generation-source",problem_id:problemId,problem_id_confirmed:true,
    problem_id_source:"manual",date:oldDate,task_origin:"first_attempt",mode:"check",actual_minutes:5,
    score_label:"A",score_numeric:90,mark:"○",error_type:"none",error_types:["none"],primary_error_type:"none",
    error_point:"大きな問題なし",next_action:"初手を参照なしで保持確認する",review_after_days:14,weak_notes:[]});

  const seeded=await page.evaluate(({problemId,today,oldDate})=>new Promise((resolve,reject)=>{
    const open=indexedDB.open("stat-1-study-tracker");open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(["attempts","reviews","meta"],"readwrite"),reviews=tx.objectStore("reviews"),all=reviews.getAll();
      all.onerror=()=>reject(all.error);all.onsuccess=()=>{
        const review=all.result.filter(row=>row.problem_id===problemId&&["pending","overdue"].includes(row.status)).sort((a,b)=>b.id-a.id)[0];
        if(!review)return reject(new Error("seed Review missing"));
        review.due_date=today;review.earliest_date=today;review.preferred_date=today;review.latest_date=today;review.schedule_origin="manual";
        review.logical_review_key=String(review.logical_review_key||"").replace(/STAT1-LEARNING-v1$/,review.grading_contract?.contractVersion||"STAT1-CONTRACT-v2");
        reviews.put(review);
        const sourceRequest=tx.objectStore("attempts").get(review.generated_from_attempt_id);
        sourceRequest.onsuccess=()=>{if(sourceRequest.result)tx.objectStore("attempts").put({...sourceRequest.result,date:oldDate})};
        const task={...review,title:"browser fixture",kind:"局所補修",reason:"朝の保持確認",mode:"check",minutes:5,load:0,
          triage:"must",plan_origin:"adaptive_planner",checked:false};
        const snapshot={date:today,task_ids:[`review:${review.id}`],start_of_day_planned_minutes:5,
          initial_bucket:{[`review:${review.id}`]:"must"},initial_estimated_minutes:{[`review:${review.id}`]:5},
          tasks:[task],created_at:new Date().toISOString(),planner_source:"adaptive",planner_version:"adaptive-v1"};
        tx.objectStore("meta").put({key:`today-plan-snapshot:${today}`,value:JSON.stringify(snapshot)});
        tx.oncomplete=()=>{db.close();resolve({review,snapshot:JSON.stringify(snapshot)})};tx.onerror=()=>reject(tx.error);
      };
    };
  }),{problemId,today,oldDate});
  await page.reload({waitUntil:"networkidle"});

  const contract=seeded.review.grading_contract,errorType=contract.gradedParts[0].allowedErrorTypes.find(value=>value!=="none")||"N";
  const failedUpdate={submission_id:"browser-generation-failure",problem_id:problemId,problem_id_confirmed:true,date:today,
    mode:contract.mode,actual_minutes:5,score_label:"B",score_numeric:60,mark:"△",error_type:errorType,
    error_types:[errorType],primary_error_type:errorType,error_point:"初手を再現できない",next_action:"初手だけを修復する",
    generated_from_review_id:seeded.review.id,source_review_id:seeded.review.id,contract_id:contract.contractId,
    contract_version:contract.contractVersion,contract_hash:contract.contractHash,learning_purpose:contract.learningPurpose,
    learning_stage:contract.learningStage,assessment_timing:"delayed_retrieval",review_scope:contract.reviewScope,
    target_kind:contract.targetKind,graded_part_ids:contract.gradedParts.map(row=>row.id),
    graded_findings:contract.gradedParts.map((row,index)=>({graded_part_id:row.id,error_type:index?"none":errorType,
      evidence:index?"再現":"初手を誤った",resolved:index>0})),target_issue_resolved:false,minimum_pass_condition_met:false,
    review_outcome:"failed",actual_reference_level:0,allowed_reference_level:0,hint_used:false,unresolved_carryover:[]};
  await importUpdate(failedUpdate);

  await page.getByRole("button",{name:"問題一覧",exact:true}).first().click();
  await page.getByPlaceholder("問題ID・テーマで検索").fill(problemId);
  await page.locator("button.problem-chip").first().click();
  const attemptRow=page.locator("tbody tr").filter({hasText:"初手を再現できない"}).first();
  await attemptRow.getByRole("button",{name:"削除"}).click();
  await page.getByText(/解答履歴を無効化し、現在の復習予定を再計算しました/).waitFor({timeout:20000});

  const afterDelete=await page.evaluate(async({problemId,oldReviewId,today})=>{
    const open=indexedDB.open("stat-1-study-tracker"),db=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
    const reviews=await new Promise((resolve,reject)=>{const get=db.transaction("reviews","readonly").objectStore("reviews").getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)});
    const meta=await new Promise((resolve,reject)=>{const get=db.transaction("meta","readonly").objectStore("meta").get(`today-plan-snapshot:${today}`);get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)});
    db.close();
    const current=reviews.filter(row=>row.problem_id===problemId&&["pending","overdue"].includes(row.status)&&row.id!==oldReviewId).sort((a,b)=>b.id-a.id)[0];
    return {current,old:reviews.find(row=>row.id===oldReviewId),snapshot:meta?.value};
  },{problemId,oldReviewId:seeded.review.id,today});
  if(!afterDelete.current)throw new Error(`Current Review was not restored: ${JSON.stringify(afterDelete)}`);
  if(afterDelete.snapshot!==seeded.snapshot)throw new Error("morning snapshot was mutated");
  await page.getByRole("button",{name:"今日やること",exact:true}).first().click();
  try{await page.getByText(problemId,{exact:true}).first().waitFor({timeout:20000})}catch(error){
    throw new Error(`Current Today UI missing ${problemId}; current=${JSON.stringify({id:afterDelete.current.id,due:afterDelete.current.due_date,status:afterDelete.current.status,logical:afterDelete.current.logical_review_key,hash:afterDelete.current.contract_hash,oldLogical:afterDelete.old?.logical_review_key,oldHash:afterDelete.old?.contract_hash})}; body=${(await page.locator("body").innerText()).slice(0,4000)}`,{cause:error});
  }
  await page.getByText("任意の維持確認",{exact:true}).waitFor({timeout:20000});
  await page.getByRole("button",{name:"ダッシュボード",exact:true}).first().click();
  const nextAction=page.locator("section.next-task-card");
  if(await nextAction.count()&&(await nextAction.innerText()).includes(problemId))
    throw new Error("optional maintenance became Dashboard Next Action");

  await importUpdate({...failedUpdate,submission_id:"browser-generation-rebind"},{expectRebind:true});
  const attempts=await readStore("attempts"),reviews=await readStore("reviews");
  const rebound=attempts.find(row=>row.semantic_rebind_from_review_id===seeded.review.id);
  if(rebound?.source_review_id!==afterDelete.current.id||rebound?.semantic_rebind_from_review_id!==seeded.review.id)
    throw new Error(`semantic rebind persistence failed: ${JSON.stringify(rebound)}`);
  if(reviews.find(row=>row.id===seeded.review.id)?.status!=="done")throw new Error("historical Review changed");
  await page.getByRole("button",{name:"設定",exact:true}).first().click();
  const downloadPromise=page.waitForEvent("download",{timeout:30000});
  await page.getByRole("button",{name:"診断パック",exact:true}).click();
  const download=await downloadPromise,diagnosticPath="outputs/diagnostic-pack-review-generation-e2e.zip";
  await mkdir("outputs",{recursive:true});
  await download.saveAs(diagnosticPath);
  console.log(JSON.stringify({status:"PASS",oldReviewId:seeded.review.id,currentReviewId:afterDelete.current.id,
    currentTodayProblemId:problemId,currentTodayLane:"optional maintenance",dashboardNextAction:"not maintenance",
    reboundAttemptId:rebound.id,snapshotUnchanged:true,
    diagnosticPath},null,2));
}finally{
  await browser.close();
}
