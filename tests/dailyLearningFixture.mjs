// A–D scores and distinctions reproduce the reported 11/16 workflow.
// All prompts, quotes and grading are synthetic, never personal answer records.
export const dailyFixture=(snapshot,day=snapshot.study_date)=>{
 const problem=(ref,title,statement,labels,ids)=>({ref,title,statement,parts:labels.map((label,i)=>({id:`q${i+1}`,label})),purpose:'diagnostic',familiarity:'unseen',shown:['statement'],quality:null,target_ability_ids:ids,selection_reason:'検証用の異なる題材'});
 const grade=(part_id,status,quote,error_type='none',concept_focus)=>({part_id,status,quote,error_type,finding:status==='unattempted'?'未着手。':'合成フィクスチャの記録。',...(concept_focus?{concept_focus}:{})});
 const answer=(ref,problem_ref,kind,points,parts,options={})=>({ref,problem_ref,kind,baseline:null,answered_at:null,source:'chat_text',reference:{level:0,hint_used:false,method_cued:false,closed_reproduction:false},score:{points,max:100},grading_confidence:95,parts,first_error_part_id:null,affected_part_ids:[],independent_error_part_ids:[],...options});
 const evidence=(answer_ref,part_ids,outcome,aspect='derivation',more={})=>({answer_ref,part_ids,outcome,aspect,observation:'合成フィクスチャの所見。',...more});
 const evaluation=(ability_id,state,evidence,next_check=null)=>({ability_id,state,certainty:'confirmed',judgement:'合成フィクスチャの判断。',cause_hypothesis:null,evidence,next_check});
 return {schema_version:'stat1-daily-learning-v1',session_id:`test-A-D-${day}`,learning_date:day,morning_context_version:snapshot.context_version,catalog_version:snapshot.catalog_version,created_at:`${day}T00:00:00+09:00`,learning_goal:'long_term_theory',source_status:'observed',departure_reason:'今日は対象候補と異なる複数分野も診断した（模擬）。',
  coaching_without_answer:[{baseline:'aA',ability_id:'estimation.bias-risk',target:'最大リスクの意味を局所補修',guidance:'母数の範囲内で最大になる点を確認した。',unconfirmed:'独立した補修後答案はない。'}],
  problems:[problem('pA','A 模擬・最大MSE','模擬 A：母数が [-1,1] にある場合の二乗損失を最適化せよ。',['MSEの分解','最大値の意味'],['estimation.bias-risk']),
   problem('pB','B 模擬・条件付き確率','模擬 B：装置を共有する試行で成功確率と独立性を判定せよ。',['条件付き確率','独立性の判定','数値の引き継ぎ'],['probability.conditional-probability','probability.independence','cross.indices-coefficients']),
   problem('pC','C 模擬・棄却域','模擬 C：二つの棄却域についてサイズと検出力を比較せよ。',['サイズの計算','検出力の定義','比較の結論'],['testing.errors-power']),
   problem('pD','D 模擬・変換と極限','模擬 D：標本平均の対数変換の極限と極限分布を求めよ。',['対数の操作','収束先','中心極限定理','デルタ法'],['cross.quantity-identity','asymptotics.lln','asymptotics.clt','asymptotics.delta'])],
  answers:[answer('aA','pA','diagnostic',18,[grade('q1','incorrect','MSE = Var(T)（模擬）','N'),grade('q2','unattempted',null)],{first_error_part_id:'q1'}),
   answer('aB','pB','diagnostic',91,[grade('q1','correct','P(Y=1|X=1)=P(X=1,Y=1)/P(X=1)'),grade('q2','correct','P(X=1,Y=1) = 11/48 ≠ (5/12)^2 ⇒ 非独立'),grade('q3','incorrect','分子に 13/48 と転記した（模擬）','C')],{first_error_part_id:'q3'}),
   answer('aC','pC','diagnostic',55,[grade('q1','correct','P₀(X∈R) を積分した（模擬）'),grade('q2','incorrect','検出力 = P₁(X∉R)（模擬）','N','distinction'),grade('q3','incorrect','この値を使って比較した（模擬）','N')],{first_error_part_id:'q2',affected_part_ids:['q3']}),
   answer('rC','pC','local_repair',100,[grade('q2','correct','検出力 = P₁(X∈R), β=P₁(X∉R)（模擬）','none','distinction')],{baseline:'aC',reference:{level:null,hint_used:null,method_cued:null,closed_reproduction:null},repair:{ability_id:'testing.errors-power',target:'検出力の定義',guidance:'棄却する事象を分けて確認。',unconfirmed:'解説を閉じたか不明。'}}),
   answer('aD','pD','diagnostic',5,[grade('q1','incorrect','log( X̄ ) = (Σ log Xᵢ)/n','N'),grade('q2','unattempted',null),grade('q3','unattempted',null),grade('q4','unattempted',null)],{first_error_part_id:'q1'}),
   answer('rD','pD','local_repair',80,[grade('q1','correct','log( X̄ ) ≠ (Σ log Xᵢ)/n'),grade('q2','correct','X̄ → 1/λ, log X̄ → −log λ')],{baseline:'aD',reference:{level:3,hint_used:true,method_cued:true,closed_reproduction:false},repair:{ability_id:'cross.quantity-identity',target:'対数と標本平均の扱い',guidance:'平均してから関数を適用する。',unconfirmed:'定理の仮定と他設定への転移。'}})],
  evaluations:[evaluation('estimation.bias-risk','unrepaired',[evidence('aA',['q1'],'failure')]),
   evaluation('probability.independence','unconfirmed',[evidence('aB',['q2'],'success')]),
   evaluation('probability.conditional-probability','unconfirmed',[evidence('aB',['q1'],'success')]),
   evaluation('cross.indices-coefficients','unrepaired',[evidence('aB',['q3'],'failure')]),
   evaluation('testing.errors-power','immediate_confirmed',[evidence('aC',['q2'],'failure','concept',{concept_focus:'distinction'}),evidence('rC',['q2'],'success','concept',{concept_focus:'distinction'})],{kind:'immediate_reproduction',due_date:null,task:'検出力とβを解説なしで区別する。',success_condition:'別条件で事象を書き分ける。',basis:'aC'}),
   evaluation('cross.quantity-identity','unrepaired',[evidence('aD',['q1'],'failure'),evidence('rD',['q1'],'success')]),
   evaluation('asymptotics.lln','unconfirmed',[evidence('rD',['q2'],'success')])]
 };
};
