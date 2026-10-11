import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStudyText} from '../src/importParser.ts';
const update={problem_id:'PY-2018-Q4',score_numeric:100,error_types:['none'],contract_id:'review:pending:fixture',graded_part_ids:['major_calculation'],graded_findings:[{graded_part_id:'major_calculation',error_type:'none',resolved:true,evidence:'FIXTURE'}]};
test('grading JSON and fenced JSON preserve scores, contract and findings like the YAML envelope',()=>{
 for(const text of [JSON.stringify({study_update:update}),`\`\`\`json\n${JSON.stringify({study_updates:[update]})}\n\`\`\``]){
  const parsed=parseStudyText(text,[]);assert.equal(parsed.structured,true);assert.equal(parsed.updates[0].score_numeric,100);assert.equal(parsed.updates[0].contract_id,update.contract_id);assert.equal(parsed.updates[0].graded_findings[0].resolved,true);
 }
});
test('malformed grading JSON is rejected rather than silently treated as free text',()=>{
 assert.throws(()=>parseStudyText('{"study_update":{"problem_id":"PY-2018-Q4",}}',[]),/JSON/);
});
