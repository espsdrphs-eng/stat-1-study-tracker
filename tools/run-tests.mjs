import {spawn} from "node:child_process";
import {mkdir,readdir,writeFile} from "node:fs/promises";
import process from "node:process";

const files=(await readdir("tests")).filter(name=>name.endsWith(".test.mjs")).sort().map(name=>`tests/${name}`);
const child=spawn(process.execPath,["--experimental-strip-types","--test",...files],{stdio:["inherit","pipe","pipe"]});
let output="";
for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{
  const value=chunk.toString();output+=value;(stream===child.stdout?process.stdout:process.stderr).write(value);
});
const exitCode=await new Promise(resolve=>child.on("close",resolve));
if(exitCode!==0)process.exit(Number(exitCode)||1);
const matches=[...output.matchAll(/(?:ℹ|#)\s*tests\s+(\d+)/g)];
const testCount=Number(matches.at(-1)?.[1]||0);
if(!testCount)throw new Error("Node test summary did not contain an actual test count");
await mkdir("outputs",{recursive:true});
await writeFile("outputs/test-report.json",JSON.stringify({
  commit:process.env.GITHUB_SHA||process.env.VITE_APP_COMMIT||"local-build",
  testCount,generatedAt:new Date().toISOString(),command:"npm test",
},null,2));
