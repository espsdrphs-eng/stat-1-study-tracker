/** Normalize string-token delimiters only, never quotes inside an ASCII string.
 * Preserve content and require a full strict JSON parse afterwards. */
export function normalizeCompatibleJsonQuotes(source:string){
 let output='',inAsciiString=false,inCompatibleString=false,escaped=false,nestedCurlyQuotes=0,compatibleOpener='',changed=false;
 const previous=(i:number)=>{for(let j=i-1;j>=0;j--)if(!/\s/.test(source[j]))return source[j];return ''};
 const next=(i:number)=>{for(let j=i+1;j<source.length;j++)if(!/\s/.test(source[j]))return source[j]==='\\'&&['[',']'].includes(source[j+1])?source[j+1]:source[j];return ''};
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(inAsciiString){output+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inAsciiString=false;continue;}
  if(inCompatibleString){
   if(escaped){output+=c;escaped=false;continue;}if(c==='\\'){output+=c;escaped=true;continue;}
   if(c==='\u201c'){nestedCurlyQuotes++;output+=c;continue;}
   if(c==='\u201d'&&nestedCurlyQuotes>0){nestedCurlyQuotes--;output+=c;continue;}
   if((c===compatibleOpener||compatibleOpener==='\u201c'&&c==='\u201d')&&nestedCurlyQuotes===0&&[':',',','}',']'].includes(next(i))){output+='"';inCompatibleString=false;compatibleOpener='';changed=true;continue;}
   output+=c;continue;
  }
  if(c==='"'){output+=c;inAsciiString=true;continue;}
  if(['\u201c','\u201d','\uff02'].includes(c)&&['{','[',',',':'].includes(previous(i))){output+='"';inCompatibleString=true;compatibleOpener=c;nestedCurlyQuotes=0;changed=true;continue;}
  output+=c;
 }
 return {json:output,normalized:changed};
}

/** Copy/paste typography only. Never invent a value, an array, or a field.
 * Escaped Markdown brackets outside JSON strings have no data semantics;
 * inside strings (including LaTeX) every byte must remain unchanged. A caller
 * must still run strict JSON.parse and the full domain/identity validation. */
export function normalizeCompatibleJson(source:string){
 const quotes=normalizeCompatibleJsonQuotes(source);
 let json='',inString=false,escaped=false,normalized=quotes.normalized;
 for(let i=0;i<quotes.json.length;i++){
  const c=quotes.json[i];
  if(inString){json+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;
  if(c==='\\'&&['[',']'].includes(quotes.json[i+1])){json+=quotes.json[++i];normalized=true;}else json+=c;
 }
 return {json,normalized};
}

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
   let previousChild='';
   while(i<source.length){if(source[i]!=='"')fail(path,'objectのキーは半角引用符で囲む');const key=string(path),child=`${path}.${key}`;space();if(source[i++]!==':'){i--;if(/\.(refs|part_ids)$/.test(previousChild)&&[',','}',']'].includes(source[i]))fail(previousChild,'複数の値は配列 ["値1","値2"] で囲む。1件でも ["値1"]。括弧は推測補完しない');fail(child,'キーの後に :');}value(child,depth+1);previousChild=child;space();if(source[i]==='}'){i++;return;}if(source[i++]!==','){i--;fail(child,'値の後に , または }');}space();}
   fail(path,'objectを閉じる }');
  }
  if(c==='['){i++;space();if(source[i]===']'){i++;return;}let n=0;while(i<source.length){value(`${path}.${n++}`,depth+1);space();if(source[i]===']'){i++;return;}if(source[i++]!==','){i--;fail(path,'配列要素の後に , または ]');}space();}fail(path,'配列を閉じる ]');}
  const token=source.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
  if(!token)fail(path,'値（文字列・object・配列・数値・true・false・null）。空欄は不可');i+=token!.length;
 };
 try{value('$',0);space();if(i!==source.length)fail('$','JSON objectの後に別の値を置かない');return {path:'$',position:i,expected:'標準JSON'};}
 catch(e){return e as Fault;}
}
