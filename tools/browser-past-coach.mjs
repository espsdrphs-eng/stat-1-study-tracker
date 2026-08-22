import {chromium} from "playwright-core";

const browser=await chromium.launch({
  executablePath:process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless:true,
});
const context=await browser.newContext({viewport:{width:1180,height:900},serviceWorkers:"block"});
const page=await context.newPage(),url=process.env.APP_URL||"http://127.0.0.1:4174/";
try{
  await page.goto(url,{waitUntil:"networkidle"});
  await page.getByText("詳細指標を見る",{exact:true}).click();
  await page.getByText("14日計画とフェーズ診断",{exact:true}).click();
  const planText=await page.locator(".adaptive-plan-preview").innerText();
  if(!planText.includes("2016年"))throw new Error("D87 plan has no concrete 2016 past-exam task");
  if(planText.includes("過去問素材の露出状態を確認"))throw new Error("eligible concrete material was replaced by confirmation");

  await page.getByRole("button",{name:"弱点傾向",exact:true}).evaluate(element=>element.click());
  await page.getByText("GPTで現在地をレビュー",{exact:true}).waitFor();
  await page.getByText("GPTのcoach_updateを取り込む",{exact:true}).click();
  const update={coach_update:{schema_version:"stat1-coach-v1",reviewed_at:"2026-08-20T16:00:00+09:00",
    evidence_cutoff_attempt_id:0,level:{value:3.5,label:"LEVEL 3.5",pass_outlook:"境界手前〜境界圏",confidence:"medium",rationale:"E2E fixture"},
    primary_bottleneck:{title:"制約と係数の追跡",explanation:"主要計算で再確認が必要",evidence_problem_ids:[],effect_on_exam:"部分点を失う"},
    next_actions:[{title:"制約付き計算",purpose:"主要計算",practice_method:"別問題",success_condition:"参照なしで完遂"}],
    strengths:[{title:"型識別",evidence:"代表Attempt"}],improvements:[{title:"初手",evidence:"直近改善"}],
    unknowns:[{title:"本番時間配分",evidence_needed:"timed evidence"}],optional_pass_probability:null}};
  let inJsonString=false;
  const smartJson=[...JSON.stringify(update,null,2)].map((char,index,chars)=>{
    if(char!==String.fromCharCode(34)||chars[index-1]==="\\")return char;
    inJsonString=!inJsonString;return inJsonString?"“":"”";
  }).join("");
  await page.locator("textarea.coach-paste").fill(smartJson);
  await page.getByRole("button",{name:"診断の変更内容を確認",exact:true}).click();
  const modal=page.locator(".modal").filter({hasText:"コーチ診断の変更内容"});
  try{await modal.waitFor()}catch(error){console.log((await page.locator("body").innerText()).slice(-2500));throw error}
  const diffText=await modal.innerText();
  for(const expected of ["本番レベル","合格見通し","信頼度","最大ボトルネック","制約付き計算"])
    if(!diffText.includes(expected))throw new Error(`semantic diff missing: ${expected}`);
  await modal.getByRole("button",{name:"確認して保存",exact:true}).click();
  await page.getByText("学習コーチ診断を履歴へ保存しました",{exact:false}).waitFor();
  await page.getByText("過去のコーチ診断（1件）",{exact:true}).waitFor();
  await page.getByRole("button",{name:"ダッシュボード",exact:true}).evaluate(element=>element.click());
  const kpis=page.locator(".dashboard-kpi-grid");await kpis.waitFor();
  const kpiText=await kpis.innerText();
  for(const expected of ["本番対応力","合格圏","最大ボトルネック","今やること","制約と係数の追跡"])
    if(!kpiText.includes(expected))throw new Error(`dashboard KPI missing: ${expected}`);
  const box=await kpis.boundingBox();
  if(!box||box.x<0||box.x+box.width>1180||box.y>500)throw new Error(`iPad KPI layout is outside the first view: ${JSON.stringify(box)}`);
  await page.getByRole("button",{name:"設定",exact:true}).evaluate(element=>element.click());
  const health=await page.locator(".integrity-health-card").innerText();
  if(!health.includes("正常")||!health.includes("現在の異常 0件"))throw new Error(`current audit is not clean: ${health}`);
  console.log(JSON.stringify({status:"PASS",url,concrete2016:true,genericConfirmation:false,
    coachTypographicJsonImport:true,semanticDiff:true,coachSaved:true,dashboardKpis:4,activeAuditIssues:0},null,2));
}finally{
  await context.close();await browser.close();
}
