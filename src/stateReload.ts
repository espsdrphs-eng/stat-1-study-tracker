/** Coalesce UI reloads, but never publish a read invalidated by a later save. */
export function createStateReloadCoordinator<T>(args:{read:()=>Promise<T>;publish:(state:T)=>void}){
  let revision=0,mutations=0,inFlight:Promise<void>|undefined;
  let mutationWaiters:Array<()=>void>=[];
  const invalidate=()=>{revision++;};
  const load=():Promise<void>=>{
    if(inFlight)return inFlight;
    inFlight=Promise.resolve().then(async()=>{
      for(;;){
        if(mutations){await new Promise<void>(resolve=>mutationWaiters.push(resolve));continue;}
        const readingRevision=revision;
        let state:T;
        try{state=await args.read();}
        catch(error){if(readingRevision!==revision||mutations)continue;throw error;}
        if(readingRevision!==revision||mutations)continue;
        args.publish(state);return;
      }
    }).finally(()=>{inFlight=undefined;});
    return inFlight;
  };
  const mutate=async<R>(action:()=>Promise<R>):Promise<R>=>{
    mutations++;invalidate();
    try{return await action();}
    finally{invalidate();mutations--;if(!mutations){const waiters=mutationWaiters;mutationWaiters=[];waiters.forEach(resolve=>resolve());}}
  };
  return {load,invalidate,mutate};
}
