export type KPolicyValidity="valid"|"invalid_legacy_k"|"needs_review";

export type KPolicySource={
  [key:string]:unknown;
  id?:number;
  k_evidence?:string[];
  rubric_version?:string;
  error_types?:string[];
  primary_error_type?:string;
  error_type?:string;
  error_point?:string;
  result_summary?:string;
  improvement_guidance?:string;
  unresolved_carryover?:string[];
  graded_parts?:string[];
  targeted_parts?:string[];
  required_work_shown?:string[];
  next_action?:string;
  policyValidity?:KPolicyValidity;
  policy_validity?:KPolicyValidity;
};

const structuralFailurePatterns=[
  /問題の型.{0,12}(誤|違|選べな|判別できな)/,
  /方針.{0,12}(誤|違|選べな|立てられな|見当違)/,
  /入口.{0,12}(誤|違|選べな|分からな)/,
  /出発式.{0,12}(誤|違|選べな|書けな)/,
  /主役.{0,12}(誤|違|選べな|決められな)/,
  /(道具|定理).{0,12}(誤|違|選べな|使えな)/,
  /(大きな流れ|解法の流れ).{0,12}(誤|作れな|組めな)/,
];

const localOrFormalPatterns=[
  /記号|添字|転記|符号|係数|次元|転置|行列配置|配置が統一|ベクトル式|成分式/,
  /条件.{0,10}(不足|未記入|明示され|書かれて)/,
  /途中式|理由.{0,8}(不足|明示され|書かれて)|接続.{0,8}(不足|不明瞭|省略)/,
  /シート|欄|見出し|ゴール|今見る量|ここから先は計算|計算開始.{0,8}(境界|不足)/,
  /方針.{0,8}(不足|未記入|明示)|道具.{0,8}(不足|未記入|明示)/,
  /W1|H転置|Hの配置|長さの保存|Qの展開|独立した式/,
];

const textOf=(source:KPolicySource)=>[
  source.error_point,source.result_summary,source.improvement_guidance,
  ...(source.unresolved_carryover||[]),...(source.graded_parts||[]),
  ...(source.targeted_parts||[]),
].map(value=>String(value||"").trim()).filter(Boolean).join("\n");

export function hasConcreteStructuralKEvidence(value:unknown){
  const evidence=(Array.isArray(value)?value:[value]).map(item=>String(item||"").trim()).filter(Boolean);
  return evidence.some(row=>row.length>=6&&structuralFailurePatterns.some(pattern=>pattern.test(row)));
}

function hasConcreteAnswerQuote(value:unknown){
  const evidence=(Array.isArray(value)?value:[value]).map(item=>String(item||"").trim()).filter(Boolean);
  return evidence.some(row=>row.length>=10&&!/^(根拠なし|不明|空欄|K)$/i.test(row));
}

export function classifyKPolicyValidity(source:KPolicySource):KPolicyValidity{
  const stored=source.policyValidity||source.policy_validity;
  if(stored)return stored;
  const errors=[...(source.error_types||[]),source.primary_error_type||"",source.error_type||""];
  if(!errors.includes("K"))return "valid";
  if(hasConcreteStructuralKEvidence(source.k_evidence))return "valid";
  const text=textOf(source);
  if(hasConcreteAnswerQuote(source.k_evidence)&&structuralFailurePatterns.some(pattern=>pattern.test(text)))return "valid";
  const currentRubric=["STAT1-REVIEW-v9","STAT1-GRADE-v5"].includes(String(source.rubric_version||""));
  if(currentRubric)return "invalid_legacy_k";
  if(structuralFailurePatterns.some(pattern=>pattern.test(text)))return "needs_review";
  if(localOrFormalPatterns.some(pattern=>pattern.test(text)))return "invalid_legacy_k";
  return "needs_review";
}

export function excludeLegacyKFromPlanning(source:KPolicySource){
  return classifyKPolicyValidity(source)==="invalid_legacy_k";
}

export function planningErrorsForSource(source:KPolicySource){
  const raw=[...new Set([...(source.error_types||[]),source.primary_error_type||source.error_type||""]
    .filter(error=>["K","W","N","C"].includes(error)))];
  if(!raw.includes("K")||!excludeLegacyKFromPlanning(source))return raw;
  const withoutK=raw.filter(error=>error!=="K");
  const text=textOf(source);
  const mathematicalPatch=localOrFormalPatterns.slice(0,3).some(pattern=>pattern.test(text));
  const formalSkeleton=/シート|欄|見出し|ゴール|今見る量|ここから先は計算|方針.{0,8}(不足|未記入)|道具.{0,8}(不足|未記入)/.test(text);
  // 局所的な数式補修に旧K由来の形式Nが混ざった場合、具体的なW/Cを優先する。
  if(mathematicalPatch&&formalSkeleton&&withoutK.includes("C")&&!withoutK.includes("W"))return ["C"];
  if(mathematicalPatch&&withoutK.includes("W"))return withoutK.filter(error=>error!=="N");
  return withoutK;
}

const skeletonCarryover=/^(方針|方針・入口|今見る量|使う道具|道具|ゴール|最後に示すこと|ここから先は計算|計算開始の境界|条件)$/;
const skeletonSentence=/(方針|今見る量|道具|ゴール|ここから先は計算|計算開始の境界).{0,12}(不足|未記入|明示|追加)/;

export function isSkeletonOnlyCarryover(value:string){
  const normalized=String(value||"").trim();
  return skeletonCarryover.test(normalized)||skeletonSentence.test(normalized);
}

export function mathematicalPatchTargets(source:KPolicySource,explicit:string[]=[]){
  const rows=[...explicit,...(source.targeted_parts||[]),...(source.unresolved_carryover||[]),
    source.error_point||"",source.next_action||""].map(String).filter(value=>value.trim()&&!isSkeletonOnlyCarryover(value));
  const text=rows.join("\n"),targets:string[]=[];
  if(/H|直交行列|行列配置/.test(text))targets.push("Hの配置");
  if(/W1|W_1|WとW1|c転置Z/.test(text))targets.push("WとW1の区別");
  if(/長さの保存|W転置W|Z転置Z/.test(text))targets.push("長さ保存（W転置W=Z転置Z）");
  if(/Q|残差平方和/.test(text))targets.push("Qの展開");
  return [...new Set(targets.length?targets:rows.map(value=>value.trim()))].slice(0,8);
}
