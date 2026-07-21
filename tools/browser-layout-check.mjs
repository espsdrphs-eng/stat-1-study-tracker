import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",headless:true});
const url=process.env.APP_URL||"http://127.0.0.1:4174/";
const sizes=[{name:"ipad-landscape",width:1180,height:820},{name:"ipad-portrait",width:820,height:1180},{name:"split-view",width:600,height:900},{name:"iphone",width:390,height:844}];
await mkdir("outputs",{recursive:true});
const results=[];
try{
  for(const size of sizes){
    const context=await browser.newContext({viewport:{width:size.width,height:size.height}}),page=await context.newPage();
    await page.goto(url,{waitUntil:"networkidle"});
    await page.getByText("今日やること",{exact:true}).first().evaluate(element=>(element.closest("button")||element).click());
    await page.waitForTimeout(300);
    const dimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyWidth:document.body.scrollWidth}));
    const overflow=dimensions.scrollWidth-dimensions.clientWidth;
    if(overflow>1)throw new Error(`${size.name}: horizontal overflow ${overflow}px`);
    await page.screenshot({path:`outputs/${size.name}.png`,fullPage:true});
    await page.getByText("過去問分析",{exact:true}).first().evaluate(element=>(element.closest("button")||element).click());
    await page.waitForTimeout(300);
    const pastDimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    const pastOverflow=pastDimensions.scrollWidth-pastDimensions.clientWidth;
    if(pastOverflow>1)throw new Error(`${size.name}: past workflow horizontal overflow ${pastOverflow}px`);
    await page.screenshot({path:`outputs/${size.name}-past.png`,fullPage:true});
    results.push({...size,...dimensions,pastScrollWidth:pastDimensions.scrollWidth,status:"PASS"});
    await context.close();
  }
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
