import raw from "./data/examReferencePackV1.json" with { type: "json" };
import type { ExamReferencePackData, ReferencePackValidation } from "./examReferencePack.ts";
import {
  applyVerifiedPastExam2016To2018, PAST_EXAM_2016_2018_PACK_VERSION
} from "./pastExam2016To2018.ts";

type BuiltInExamReferencePack = {
  packHash: string;
  verifiedFiles: string[];
  data: ExamReferencePackData;
};

const base=raw as unknown as BuiltInExamReferencePack;
const data=applyVerifiedPastExam2016To2018(base.data);
// Verified algebraic operation, not a problem/chapter tag. Findings must supply
// direct evidence before this identity is eligible for live matching.
data.concepts=[...data.concepts,{concept_id:"coefficient_tracking_scale_reciprocal",
  display_name:"定数倍・逆数をまたぐ係数追跡",whitebook_chapter_number:2,
  whitebook_chapter_title:"数学的操作",past_exam_problem_ids:[],status:"verified",
  id_stability:"stable-operation-v1",source_confidence:"high",
  operation_evidence:"For c != 0 and U != 0, X=cU implies 1/X=(1/c)/U. Scale factors must be carried through reciprocal substitution; a distribution label alone is not this operation."}];
data.manifest={...data.manifest,counts:{...data.manifest.counts,concepts:data.concepts.length}};
export const BUILT_IN_EXAM_REFERENCE_PACK:BuiltInExamReferencePack={
  ...base,
  packHash:`${base.packHash}:${PAST_EXAM_2016_2018_PACK_VERSION}:coefficient-operation-v1`,
  data
};

export function builtInReferencePackValidation(
  schemaVersions: string[]
): ReferencePackValidation {
  return {
    valid: true,
    packHash: BUILT_IN_EXAM_REFERENCE_PACK.packHash,
    errors: [],
    warnings: [],
    verifiedFiles: BUILT_IN_EXAM_REFERENCE_PACK.verifiedFiles,
    schemaVersions
  };
}
