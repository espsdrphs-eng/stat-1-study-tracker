import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {groundedFindingSkills} from '../src/groundedSkills.ts';
import {findingSkillIds,deriveTransferEvidence} from '../src/skillEvidence.ts';

test('skill extraction remains responsive on a long nonmatching finding',()=>{
 const finding={graded_part_id:'major_calculation',evidence:'a'.repeat(30000)};
 const start=performance.now();assert.deepEqual(groundedFindingSkills({id:1,graded_findings:[finding]},finding),[]);
 assert.ok(performance.now()-start<300,'skill extraction must not repeatedly rescan every suffix');
});
test('scope reuses evidence without leaking edits into the next derivation',async()=>{
 const {withSkillEvidenceMemo}=await import('../src/skillEvidence.ts');
 const f={graded_part_id:'major_calculation',evidence:'逆数へ変換するとき係数2を落とした',error_type:'W',resolved:false};
 const a={id:1,problem_id:'PY-2000-Q1',graded_findings:[f]},attempts=[a];
 withSkillEvidenceMemo(()=>{assert.strictEqual(findingSkillIds(a,f),findingSkillIds(a,f));assert.strictEqual(deriveTransferEvidence(attempts),deriveTransferEvidence(attempts));});
 f.evidence='技能の根拠は不明';
 withSkillEvidenceMemo(()=>assert.deepEqual(findingSkillIds(a,f),[]));
});
test('reload coalesces callers and rejects stale results after a mutation',async()=>{
 const {createStateReloadCoordinator}=await import('../src/stateReload.ts');
 const gates=[],published=[];let reads=0;
 const loader=createStateReloadCoordinator({read:()=>{reads++;return new Promise(resolve=>gates.push(resolve));},publish:s=>published.push(s)});
 const first=loader.load();assert.strictEqual(first,loader.load());await Promise.resolve();assert.equal(reads,1);
 loader.invalidate();gates.shift()('old');await new Promise(r=>setImmediate(r));assert.equal(reads,2);assert.deepEqual(published,[]);
 gates.shift()('new');await first;assert.deepEqual(published,['new']);
 const mutation=loader.mutate(async()=>{loader.invalidate();void loader.load();loader.invalidate();});
 await mutation;const refreshed=loader.load();await new Promise(r=>setImmediate(r));assert.equal(reads,3);
 gates.shift()('saved');await refreshed;assert.deepEqual(published,['new','saved']);
});
test('same-window event plus BroadcastChannel is delivered once, foreign events still arrive',async()=>{
 const originalWindow=globalThis.window,originalChannel=globalThis.BroadcastChannel;
 const target=new EventTarget(),channels=[];
 globalThis.window=target;
 class Channel {constructor(){channels.push(this);}postMessage(data){for(const c of channels)if(c!==this&&!c.closed)queueMicrotask(()=>c.onmessage?.({data}));}close(){this.closed=true;}}
 globalThis.BroadcastChannel=Channel;
 try{const {subscribeStudyDataChanged,notifyStudyDataChanged}=await import('../src/appEvents.ts');const events=[];
  const stop=subscribeStudyDataChanged(e=>events.push(e));notifyStudyDataChanged({operation:'save-test'});await new Promise(r=>setImmediate(r));
  assert.equal(events.length,1);const foreign=new Channel();foreign.postMessage({type:'study-data-changed',operation:'other-tab',occurredAt:'now',eventId:'foreign-1'});await new Promise(r=>setImmediate(r));assert.equal(events.length,2);stop();
 }finally{globalThis.window=originalWindow;globalThis.BroadcastChannel=originalChannel;}
});
test('old same-line skill recognition is preserved, including Unicode line separators and confidence',async()=>{
 const original=[
 ['coefficient_tracking_scale_reciprocal',/(?=.*(?:1\/Xbar|逆数))(?=.*(?:係数|定数倍))/,/係数が不明|操作が不明/],
 ['conditional_distribution',/(?=.*(?:条件付き密度|条件付き分布|X\|Z.{0,8}分布))(?=.*(?:Bayes|ベイズ|X\|Z|f\([^)]*\|[^)]*\)))/i,/条件付き期待値だけ|周辺密度の積だけ/],
 ['risk_function',/(?=.*(?:R\((?:alpha|α)\)|リスク))(?=.*(?:係数.?2|1\/Xbar|逆数))/i,/リスクが未定義|係数が不明/],
 ['moment_generating_function',/積率母関数|モーメント母関数|\bMGF\b/i,/存在しない|一意性|Taylor|テイラー|連続性定理|標準化極限|畳み込み/i],
 ['law_total_variance',/全分散(?:公式)?/,/帰納|周辺化/],
 ['finite_population_correction',/有限母集団修正|(?=.*非復元抽出)(?=.*(?:負の共分散|共分散))/,/適用できるか不明|どの補正を使うか不明/],
 ];
 const texts=['','係数2を逆数変換で失った','Bayesで条件付き密度を導出','MGF Taylor','有限母集団修正','係数が不明だが逆数',
 ...['\n','\r','\r\n','\u2028','\u2029'].flatMap(e=>[`逆数${e}係数2`,`非復元抽出${e}共分散`,`Bayes${e}条件付き分布`])];
 try{const data=JSON.parse(await readFile('outputs/planner-20261009/production-copy.json','utf8'));texts.push(...data.attempts.flatMap(a=>(a.graded_findings||[]).map(f=>f.evidence||'')));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const evidence of texts){const matches=original.filter(([,pattern])=>pattern.test(evidence));
  const expected=matches.filter(([id])=>id!=='risk_function'||!matches.some(([other])=>other==='coefficient_tracking_scale_reciprocal'))
   .map(([skillId,,ambiguity])=>({skillId,confidence:ambiguity.test(evidence)?'medium':'high'}));
  const f={graded_part_id:'major_calculation',evidence};
  assert.deepEqual(groundedFindingSkills({id:1,graded_findings:[f]},f).map(({skillId,confidence})=>({skillId,confidence})),expected,evidence);
 }
});
test('reload recovers from an obsolete read failure and remains usable after an action failure',async()=>{
 const {createStateReloadCoordinator}=await import('../src/stateReload.ts');const values=[];let rejectOld,reads=0;
 const loader=createStateReloadCoordinator({read:()=>++reads===1?new Promise((_,reject)=>rejectOld=reject):Promise.resolve('latest'),publish:x=>values.push(x)});
 const pending=loader.load();await Promise.resolve();loader.invalidate();rejectOld(new Error('obsolete'));await pending;
 assert.deepEqual(values,['latest']);await assert.rejects(loader.mutate(async()=>{throw new Error('save failure');}));
 await loader.load();assert.deepEqual(values,['latest','latest']);
});
test('skill memo exits on exception and never persists invalidated success/reference edits',async()=>{
 const {withSkillEvidenceMemo,successfulSkillIds}=await import('../src/skillEvidence.ts');
 const f={graded_part_id:'major_calculation',evidence:'逆数の係数2を追跡した',error_type:'none',resolved:true};
 const a={id:1,reference_level:0,grading_confidence:0.99,mode:'full',graded_findings:[f]};
 assert.throws(()=>withSkillEvidenceMemo(()=>{assert.ok(successfulSkillIds(a).length);throw new Error('abort');}));
 a.reference_level=1;withSkillEvidenceMemo(()=>assert.deepEqual(successfulSkillIds(a),[]));
});
test('stable-target union does not scan all history on every merge',async()=>{
 const {buildStableTargetIndex}=await import('../src/stableTargetIdentity.ts');
 const problem_id='PY-2000-Q1';
 const attempts=Array.from({length:1200},(_,i)=>({id:i+1,problem_id,grading_contract:{gradedParts:
  ['answer_conclusion','critical_condition','major_calculation'].map(id=>({id,stableTargetKey:`target:${problem_id}:slot:${id}`}))}}));
 const start=performance.now(),index=buildStableTargetIndex({attempts,reviews:[]});
 assert.equal(index.attemptPart(1,'major_calculation').identityKey,index.attemptPart(1200,'major_calculation').identityKey);
 assert.ok(performance.now()-start<700,'stable identity merging must not repeatedly traverse the full node list');
});
