import { dailyAccessAllowed } from '@/lib/daily-access';
import { automationSaveId,reservedRecordId } from '@/lib/automation';
import { dailyGmail } from '@/lib/google-daily';
import { googleStart,googleCallback,googleDisconnect,googleConfigured } from '@/lib/google-mail';
import { mailboxFields,validateMailbox,mailboxEndpoint,checkGmailMailbox,gmailConnector } from '@/lib/mailboxes';
import { env } from 'cloudflare:workers';
import corpusJson from '@/lib/corpus.json';
import { connectorsForRequest } from '@/lib/connectors';
import { connectorResponse } from '@/lib/connector-errors.mjs';
import { operationFields, structuredFields, validateOperation, operationEndpoint, dailyWorker } from '@/lib/operations';
import { departmentFields, validateDepartment, validateDepartmentLinks } from '@/lib/departments';
import { quotationFields, quoteStructured, validateQuotation, validateQuotationLinks } from '@/lib/quotations';
import { taskFields, validateTask, taskLifecycle } from '@/lib/tasks';
import { readTaskTimeline } from '@/lib/task-timeline';
import {readTaskReminders} from '@/lib/task-reminders';
export const dynamic='force-dynamic';
const docs=corpusJson as any[];
const kinds=new Set(['case','update','task','article','mail','draft','docreview','training','profile','mailbox',...Object.keys(operationFields),...Object.keys(departmentFields),...Object.keys(quotationFields)]);
const stages=['inquiry','quotation','sample','materials','preproduction','bulk','quality','shipping','closed'];
const fields:Record<string,string[]>={mailbox:mailboxFields,case:['title','customer','style','po','qty','unit','currency','stage','ownerEmail','baseline','forecast','sourceIds','notes','buyerEmail'],update:['title','caseId','workstream','problem','action','reason','outcome','nextAction','due','sourceIds','status'],task:taskFields,article:['title','titleEn','body','bodyEn','scope','scopeEn','sourceIds','status','reviewer','reason','type','supersedes'],mail:['subject','from','to','date','body','messageId','threadId','caseId','source','sourceIds','mailboxId','mailboxEmail'],draft:['mailId','subject','body','caseId'],docreview:['docId','status','note'],training:['articleId','answer','score'],profile:['email','name','team'],...operationFields,...departmentFields,...quotationFields};
const reply=(x:any,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
class Fault extends Error{constructor(public code:string,public status=400){super(code)}}
function norm(s:string){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d')}
const summary=(d:any)=>({id:d.id,name:d.name,customer:d.customer,quote:d.quote,date:d.date,category:d.category,phase:d.phase,pageCount:d.page_count,bytes:d.bytes,emails:d.emails,flags:d.flags||[]});
function clean(body:any){if(!body||typeof body!=='object'||Array.isArray(body))throw new Fault('invalid_input');return body}
function validate(kind:string,p:any){
 for(const [key,value] of Object.entries(p)){if(key==='sourceIds'||structuredFields.has(key)||quoteStructured.has(key))continue;if(key==='qty'){if(!['string','number'].includes(typeof value))throw new Fault('invalid_input');continue}if(typeof value!=='string'||value.length>50000)throw new Fault('invalid_input')}
 if(kind==='mailbox')validateMailbox(p,(code:string)=>{throw new Fault(code)});
 validateQuotation(kind,p,(code:string)=>{throw new Fault(code)});
 validateDepartment(kind,p,(code:string)=>{throw new Fault(code)});
 if(operationFields[kind])validateOperation(kind,p,(code:string)=>{throw new Fault(code)});
 const text=(key:string,min=1)=>{if(typeof p[key]!=='string'||p[key].trim().length<min)throw new Fault('required_'+key);};
 if(kind==='case'){text('title',3);text('customer');if(!stages.includes(p.stage))throw new Fault('invalid_stage');if(p.qty!==''&&p.qty!=null&&(!Number.isFinite(Number(p.qty))||Number(p.qty)<0))throw new Fault('invalid_qty');}
 if(kind==='update'){text('caseId');text('problem');text('action');}
 if(kind==='task')validateTask(p,(code:string)=>{throw new Fault(code)});
 if(kind==='article'){text('title',3);text('body',8);if(!['draft','approved','retired'].includes(p.status))throw new Fault('invalid_status');if(p.status==='approved'){text('reviewer');text('reason');if(!p.sourceIds?.length)throw new Fault('evidence_required');}}
 if(kind==='mail'){text('subject');text('body');}if(kind==='draft'){text('mailId');text('body');}
 if(kind==='docreview'){if(!docs.some(d=>d.id===p.docId))throw new Fault('source_missing');if(!['verified','needs_review'].includes(p.status))throw new Fault('invalid_status');}
 if(kind==='profile'){text('email');text('name');}
 if(kind==='training'){text('articleId');text('answer',3);p.score='unreviewed';}
 for(const k of ['ownerEmail','buyerEmail','email'])if(p[k]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p[k]))throw new Fault('invalid_email');
 for(const k of ['baseline','forecast','due','date'])if(p[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(p[k])||Number.isNaN(Date.parse(p[k]))||new Date(p[k]).toISOString().slice(0,10)!==p[k]))throw new Fault('invalid_date');
 if(p.sourceIds&&(!Array.isArray(p.sourceIds)||p.sourceIds.length>30||p.sourceIds.some((v:any)=>typeof v!=='string')))throw new Fault('invalid_source');
}
async function handler(req:Request){try{
 const uid=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email')||'';
 const db=(env as any).DB;if(!db)throw new Fault('database_unavailable',503);const path=new URL(req.url).pathname.replace(/^\/api\//,'');
 if(['daily-worker','daily-gmail'].includes(path)&&!await dailyAccessAllowed(req))return reply({error:'service_auth_required'},401);
 if(path==='daily-worker')return dailyWorker(req,db);
 if(path==='daily-gmail')return dailyGmail(req,db);
 if(path==='google/callback'&&req.method==='GET')return googleCallback(req,db,uid||'');
 if(!uid)return reply({error:'sign_in_required',signIn:'/signin-with-chatgpt?return_to=%2F'},401);
 if(req.method==='GET'){
  if(path==='google/status')return reply({configured:googleConfigured()});
  if(path==='task-reminders')return await readTaskReminders(db,uid);
  if(path==='task-timeline')return await readTaskTimeline(req,db,uid);
  const extra=await operationEndpoint(req,db,(env as any).BUCKET,uid,email,path);if(extra)return extra;
  if(path.startsWith('department-history/')){const id=path.split('/')[1];if(!await db.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='departmentItem'").bind(id,uid).first())throw new Fault('not_found',404);const rows=await db.prepare('SELECT * FROM audit WHERE owner=? AND record_id=? ORDER BY at DESC LIMIT 100').bind(uid,id).all();return reply({events:rows.results});}
  if(path.startsWith('quotation/')){const id=path.split('/')[1],q=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='quotation'").bind(id,uid).first();if(!q)throw new Fault('not_found',404);const payload=JSON.parse(q.payload);delete payload.internalNotes;delete payload.sourceIds;return reply({id:q.id,version:q.version,payload});}
  if(path==='state'){const [r,a]=await Promise.all([db.prepare('SELECT * FROM records WHERE owner=? ORDER BY updated_at DESC').bind(uid).all(),db.prepare('SELECT * FROM audit WHERE owner=? ORDER BY at DESC LIMIT 150').bind(uid).all()]);return reply({user:{id:uid,email},documents:docs.map(summary),records:r.results.map((x:any)=>({...x,payload:JSON.parse(x.payload)})),audit:a.results,stats:{documents:docs.length,pages:docs.reduce((n,d)=>n+d.page_count,0),customerLabels:new Set(docs.map(d=>d.customer.toLowerCase())).size},mailCapabilities:{gmail:true,outlook:false,other:false,googleDirectConfigured:googleConfigured()}});}
  if(path.startsWith('documents/')){const d=docs.find(d=>d.id===path.split('/')[1]);if(!d)throw new Fault('not_found',404);return reply(d)}
  if(path==='export'){const r=await db.prepare('SELECT * FROM records WHERE owner=?').bind(uid).all(),a=await db.prepare('SELECT * FROM audit WHERE owner=?').bind(uid).all();return new Response(JSON.stringify({schema:'merchflow.v2',exportedAt:new Date().toISOString(),documents:docs.map(summary),records:r.results.map((x:any)=>({...x,payload:JSON.parse(x.payload)})),audit:a.results},null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="merchflow-backup.json"','Cache-Control':'private,no-store'}})}
  throw new Fault('not_found',404);
 }
 if(req.method!=='POST')throw new Fault('method_not_allowed',405);
 if(req.headers.get('Origin')!==new URL(req.url).origin)throw new Fault('invalid_origin',403);
 const raw=await req.text();if(raw.length>(path==='files'?8000000:1500000))throw new Fault('too_large',413);let input:any;try{input=clean(JSON.parse(raw))}catch{throw new Fault('invalid_json')}
 if(path==='google/start')return googleStart(req,db,uid,input);
 if(path==='google/disconnect')return googleDisconnect(db,uid,input);
 const mailboxResult=await mailboxEndpoint(req,db,uid,email||uid,path,input);if(mailboxResult)return mailboxResult;
 const extra=await operationEndpoint(req,db,(env as any).BUCKET,uid,email,path,input);if(extra)return extra;
 if(path==='records'){
  const {kind}=input;if(!kinds.has(kind))throw new Fault('invalid_kind');const id=kind==='automation'?await automationSaveId(db,uid):String(input.id||crypto.randomUUID());if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id))throw new Fault('invalid_id');
  const supplied=clean(input.payload),p:any={};for(const k of fields[kind])if(supplied[k]!==undefined)p[k]=supplied[k];validate(kind,p);
  for(const key of ['caseId','mailId','articleId','buyerId','requestId'])if(p[key]){const parent=await db.prepare('SELECT kind,payload,version FROM records WHERE id=? AND owner=?').bind(p[key],uid).first();if(!parent||parent.kind!==key.replace('Id',''))throw new Fault('parent_missing');if(kind==='training'){
    const article=JSON.parse(parent.payload);if(article.status!=='approved')throw new Fault('article_not_approved');
    const snapshot:any={};for(const key of ['title','titleEn','body','bodyEn','scope','scopeEn','reviewer','reason'])snapshot[key]=article[key]||'';snapshot.sourceIds=[...(article.sourceIds||[])];snapshot.status='approved';
    p.articleVersion=parent.version;p.articleSnapshot=snapshot;p.contentSHA=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)))),b=>b.toString(16).padStart(2,'0')).join('');p.articleCapturedAt=new Date().toISOString();
   }}
  for(const assetId of p.attachmentIds||[])if(!await db.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='asset'").bind(assetId,uid).first())throw new Fault('invalid_attachment');
  for(const source of p.sourceIds||[])if(!docs.some(d=>d.id===source)&&!await db.prepare('SELECT id FROM records WHERE id=? AND owner=?').bind(source,uid).first())throw new Fault('source_missing');
  if(kind==='buyer'){const matches=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='buyer'").bind(uid).all();if(matches.results.some((v:any)=>v.id!==id&&JSON.parse(v.payload).email.toLowerCase()===p.email.toLowerCase()))throw new Fault('email_exists',409)}
  if(kind==='profile'){const matches=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='profile'").bind(uid).all();if(matches.results.some((v:any)=>v.id!==id&&JSON.parse(v.payload).email.toLowerCase()===p.email.toLowerCase()))throw new Fault('email_exists',409)}
  if(kind==='mailbox'){const matches=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='mailbox'").bind(uid).all();if(matches.results.some((v:any)=>v.id!==id&&JSON.parse(v.payload).email===p.email))throw new Fault('email_exists',409)}
  if(['compose','mail','automation'].includes(kind)&&p.mailboxId){const mb=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(p.mailboxId,uid).first();if(!mb)throw new Fault('mailbox_required');const mp=JSON.parse(mb.payload);if(kind==='automation'&&(mp.provider!=='gmail'||!mp.verifiedAt||mp.enabled!=='true'||mp.email!==p.mailbox))throw new Fault('mailbox_unverified');if(kind==='compose')p.senderEmail=mp.email;if(kind==='mail')p.mailboxEmail=mp.email;}
  if(kind==='mail'&&p.messageId){const matches=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='mail'").bind(uid).all();if(matches.results.some((v:any)=>v.id!==id&&JSON.parse(v.payload).messageId===p.messageId&&(JSON.parse(v.payload).mailboxEmail||'')===(p.mailboxEmail||'')))throw new Fault('message_exists',409)}
  const old=await db.prepare('SELECT * FROM records WHERE id=?').bind(id).first();if(old&&old.owner!==uid)throw new Fault('not_found',404);if(!old&&kind!=='automation'&&reservedRecordId(id))throw new Fault('reserved_id',400);
  if(kind==='training'&&old){const before=JSON.parse(old.payload);if(before.articleId!==p.articleId)throw new Fault('article_locked');if(before.articleSnapshot&&before.articleVersion&&before.contentSHA){p.articleSnapshot=before.articleSnapshot;p.articleVersion=before.articleVersion;p.contentSHA=before.contentSHA;p.articleCapturedAt=before.articleCapturedAt||old.created_at;}}
  if(kind==='mailbox'){const before=old?JSON.parse(old.payload):null;const same=before?.email===p.email&&before?.provider===p.provider;p.verifiedAt=same?before.verifiedAt||'':'';p.connection=p.verifiedAt?'verified':'pending';if(same&&before?.connectionMode==='google_oauth'){p.connectionMode='google_oauth';p.draftAccess=before.draftAccess||'false'}else if(before?.connectionMode==='google_oauth')throw new Fault('google_identity_locked',409);}

  if(kind==='automation'&&p.enabled==='true'&&!p.mailboxId){const previous=old?JSON.parse(old.payload):null;if(!previous||previous.mailbox!==p.mailbox)throw new Fault('mailbox_required');}
  if(kind==='quotation')await validateQuotationLinks(db,uid,id,p,(code:string)=>{throw new Fault(code)});
  await validateDepartmentLinks(db,uid,kind,id,p,old?JSON.parse(old.payload):null,(code:string)=>{throw new Fault(code)});
  if(kind==='task')taskLifecycle(p,old?JSON.parse(old.payload):null,email||uid,new Date().toISOString());
  const json=JSON.stringify(p);if(old&&old.kind!==kind)throw new Fault('invalid_kind');if(old&&old.payload===json)return reply({...old,payload:p});if(old&&Number(input.version)!==old.version)throw new Fault('version_conflict',409);
  if(kind==='case'&&old&&JSON.parse(old.payload).baseline&&p.baseline!==JSON.parse(old.payload).baseline)throw new Fault('baseline_locked');
  const stamp=new Date().toISOString(),version=old?old.version+1:1;
  const mutation=old?db.prepare('UPDATE records SET payload=?,version=?,updated_at=? WHERE id=? AND owner=? AND version=?').bind(json,version,stamp,id,uid,old.version):db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(id,uid,kind,json,stamp,stamp);
  const changes=await db.batch([mutation,db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),uid,id,old?'update':'create',email||uid,old?.payload||'{}',json,stamp)]);
  if(!changes[0].meta.changes)throw new Fault('version_conflict',409);return reply({id,kind,version,payload:p,created_at:old?.created_at||stamp,updated_at:stamp});
 }
 if(path==='search'){const terms=norm(String(input.query||'').slice(0,300)).split(/\s+/).filter(s=>s.length>1);if(!terms.length)return reply({results:[]});const results=docs.map(d=>{const t=norm(d.text),name=norm(d.name+' '+d.customer);let score=terms.reduce((n,s)=>n+(t.includes(s)?1:0)+(name.includes(s)?3:0),0),page=d.pages.findIndex((p:string)=>terms.some(s=>norm(p).includes(s)));let lines=(d.pages[Math.max(0,page)]||'').split('\n').filter((l:string)=>terms.some(s=>norm(l).includes(s))).slice(0,5).map((x:string)=>x.trim().replace(/\s{3,}/g,' | '));return{...summary(d),score,page:page+1,snippet:lines.join('\n')}}).filter(d=>d.score>0).sort((a,b)=>b.score-a.score).slice(0,15);return reply({results});}
 if(path==='gmail'){if(!['thread','profile','search'].includes(input.action))throw new Fault('invalid_action');const checked=await checkGmailMailbox(db,uid,input.mailboxId);if(checked.error)return checked.error;if(input.action==='profile')return connectorResponse(checked.profile!);const provider=checked.provider!,action=input.action==='thread'?'read_email_thread':input.action==='profile'?'get_profile':'search_emails';if(action==='read_email_thread'&&!input.threadId&&!input.messageId)throw new Fault('invalid_id');const args:any=action==='search_emails'?{query:String(input.query||'-in:spam -in:trash (icmfactorydirect.com OR subject:quotation)').slice(0,400),max_results:20}:action==='read_email_thread'?{...(input.threadId?{thread_id:String(input.threadId).slice(0,128)}:{message_id:String(input.messageId).slice(0,128)}),max_messages:20}:{};return connectorResponse(await provider.invoke(gmailConnector,action,args));}
 throw new Fault('not_found',404);
 }catch(e:any){if(e instanceof Fault)return reply({error:e.code},e.status);console.error('MerchFlow route',e?.message);return reply({error:'operation_failed'},500)}}
export const GET=handler;export const POST=handler;
