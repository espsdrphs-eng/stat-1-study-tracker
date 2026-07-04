export function postponedDueDate(today:string,input:{due_date?:unknown;days?:unknown}){
  const requested=String(input.due_date||"");
  if(/^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested<today?today:requested;
  const days=Math.min(30,Math.max(0,Number(input.days||0)));
  const date=new Date(`${today}T12:00:00`);
  date.setDate(date.getDate()+days);
  return new Intl.DateTimeFormat("sv-SE").format(date);
}
