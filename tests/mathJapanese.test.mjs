import test from "node:test";
import assert from "node:assert/strict";
import { japaneseizeMathText } from "../src/mathJapanese.ts";

test("converts GPT English-style summation narration to Japanese", () => {
  const input="E[X] = sum k*f(k) from k=1 to infinity。次に sum f from k=n+1 to infinity = 1-F(n) とする。";
  const output=japaneseizeMathText(input);
  assert.match(output,/Xの期待値/);
  assert.match(output,/無限大までのk×f\(k\)の和/);
  assert.match(output,/無限大までのf\(k\)の和/);
  assert.doesNotMatch(output,/\bsum\b|infinity|E\[X\]/i);
});

test("converts common LaTeX probability notation to Japanese", () => {
  const input=String.raw`\sum_{k=n+1}^{\infty} f(k)=P(X>n)=1-F(n)、0\le n\le k-1、k\ge n+1`;
  const output=japaneseizeMathText(input);
  assert.match(output,/kはn\+1から無限大までのf\(k\)の和/);
  assert.match(output,/Xがnより大きい確率/);
  assert.match(output,/nは0以上k-1以下/);
  assert.match(output,/kはn\+1以上/);
  assert.doesNotMatch(output,/\\sum|\\infty|\\le|\\ge/);
});
