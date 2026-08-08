import test from "node:test";
import assert from "node:assert/strict";
import {BUILT_IN_EXAM_REFERENCE_PACK} from "../src/builtinExamReferencePack.ts";
import {applyVerifiedPastExam2016To2018,PAST_EXAM_2016_2018_PACK_SHA256,PAST_EXAM_2016_2018_PACK_VERSION,
  PAST_EXAM_2016_2018_SOURCE_SHA256,VERIFIED_PAST_EXAM_2016_2018} from "../src/pastExam2016To2018.ts";
import {canonicalPastExamProblemId,validateReferencePackData} from "../src/examReferencePack.ts";

test("2016〜2018の15問を既存ID・concept registryへ検証済み素材として統合する",()=>{
  const data=BUILT_IN_EXAM_REFERENCE_PACK.data;
  const rows=data.pastExamProblems.filter(row=>[2016,2017,2018].includes(row.year));
  assert.equal(VERIFIED_PAST_EXAM_2016_2018.length,15);
  assert.equal(rows.length,15);
  assert.equal(new Set(rows.map(canonicalPastExamProblemId)).size,15);
  assert.equal(rows.every(row=>row.availability==="verified_problem"&&row.schedulable&&row.gradable),true);
  assert.equal(rows.every(row=>row.exposure_default==="unknown"&&row.simulation_protection_default===false),true);
  assert.equal(rows.every(row=>row.fine_concept_ids.length>0),true);
  assert.equal(data.manifest.counts.core_schedulable,45);
  assert.equal(data.manifest.counts.metadata_only,0);
  assert.equal(data.pastExamMetadata.supplemental_pack_version,PAST_EXAM_2016_2018_PACK_VERSION);
  assert.equal(data.pastExamMetadata.supplemental_pack_sha256,PAST_EXAM_2016_2018_PACK_SHA256);
  assert.equal(data.pastExamMetadata.supplemental_source_sha256,PAST_EXAM_2016_2018_SOURCE_SHA256);
  assert.equal(data.plannerPolicy.daily_slots.find(row=>row.slot==="score_building")?.max_count,2);
  assert.equal(validateReferencePackData(data).valid,true);
});

test("2016〜2018補足パックを2回適用しても行・source referenceが増えない",()=>{
  const once=applyVerifiedPastExam2016To2018(BUILT_IN_EXAM_REFERENCE_PACK.data);
  const twice=applyVerifiedPastExam2016To2018(once);
  assert.equal(twice.pastExamProblems.length,once.pastExamProblems.length);
  for(const row of twice.pastExamProblems.filter(item=>[2016,2017,2018].includes(item.year))){
    const sources=row.source_references.filter(source=>source.source_id.includes(PAST_EXAM_2016_2018_PACK_VERSION));
    assert.equal(sources.length,1);
  }
});
