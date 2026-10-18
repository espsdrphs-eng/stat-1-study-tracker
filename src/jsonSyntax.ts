/** Locate strict JSON syntax errors only; never repair or produce data.
 * Browser engines differ in whether JSON.parse reports a numeric position. */
export function jsonSyntaxLocation(source:string){
 let i=0;type Fault={path:string;position:number;expected:string};
 const fail=(path:string,expected:string):never=>{throw {path,position:i,expected} satisfies Fault};
 const space=()=>{while(/[\t\r\n ]/.test(source[i]||'x'))i++};
 const string=(path:string)=>{
  const start=i++;while(i<source.length){const c=source[i++];if(c==='"'){try{return JSON.parse(source.slice(start,i)) as string}catch{fail(path,'有効なJSON文字列')}}
   if(c.charCodeAt(0)<32)fail(path,'改行は文字列内で\\nにする');
   if(c==='\\'){const e=source[i++];if(e==='u'){if(!/^[a-fA-F0-9]{4}$/.test(source.slice(i,i+4)))fail(path,'Unicode escapeは16進4桁');i+=4;}else if(!e||!'"\\/bfnrt'.includes(e))fail(path,'有効な文字列escape');}
  }return fail(path,'文字列を閉じる半角引用符');
 };
 const value=(path:string,depth:number):void=>{
  if(depth>200)fail(path,'ネストを200段以下にする');space();const c=source[i];
  if(c==='"'){string(path);return;}
  if(c==='{'){
   i++;space();if(source[i]==='}'){i++;return;}
   while(i<source.length){if(source[i]!=='"')fail(path,'objectのキーは半角引用符で囲む');const key=string(path),child=`${path}.${key}`;space();if(source[i++]!==':'){i--;fail(child,'キーの後に :');}value(child,depth+1);space();if(source[i]==='}'){i++;return;}if(source[i++]!==','){i--;fail(child,'値の後に , または }');}space();}
   fail(path,'objectを閉じる }');
  }
  if(c==='['){i++;space();if(source[i]===']'){i++;return;}let n=0;while(i<source.length){value(`${path}.${n++}`,depth+1);space();if(source[i]===']'){i++;return;}if(source[i++]!==','){i--;fail(path,'配列要素の後に , または ]');}space();}fail(path,'配列を閉じる ]');}
  const token=source.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
  if(!token)fail(path,'値（文字列・object・配列・数値・true・false・null）。空欄は不可');i+=token!.length;
 };
 try{value('$',0);space();if(i!==source.length)fail('$','JSON objectの後に別の値を置かない');return {path:'$',position:i,expected:'標準JSON'};}
 catch(e){return e as Fault;}
}
