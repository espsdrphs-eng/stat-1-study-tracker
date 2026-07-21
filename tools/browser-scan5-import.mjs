import { chromium } from "playwright-core";

const executablePath=process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseURL=process.env.APP_URL||"http://127.0.0.1:4174/";
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820}}),page=await context.newPage();
try{
  await page.goto(baseURL,{waitUntil:"networkidle"});
  await page.getByText("過去問分析",{exact:true}).first().click();
  await page.getByRole("button",{name:"事前判断を保存"}).click();
  await page.getByText("5問スキャンの事前判断を保存しました").waitFor({timeout:15000});
  const sessionId=await page.evaluate(async()=>{
    const request=indexedDB.open("stat-1-study-tracker");
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const id=await new Promise((resolve,reject)=>{const tx=db.transaction("pastSessions","readonly"),req=tx.objectStore("pastSessions").openCursor(null,"prev");req.onsuccess=()=>resolve(req.result?.key);req.onerror=()=>reject(req.error)});
    db.close();return Number(id);
  });
  const yaml=`scan_update:
  session_id: "${sessionId}"
  session_kind: "scan_plus_one"
  stage: "discrimination"
  good_decisions: []
  bad_decisions: []
  primary_selection_error: "problem_type_underclassification"
  calibration_findings: []
  next_selection_rule: ""
  next_scan_focus: ""
  candidate_review_problem_id: "2025-統計数理-問2"
  candidate_review_reason: "型の粒度を確認する"
  grading_confidence: 0.8
  rubric_version: "STAT1-SCAN5-v1"`;
  const latestCard=page.locator(".past-result-card").first();
  await latestCard.locator("details").filter({hasText:"GPT分析結果を取り込む"}).locator("summary").click();
  await latestCard.locator('textarea[placeholder="scan_update YAMLを貼り付け"]').fill(yaml);
  await latestCard.getByRole("button",{name:"専用分析を保存"}).click();
  await page.getByText("scan5分析を保存しました").waitFor({timeout:15000});
  const result=await page.evaluate(async id=>{
    const request=indexedDB.open("stat-1-study-tracker");
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const read=(store,key)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    const count=store=>new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).count();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    const session=await read("pastSessions",id),attempts=await count("attempts"),reviews=await count("reviews");db.close();
    return {analysis:session.analysis,attempts,reviews};
  },sessionId);
  if(result.analysis.primary_selection_error!=="type_misclassification")throw new Error(`alias normalization failed: ${JSON.stringify(result)}`);
  if(result.analysis.candidate_review_problem_id!==null||result.analysis.candidate_review_label!=="2025-統計数理-問2")throw new Error(`candidate handling failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({status:"PASS",url:baseURL,sessionId,primarySelectionError:result.analysis.primary_selection_error,
    rawValue:result.analysis.raw_primary_selection_error,candidateReviewProblemId:result.analysis.candidate_review_problem_id,
    candidateReviewLabel:result.analysis.candidate_review_label,attempts:result.attempts,reviews:result.reviews},null,2));
}finally{await browser.close()}
