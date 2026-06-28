const boundText=(value:string)=>value
  .replace(/\\infty|infinity|∞/gi,"無限大")
  .replace(/\\,/g,"").replace(/[{}]/g,"").trim();

const expressionText=(value:string)=>value
  .replace(/\\cdot|\\times|\*/g,"×")
  .replace(/\\,/g," ")
  .replace(/\s+/g," ")
  .replace(/[{}]/g,"")
  .trim();

/**
 * GPTが返すLaTeXまたは英語風の数式読み上げを、学習記録向けの日本語へ変換する。
 * 原文保存には使わず、error_point / next_action / weak_notes など表示・登録項目だけに適用する。
 */
export function japaneseizeMathText(input:string){
  if(!input) return "";
  let text=String(input).replace(/\r\n/g,"\n")
    .replace(/\\\(|\\\)|\\\[|\\\]|\$/g,"")
    .replace(/\\displaystyle|\\left|\\right/g,"")
    .replace(/\\[!,;:]\s*/g,"")
    .replace(/\\operatorname\{Var\}\s*\(([^)]+)\)/g,"$1の分散")
    .replace(/\\operatorname\{Cov\}\s*\(([^,]+),\s*([^)]+)\)/g,"$1と$2の共分散")
    .replace(/\\mathbb\{E\}\s*\[([^\]]+)\]/g,"$1の期待値")
    .replace(/E\s*\[\s*\|([^|]+)\|\s*\]/g,"|$1|の期待値")
    .replace(/E\s*\[\s*([^\]]+)\s*\]/g,"$1の期待値");

  // LaTeXの総和。例: \sum_{k=1}^{\infty} kf(k)
  text=text.replace(/\\sum_\{([^{}]+)\}\^\{([^{}]+)\}\s*([^=、。\n]+)/g,
    (_,lower,upper,expression)=>`${boundText(lower)}から${boundText(upper)}までの${expressionText(expression)}の和`);
  text=text.replace(/\\sum_\{([^{}]+)\}\^\s*([^\s{}]+)\s*([^=、。\n]+)/g,
    (_,lower,upper,expression)=>`${boundText(lower)}から${boundText(upper)}までの${expressionText(expression)}の和`);

  // GPTがLaTeXを英語風に展開した形式。例: sum f from k=n+1 to infinity
  text=text.replace(/\bsum\s+(.+?)\s+from\s+(.+?)\s+to\s+(?:infinity|∞)\b/gi,
    (_,expression,lower)=>{
      const expr=expressionText(expression);
      return `${boundText(lower)}から無限大までの${expr==="f"?"f(k)":expr}の和`;
    });

  text=text
    .replace(/f\s*\(\s*k\s*\)\s*=\s*P\s*\(\s*X\s*=\s*k\s*\)/g,"f(k)は、Xがkとなる確率")
    .replace(/P\s*\(\s*X\s*>\s*([^)\s]+)\s*\)/g,"Xが$1より大きい確率")
    .replace(/P\s*\(\s*X\s*\\geq?\s*([^)\s]+)\s*\)/g,"Xが$1以上となる確率")
    .replace(/P\s*\(\s*X\s*=\s*([^)\s]+)\s*\)/g,"Xが$1となる確率")
    .replace(/([^\s,、。]+)\s*(?:\\leq?|<=)\s*([A-Za-z]\w*)\s*(?:\\leq?|<=)\s*([^\s,、。]+)/g,
      "$2は$1以上$3以下")
    .replace(/([A-Za-z]\w*)\s*(?:\\geq?|>=)\s*([^\s,、。]+)/g,"$1は$2以上")
    .replace(/([A-Za-z]\w*)\s*(?:\\leq?|<=)\s*([^\s,、。]+)/g,"$1は$2以下")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,"$1を$2で割った値")
    .replace(/\\sqrt\{([^{}]+)\}/g,"$1の平方根")
    .replace(/\\infty|infinity/gi,"無限大")
    .replace(/\\cdot|\\times|\*/g,"×")
    .replace(/\\neq/g,"≠").replace(/\\geq?/g,"以上").replace(/\\leq?/g,"以下")
    .replace(/\\mu/g,"μ").replace(/\\sigma/g,"σ").replace(/\\lambda/g,"λ")
    .replace(/\\text\{([^{}]+)\}/g,"$1")
    .replace(/\s*=\s*/g,"は")
    .replace(/Xの期待値は(?=[^、。\n])/g,"Xの期待値は、")
    .replace(/\s+/g," ")
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+([をにがはへでとの])/gu,"$1$2")
    .replace(/\s+([、。])/g,"$1")
    .trim();
  return text;
}
