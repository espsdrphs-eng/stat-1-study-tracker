import raw from "./data/examReferencePackV1.json" with { type: "json" };
import type { ExamReferencePackData, ReferencePackValidation } from "./examReferencePack.ts";

type BuiltInExamReferencePack = {
  packHash: string;
  verifiedFiles: string[];
  data: ExamReferencePackData;
};

export const BUILT_IN_EXAM_REFERENCE_PACK = raw as unknown as BuiltInExamReferencePack;

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
