import { localGet, localPost } from "./localDb";

export async function api<T>(path:string, init?:RequestInit):Promise<T> {
  if(init?.method==="POST") return localPost<T>(path,init.body?JSON.parse(String(init.body)):undefined);
  return localGet<T>(path);
}

export const post = <T>(path:string, body:unknown) =>
  api<T>(path,{method:"POST",body:JSON.stringify(body)});
