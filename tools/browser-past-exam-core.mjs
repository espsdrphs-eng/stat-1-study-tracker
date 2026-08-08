import {chromium} from "playwright-core";
import {mkdir} from "node:fs/promises";

const browser=await chromium.launch({
  executablePath:process.env.EDGE_PATH||
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless:true
});
const url=process.env.APP_URL||"http://127.0.0.1:4174/";
const expectedYears=[2016,2017,2018,2019,2021,2022,2023,2024,2025];
const sizes=[
  {name:"ipad-landscape",width:1180,height:820},
  {name:"ipad-portrait",width:820,height:1180},
  {name:"split-view",width:600,height:900}
];
await mkdir("outputs",{recursive:true});
const results=[];
try{
  for(const size of sizes){
    const context=await browser.newContext({viewport:size,serviceWorkers:"block"});
    const page=await context.newPage();
    await page.goto(url,{waitUntil:"networkidle"});
    await page.getByRole("button",{name:"問題一覧",exact:true}).evaluate(element=>element.click());
    await page.locator(".past-problem-master").waitFor();
    const header=await page.locator(".past-problem-master h3").innerText();
    if(header.includes("2024 → 2025 → 2022 → 2023"))throw new Error("旧固定年度順が残っています");
    const rows=await page.locator(".past-year-row").evaluateAll(elements=>elements.map(element=>({
      year:Number(element.querySelector(":scope > strong")?.textContent),
      questions:element.querySelectorAll(".problem-chip").length
    })));
    if(JSON.stringify([...rows.map(row=>row.year)].sort())!==JSON.stringify(expectedYears)){
      throw new Error(`${size.name}: core year mismatch ${JSON.stringify(rows)}`);
    }
    if(rows.some(row=>row.questions!==5))throw new Error(`${size.name}: each year must have five questions`);
    const dimensions=await page.evaluate(()=>({
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth
    }));
    if(dimensions.scrollWidth-dimensions.clientWidth>1)throw new Error(`${size.name}: horizontal overflow`);
    await page.screenshot({path:`outputs/${size.name}-past-exam-core.png`,fullPage:true});
    results.push({...size,header,rows,dimensions,status:"PASS"});
    await context.close();
  }
  console.log(JSON.stringify({expectedYears,results},null,2));
}finally{
  await browser.close();
}
