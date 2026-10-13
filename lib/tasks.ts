import { assertGeneratedRecords,summaryStatements } from '@/lib/automation';
export const taskFields=['title','caseId','due','ownerEmail','status','sourceIds','buyerId','description','priority','plannedDay','outcome','completedAt','completedBy','origin','messageId','threadId','receivedAt','mailboxEmail'];
const day=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const iso=(v:any)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
export const taskDay=(stamp:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
export function validateTask(p:any,fail:(code:string)=>never){
 if(typeof p.title!=='string'||p.title.trim().length<3||p.title.length>500)fail('required_title');
 if(!['open','done','blocked'].includes(p.status))fail('invalid_status');
 if(p.priority&&!['normal','high','urgent'].includes(p.priority))fail('invalid_priority');
 for(const key of ['due','plannedDay'])if(p[key]&&!day(p[key]))fail('invalid_date');
 for(const key of ['description','outcome'])if(p[key]&&(typeof p[key]!=='string'||p[key].length>20000))fail('invalid_input');
}
export function taskLifecycle(p:any,old:any,actor:string,stamp:string){
 // Source metadata belongs to the importer. Human edits cannot forge email provenance.
 for(const k of ['origin','messageId','threadId','receivedAt','mailboxEmail'])p[k]=old?.[k]|| (k==='origin'?'manual':'');
 if(old?.origin==='email')p.sourceIds=[...new Set([...(old.sourceIds||[]),...(p.sourceIds||[])])];
 if(p.status==='done'){
  p.completedAt=old?.status==='done'?(old.completedAt||stamp):stamp;
  p.completedBy=old?.status==='done'?(old.completedBy||actor):actor;
 }else{p.completedAt='';p.completedBy=''}
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32)}
const text=(v:any,max=50000)=>typeof v==='string'?v.slice(0,max):'';
export async function prepareDailyTasks(db:any,owner:string,mailbox:string,data:any,stamp:string){
 if(!data.taskRun){if(data.tasks!==undefined)throw Error('task_window_required');return null;}
 const run=data.taskRun,items=data.tasks;
 if(!Array.isArray(items)||items.length>25||!iso(run.from)||!iso(run.to)||Date.parse(run.to)-Date.parse(run.from)!==86400000||Date.parse(run.to)>Date.parse(stamp)+300000||taskDay(run.to)!==data.day||typeof run.complete!=='boolean'||!Number.isInteger(run.scanned)||run.scanned<0||run.scanned>100000||!Array.isArray(run.queries)||run.queries.length>30||run.queries.some((q:any)=>typeof q!=='string'||q.length>1000))throw Error('invalid_task_window');
 const statements:any[]=[],inserted:string[]=[],skipped:string[]=[],seen=new Set<string>(),generated:Array<{id:string,kind:string}>=[];
 const put=(id:string,kind:string,p:any)=>{generated.push({id,kind});const json=JSON.stringify(p);statements.push(db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(id,owner,kind,json,stamp,stamp));statements.push(db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),owner,id,'create','Daily email review','{}',json,stamp));};
 for(const item of items){
  if(!item||typeof item!=='object'||typeof item.messageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(item.messageId)||!iso(item.receivedAt)||Date.parse(item.receivedAt)<Date.parse(run.from)||Date.parse(item.receivedAt)>=Date.parse(run.to)||typeof item.title!=='string'||typeof item.description!=='string'||!item.description.trim()||['body','subject','from'].some(k=>typeof item.source?.[k]!=='string'||!item.source[k].trim()))throw Error('invalid_task_evidence');
  if(item.threadId&&(typeof item.threadId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(item.threadId)))throw Error('invalid_task_evidence');
  const id='task_mail_'+await hash(owner+':'+mailbox+':'+item.messageId);
  if(seen.has(id)){skipped.push(id);continue}seen.add(id);
  await assertGeneratedRecords(db,owner,[{id,kind:'task'}]);const old=await db.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='task'").bind(id,owner).first();
  if(old){skipped.push(id);continue}
  const p:any={title:item.title,description:item.description,status:'open',priority:item.priority||'normal',due:item.due||'',plannedDay:data.day,ownerEmail:mailbox,buyerId:item.buyerId||'',caseId:item.caseId||'',outcome:'',completedAt:'',completedBy:'',mailboxEmail:mailbox,origin:'email',messageId:item.messageId,threadId:item.threadId||'',receivedAt:item.receivedAt};
  validateTask(p,code=>{throw Error(code)});
  for(const key of ['buyerId','caseId'])if(p[key]){if(typeof p[key]!=='string'||!await db.prepare('SELECT id FROM records WHERE id=? AND owner=? AND kind=?').bind(p[key],owner,key.replace('Id','')).first())throw Error('parent_missing');}
  const match=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='mail' AND json_extract(payload,'$.messageId')=? AND json_extract(payload,'$.mailboxEmail')=?").bind(owner,item.messageId,mailbox).first();
  const mailId=match?.id||'mail_'+await hash(owner+':'+mailbox+':'+item.messageId);
  if(!match&&!data.items.some((request:any)=>request.messageId===item.messageId))put(mailId,'mail',{subject:text(item.source.subject,300),from:text(item.source.from,500),to:text(item.source.to,2000),date:item.receivedAt.slice(0,10),body:text(item.source.body),messageId:item.messageId,threadId:item.threadId||'',caseId:p.caseId,source:'gmail',sourceIds:[],mailboxEmail:mailbox});
  p.sourceIds=[mailId];put(id,'task',p);inserted.push(id);
 }
 const id='taskrun_'+await hash(owner+':'+mailbox+':'+data.day),old=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='taskRun'").bind(id,owner).first(),previous=old?JSON.parse(old.payload):{};
 const p={mailboxEmail:mailbox,day:data.day,from:run.from,to:run.to,complete:run.complete,scanned:run.scanned,queries:run.queries,notes:text(run.notes,10000),taskIds:[...new Set([...(previous.taskIds||[]),...inserted,...skipped])],completedAt:stamp};
 generated.push({id,kind:'taskRun'});const mutationIndex=statements.length+1;statements.push(...summaryStatements(db,owner,id,'taskRun',p,'Daily email review',stamp));
 await assertGeneratedRecords(db,owner,generated);return {statements,inserted,skipped,runId:id,mutationIndex};
}
