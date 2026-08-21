import test from "node:test";
import assert from "node:assert/strict";
import {deriveSystemHealth} from "../src/integrityEngine.ts";

const audit=(active,history)=>({generatedAt:"2026-08-22T00:00:00Z",activeIssueCount:active,historyWarningCount:history,
  informationalHistoryCount:0,issues:[
    ...Array.from({length:active},()=>({category:"current_review_target_mismatch",severity:"active",detail:"",repairable:true})),
    ...Array.from({length:history},()=>({category:"stale_today_snapshot",severity:"history",detail:"",repairable:false}))]});

test("active=0なら履歴警告が残っても正常",()=>{
  const result=deriveSystemHealth(audit(0,7));
  assert.equal(result.status,"healthy");assert.equal(result.historicalWarningCount,7);assert.equal(result.activeIssueCount,0);
});

test("active issueだけが要対応を決め、修復後は即時に正常化する",()=>{
  assert.equal(deriveSystemHealth(audit(2,7)).status,"needs_attention");
  assert.equal(deriveSystemHealth(audit(0,7)).status,"healthy");
});
