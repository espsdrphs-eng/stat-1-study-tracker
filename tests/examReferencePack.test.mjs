import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import JSZip from "jszip";
import {
  buildPastExamCatalog, canonicalPastExamProblemId, orderCorePastExamYears,
  parseExamReferencePack, reconcileExamReferencePack,
  validateReferencePackData
} from "../src/examReferencePack.ts";
import {concept,pastProblem,problem,record} from "./adaptiveFixture.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
async function zipFixture({tamper=false}={}){
  const payloads={
    "README.md":"fixture",
    "concept_master.json":JSON.stringify({metadata:{schema_version:"stat1-concept-master-v1"},concepts:[concept()]}),
    "legacy_conflict_report.json":JSON.stringify({do_not_use_as_canonical:[],reason:"",examples:[],required_action:""}),
    "past_exam_master.json":JSON.stringify({metadata:{schema_version:"stat1-exam-reference-v1"},problems:[
      pastProblem(2021),pastProblem(2018,1,["c1"],{availability:"metadata_only",schedulable:false,gradable:false,
        simulation_protection_default:false})
    ]}),
    "planner_policy_reference.json":JSON.stringify({metadata:{schema_version:"stat1-adaptive-planner-policy-v1",
      created_at:"2026-07-01",purpose:"test",exam_date:"2026-11-15",timezone:"Asia/Tokyo",default_daily_minutes:150},
      daily_slots:[],phases:[],weakness_evidence:{},past_exam_loop:[],exposure_states:[],exposure_rules:[],
      snapshot_rule:"immutable",non_goals:[]}),
    "source_manifest.md":"sources",
    "validation_report.md":"valid",
    "whitebook_exam_links.json":JSON.stringify({metadata:{schema_version:"stat1-whitebook-exam-links-v1"},links:[
      {past_exam_problem_id:"PE-2021-Q01",whitebook_problem_id:"WB-4-A-01",relation_type:"remediation",
        priority_rank:1,reason:"変数変換",confidence:"candidate",
        requires_user_confirmation_before_task_creation:true,requires_live_problem_master_reconciliation:true}
    ]})
  };
  const files=Object.entries(payloads).map(([path,value])=>({path,bytes:Buffer.byteLength(value),sha256:sha(value)}));
  if(tamper)files[0].sha256="0".repeat(64);
  const manifest={pack_name:"stat1_exam_reference_pack_v1",created_at:"2026-07-01",
    files,counts:{past_exam_records:2,core_schedulable:1,metadata_only:1,concepts:1,whitebook_links:1}};
  const zip=new JSZip();zip.file("PACK_MANIFEST.json",JSON.stringify(manifest));
  for(const [path,value] of Object.entries(payloads))zip.file(path,value);
  return zip.generateAsync({type:"uint8array"});
}

test("manifest・file hash・件数・schemaを検証できる",async()=>{
  const parsed=await parseExamReferencePack(await zipFixture());
  assert.equal(parsed.validation.valid,true);
  assert.equal(parsed.validation.verifiedFiles.length,8);
  assert.equal(parsed.data.manifest.counts.core_schedulable,1);
  assert.match(parsed.validation.schemaVersions.join(","),/stat1-adaptive-planner-policy-v1/);
});

test("hash不一致のpackを採用不可にする",async()=>{
  const parsed=await parseExamReferencePack(await zipFixture({tamper:true}));
  assert.equal(parsed.validation.valid,false);
  assert.match(parsed.validation.errors.join(" "),/sha256不一致/);
});

test("2020とmetadata-onlyの出題可能化を拒否する",()=>{
  const base={manifest:{pack_name:"stat1_exam_reference_pack_v1",counts:{past_exam_records:1,core_schedulable:1,metadata_only:0,concepts:1,whitebook_links:0}},
    pastExamProblems:[pastProblem(2020)],concepts:[concept()],whitebookLinks:[],
    plannerPolicy:{metadata:{schema_version:"stat1-adaptive-planner-policy-v1",timezone:"Asia/Tokyo"}},
    pastExamMetadata:{},conceptMetadata:{},linkMetadata:{},legacyConflictReport:{},sourceManifest:"",validationReport:"",readme:""};
  assert.match(validateReferencePackData(base).errors.join(" "),/2020年/);
});

test("live masterは汎用値だけ補完し、固有競合を上書き候補にしない",async()=>{
  const {data}=await parseExamReferencePack(await zipFixture());
  const generic={...problem("PY-2021-Q1",null,"past_exam"),theme:"過去問・テーマ未登録",metadata_status:"review_needed"};
  const first=reconcileExamReferencePack({data,problems:[generic,problem("WB-4-A-01")],aliases:[]});
  assert.equal(first.safePastExamEnrichments,1);
  assert.equal(first.resolvedWhitebookLinks,1);
  const precise={...generic,theme:"既存の確認済み固有テーマ",metadata_status:"verified"};
  const second=reconcileExamReferencePack({data,problems:[precise],aliases:[]});
  assert.equal(second.pastExamConflicts,1);
  assert.equal(canonicalPastExamProblemId("PE-2021-Q01"),"PY-2021-Q1");
});

test("未解決白本IDはunresolvedとして明示する",async()=>{
  const {data}=await parseExamReferencePack(await zipFixture());
  const result=reconcileExamReferencePack({data,problems:[],aliases:[]});
  assert.equal(result.unresolvedWhitebookLinks,1);
  assert.deepEqual(result.unresolvedWhitebookIds,["WB-4-A-01"]);
});

test("core年度だけを動的表示し、計画候補と露出状態から年度順を決める",()=>{
  const coreYears=[2019,2021,2022,2023,2024,2025];
  const pastExamProblems=[
    ...coreYears.flatMap(year=>Array.from({length:5},(_,index)=>pastProblem(year,index+1,["c1"],{
      simulation_protection_default:[2024,2025].includes(year)
    }))),
    pastProblem(2018,1,["c1"],{availability:"metadata_only",schedulable:false,gradable:false,
      simulation_protection_default:false})
  ];
  const fixture=record({data:{...record().data,pastExamProblems}});
  const catalog=buildPastExamCatalog({record:fixture,sessions:[],exposureOverrides:{
    "PY-2021-Q1":"prompt_scanned"
  }});
  assert.equal(catalog.length,30);
  assert.equal(catalog.some(row=>row.year===2018),false);
  const years=orderCorePastExamYears({
    catalog,plannedReferenceProblemIds:["PE-2021-Q01"],daysRemaining:109
  });
  assert.deepEqual(new Set(years),new Set(coreYears));
  assert.equal(years[0],2021);
  assert.ok(years.indexOf(2024)>years.indexOf(2019));
});
