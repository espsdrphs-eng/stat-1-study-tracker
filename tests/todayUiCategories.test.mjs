import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Today通常表示は本番演習と補修の2カテゴリを正面に出す",()=>{
  const source=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.match(source,/今日の本番演習/);
  assert.match(source,/今日の補修/);
  assert.match(source,/なぜ今日/);
  assert.match(source,/canonicalStudyPlan\.requiredRepairs/);
  assert.match(source,/今日の必須ではない・任意／今後/);
  assert.match(source,/今日の最優先課題/);
  assert.match(source,/本番答案として解いた/);
  assert.match(source,/較正用の採点あり。本番3答案の得点・時間には含めません。/);
  assert.doesNotMatch(source,/見るべき主指標：期限超過/);
  assert.doesNotMatch(source,/label:"今日必ずやる"/);
  assert.doesNotMatch(source,/label:"余裕があればやる"/);
});
