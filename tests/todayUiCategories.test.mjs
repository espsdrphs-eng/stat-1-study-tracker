import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Today通常表示は本番演習と補修の2カテゴリを正面に出す",()=>{
  const source=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.match(source,/今日の本番演習/);
  assert.match(source,/今日の補修/);
  assert.match(source,/なぜ今日/);
  assert.doesNotMatch(source,/label:"今日必ずやる"/);
  assert.doesNotMatch(source,/label:"余裕があればやる"/);
});
