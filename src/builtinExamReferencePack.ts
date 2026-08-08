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
export const BUILT_IN_EXAM_REFERENCE_PACK:BuiltInExamReferencePack={
  ...base,
  packHash:`${base.packHash}:${PAST_EXAM_2016_2018_PACK_VERSION}`,
  data:applyVerifiedPastExam2016To2018(base.data)
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
