import {useEffect,useState} from 'react';
import type {RepairCheck,Task} from './types';
import {repairStages,repairTaskKey} from './repairCheck';
type Input=Pick<RepairCheck,'clue'|'knowledge'|'approach'|'reason'|'stage'>;
const empty:Input={clue:'',knowledge:'',approach:'',reason:'',stage:'unknown'};
export function RepairCheckPanel({task,check,busy,onSave}:{task:Partial<Task>;check?:RepairCheck;busy:boolean;onSave:(input:Input)=>Promise<boolean>}){
 const [form,setForm]=useState<Input>(check||empty),[saved,setSaved]=useState(false);
 useEffect(()=>{setForm(check||empty);setSaved(!!check)},[repairTaskKey(task),check?.recordedAt]);
 const labels={clue:'問題文の着眼点',knowledge:'想起した知識・定義・定理',approach:'選択した解法と最初の一手',reason:'その解法を選ぶ理由'};
 return <section className="repair-check" aria-label="30秒骨格チェック"><h3>解説を見る前に：30秒骨格チェック</h3><p>短いメモだけで構いません。答案は紙・Goodnotesに書きます。自己申告は習得・転移成功の判定ではありません。</p>
 <div className="repair-check-fields">{(Object.keys(labels) as Array<keyof typeof labels>).map(key=><label key={key}>{labels[key]}<textarea rows={2} maxLength={2000} value={form[key]} onChange={e=>{setSaved(false);setForm({...form,[key]:e.target.value})}}/></label>)}</div>
 <label>詰まった段階（自己申告）<select value={form.stage} onChange={e=>{setSaved(false);setForm({...form,stage:e.target.value as Input['stage']})}}>{Object.entries(repairStages).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <button className="primary" disabled={busy} onClick={async()=>{if(await onSave(form))setSaved(true)}}>骨格チェックを保存</button>{saved&&<p role="status">骨格チェックを保存しました。紙・Goodnotesで対象を解答し、答案完成後に採点へ進んでください。</p>}{check&&!check.beforeAssistance&&<small>具体的な支援を参照した後の記録です。自力の骨格成功には加算しません。</small>}
 </section>;
}
