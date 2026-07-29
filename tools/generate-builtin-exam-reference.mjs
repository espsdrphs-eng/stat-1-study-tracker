import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";

const [source, output = "src/data/examReferencePackV1.json"] = process.argv.slice(2);
if (!source) {
  throw new Error("usage: node tools/generate-builtin-exam-reference.mjs <reference-pack.zip> [output.json]");
}

const bytes = await readFile(source);
const zip = await JSZip.loadAsync(bytes);
const readJson = async path => JSON.parse(await zip.file(path).async("string"));
const manifest = await readJson("PACK_MANIFEST.json");

for (const file of manifest.files) {
  const content = await zip.file(file.path).async("nodebuffer");
  const hash = createHash("sha256").update(content).digest("hex");
  if (content.byteLength !== file.bytes || hash !== file.sha256) {
    throw new Error(`reference pack verification failed: ${file.path}`);
  }
}

const past = await readJson("past_exam_master.json");
const concepts = await readJson("concept_master.json");
const links = await readJson("whitebook_exam_links.json");
const payload = {
  packHash: createHash("sha256").update(bytes).digest("hex"),
  verifiedFiles: manifest.files.map(file => file.path),
  data: {
    manifest,
    pastExamMetadata: past.metadata,
    pastExamProblems: past.problems,
    conceptMetadata: concepts.metadata,
    concepts: concepts.concepts,
    linkMetadata: links.metadata,
    whitebookLinks: links.links,
    plannerPolicy: await readJson("planner_policy_reference.json"),
    legacyConflictReport: await readJson("legacy_conflict_report.json"),
    sourceManifest: "",
    validationReport: "",
    readme: ""
  }
};

await mkdir(output.replace(/[\\/][^\\/]+$/, "") || ".", { recursive: true });
await writeFile(output, `${JSON.stringify(payload)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  packHash: payload.packHash,
  pastExamRecords: payload.data.pastExamProblems.length,
  concepts: payload.data.concepts.length,
  whitebookLinks: payload.data.whitebookLinks.length
}, null, 2));
