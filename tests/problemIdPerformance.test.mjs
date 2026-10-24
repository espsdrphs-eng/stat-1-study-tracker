import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProblemId,resolveCanonicalProblemId} from '../src/examReadiness.ts';

function legacyNormalize(value){
 const raw=String(value||'').toUpperCase().replace(/[‐‑‒–—―ー－]/g,'-').trim();
 const white=raw.match(/^WB-(\d+)-([AS])-(\d+)$/);
 if(white)return `WB-${Number(white[1])}-${white[2]}-${String(Number(white[3])).padStart(2,'0')}`;
 const past=raw.match(/^PY-(\d{4})-Q(\d+)$/);
 return past?`PY-${past[1]}-Q${Number(past[2])}`:raw;
}

test('repeated pure ID normalization does not repeat string transforms on every comparison',()=>{
 const original=String.prototype.toUpperCase;let transforms=0;
 const input='  py—2097—q0007  ';
 String.prototype.toUpperCase=function(){transforms++;return original.call(this)};
 try{
  for(let i=0;i<5000;i++)assert.equal(resolveCanonicalProblemId(input,[]),'PY-2097-Q7');
 }finally{String.prototype.toUpperCase=original}
 // Count work, not wall time: this remains deterministic on slow CI/iPads.
 assert.ok(transforms<=2,`identical IDs were transformed ${transforms} times`);
});

test('normalization remains byte-for-byte compatible for Unicode, padding and unknown IDs',()=>{
 const inputs=['',undefined,null,0,'  custom-id  ','GEN-AbC','WB-0002-s-000','PY-2024-Q0001',
  ...['‐','‑','‒','–','—','―','ー','－','-'].flatMap(d=>[` wb${d}02${d}a${d}1 `,`py${d}2025${d}q03`]),
  ...Array.from({length:1300},(_,i)=>`wb-${i%32}-a-${i}`)];
 for(const input of inputs)assert.equal(normalizeProblemId(input),legacyNormalize(input));
});

test('only pure strings are reused; alias edits, chains and cycles remain live',()=>{
 const aliases=[{alias:'old',problem_id:'PY-2024-Q1'}];
 assert.equal(resolveCanonicalProblemId('old',aliases),'PY-2024-Q1');
 aliases[0].problem_id='PY-2025-Q2';
 assert.equal(resolveCanonicalProblemId('old',aliases),'PY-2025-Q2');
 aliases.push({raw_problem_id:'PY-2025-Q2',corrected_problem_id:'WB-02-A-1'});
 assert.equal(resolveCanonicalProblemId('old',aliases),'WB-2-A-01');
 aliases[1].corrected_problem_id='old';
 assert.equal(resolveCanonicalProblemId('old',aliases),'OLD');
 aliases.splice(0,aliases.length);
 assert.equal(resolveCanonicalProblemId('old',aliases),'OLD');
});

test('normalization reuse is bounded and evicted IDs still normalize correctly',()=>{
 const original=String.prototype.toUpperCase;let transforms=0;
 const input='eviction-proof-id';
 normalizeProblemId(input);
 for(let i=0;i<4096;i++)normalizeProblemId(`pressure-${i}`);
 String.prototype.toUpperCase=function(){transforms++;return original.call(this)};
 try{assert.equal(normalizeProblemId(input),'EVICTION-PROOF-ID')}
 finally{String.prototype.toUpperCase=original}
 assert.equal(transforms,1,'old keys must not remain in an unbounded cache');
});
