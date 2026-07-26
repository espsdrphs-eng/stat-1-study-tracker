export const STUDY_DATA_CHANNEL="stat1-study-data-v1";

export type StudyDataChanged={
  type:"study-data-changed";
  operation:string;
  attemptId?:number;
  reviewId?:number;
  occurredAt:string;
};

export function notifyStudyDataChanged(event:Omit<StudyDataChanged,"type"|"occurredAt">){
  const payload:StudyDataChanged={type:"study-data-changed",occurredAt:new Date().toISOString(),...event};
  if(typeof BroadcastChannel!=="undefined"){
    const channel=new BroadcastChannel(STUDY_DATA_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(STUDY_DATA_CHANNEL,{detail:payload}));
}

export function subscribeStudyDataChanged(listener:(event:StudyDataChanged)=>void){
  const channel=typeof BroadcastChannel!=="undefined"?new BroadcastChannel(STUDY_DATA_CHANNEL):null;
  if(channel)channel.onmessage=event=>listener(event.data as StudyDataChanged);
  const local=(event:Event)=>listener((event as CustomEvent<StudyDataChanged>).detail);
  if(typeof window!=="undefined")window.addEventListener(STUDY_DATA_CHANNEL,local);
  return ()=>{
    channel?.close();
    if(typeof window!=="undefined")window.removeEventListener(STUDY_DATA_CHANNEL,local);
  };
}
