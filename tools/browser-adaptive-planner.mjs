import {chromium} from "playwright-core";
import {mkdir} from "node:fs/promises";

const packPath=process.env.REFERENCE_PACK_PATH;
if(!packPath)throw new Error("REFERENCE_PACK_PATHに正規化済み参照パックZIPを指定してください");
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",headless:true});
const context=await browser.newContext({viewport:{width:1180,height:820},serviceWorkers:"block"});
const page=await context.newPage(),url=process.env.APP_URL||"http://127.0.0.1:4174/";
await mkdir("outputs",{recursive:true});
const clickNav=async name=>{
  await page.getByRole("button",{name,exact:true}).evaluate(element=>element.click());
  await page.waitForTimeout(150);
};
try{
  await page.goto(url,{waitUntil:"networkidle"});
  await clickNav("設定");
  await page.locator("details.advanced-management > summary").click();
  await page.locator("#exam-reference-pack-import input[type=file]").setInputFiles(packPath);
  await page.getByText("検証成功",{exact:true}).waitFor();
  const preview=await page.locator("#exam-reference-pack-import").evaluate(element=>element.textContent);
  for(const expected of ["45","30","15","82","87"])if(!preview.includes(expected))throw new Error(`preview count missing: ${expected}`);
  await page.getByRole("button",{name:"解決可能なデータだけを採用",exact:true}).click();
  await page.getByText("shadow比較を開始しました",{exact:false}).waitFor();
  await clickNav("過去問分析");
  await page.locator("details.reference-catalog-panel > summary").click();
  await page.locator(".reference-year-list details > summary").first().click();
  const firstCoreSelect=page.locator(".reference-question-row select").first();
  await firstCoreSelect.selectOption("fully_attempted");
  await page.getByText("過去問の露出状態を保存しました",{exact:false}).waitFor();
  const sizes=[
    {name:"ipad-landscape",width:1180,height:820},{name:"ipad-portrait",width:820,height:1180},
    {name:"split-view",width:600,height:900},{name:"iphone",width:390,height:844}
  ],results=[];
  for(const size of sizes){
    await page.setViewportSize({width:size.width,height:size.height});
    await clickNav("ダッシュボード");
    await page.getByText("合格逆算プランナー（shadow）",{exact:true}).waitFor();
    const dashboard=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    await clickNav("弱点傾向");
    await page.getByText("独立した学習機会で見る弱点",{exact:true}).waitFor();
    const weakness=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    await clickNav("過去問分析");
    await page.getByText("正規化済み過去問カタログと露出状態",{exact:true}).waitFor();
    const past=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    if([dashboard,weakness,past].some(row=>row.scrollWidth-row.clientWidth>1))throw new Error(`${size.name}: horizontal overflow`);
    await page.screenshot({path:`outputs/${size.name}-adaptive-past.png`,fullPage:true});
    results.push({...size,dashboard,weakness,past,status:"PASS"});
  }
  console.log(JSON.stringify({previewVerified:true,results},null,2));
}finally{
  await context.close();await browser.close();
}
