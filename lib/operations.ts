import {checkGmailMailbox,gmailConnector} from '@/lib/mailboxes';
import {reminderSummary} from '@/public/task-reminder-core.mjs';
import { prepareDailyTasks } from '@/lib/tasks';
import { connectorsForRequest } from '@/lib/connectors';
import { connectorResponse } from '@/lib/connector-errors.mjs';

export const operationFields:Record<string,string[]> = {
 buyer:['name','email','company','status','notes'],
 intake:['title','template','caseId','buyerId','requestId','status','values','notes','sourceIds'],
 workbook:['title','template','caseId','buyerId','zone','currency','rows','notes'],
 compose:['mailboxId','senderEmail','subject','to','cc','bcc','body','caseId','buyerId','requestId','attachmentIds','sourceIds'],
 request:['mailboxId','mailboxEmail','title','buyerId','buyerEmail','customerName','messageId','threadId','receivedAt','summary','requirements','missingInfo','nextActions','priority','status','due','product','quantity','fabric','colors','sizes','artwork','delivery','sourceExcerpt','draftSubject','draftBody','caseId','sourceIds'],
 automation:['mailboxId','mailbox','time','timezone','query','driveFolderUrl','enabled','summaryMode']
};
const templates=['inquiry','quotation','sample','material','production','quality'];
const zones=['inquiry','quotation','sample','material','production','quality','shipping','general'];
const emailPattern=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const list=(v:any,max=30)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length<=5000);
export function validateOperation(kind:string,p:any,fail:(code:string)=>never){
 const text=(key:string,min=1)=>{if(typeof p[key]!=='string'||p[key].trim().length<min)fail('required_'+key)};
 if(kind==='buyer'){text('name');text('email');if(!emailPattern.test(p.email))fail('invalid_email');if(!['new','active','archived'].includes(p.status))fail('invalid_status');p.email=p.email.toLowerCase().trim()}
 if(kind==='intake'){text('title',3);if(!templates.includes(p.template))fail('invalid_template');if(!['draft','confirmed'].includes(p.status))fail('invalid_status');if(!object(p.values)||Object.keys(p.values).length>50||Object.values(p.values).some(v=>typeof v!=='string'||v.length>12000))fail('invalid_input')}
 if(kind==='workbook'){text('title',3);if(!templates.includes(p.template)||!zones.includes(p.zone))fail('invalid_template');const counts:Record<string,number>={inquiry:8,quotation:7,sample:7,material:8,production:8,quality:8};const numeric:Record<string,number[]>={inquiry:[2],quotation:[3,4],sample:[3],material:[4,5],production:[2,3],quality:[2,3]};if(!Array.isArray(p.rows)||p.rows.length>500||p.rows.some((r:any)=>!Array.isArray(r)||r.length!==counts[p.template]||r.some((v:any)=>typeof v!=='string'||v.length>2000)))fail('invalid_rows');for(const row of p.rows)for(const col of numeric[p.template])if(row[col]!==''&&(!/^\d+(\.\d+)?$/.test(row[col])||!Number.isFinite(Number(row[col]))))fail('invalid_qty');if(p.currency&&!['USD','VND','AUD','EUR','GBP'].includes(p.currency))fail('invalid_currency')}
 if(kind==='compose'){text('subject');text('body');text('to');for(const key of ['to','cc','bcc'])if(p[key]){const emails=p[key].split(/[;,]/).map((v:string)=>v.trim()).filter(Boolean);if(emails.length>20||emails.some((v:string)=>!emailPattern.test(v)))fail('invalid_email');p[key]=emails.join(', ')}if(p.subject.length>250||/[\r\n]/.test(p.subject))fail('invalid_input');if(p.attachmentIds&&!list(p.attachmentIds,5))fail('invalid_attachment')}
 if(kind==='request'){text('title');text('messageId');text('buyerEmail');text('summary');if(!emailPattern.test(p.buyerEmail))fail('invalid_email');if(!['new','reviewing','confirmed','closed'].includes(p.status)||!['normal','high','urgent'].includes(p.priority))fail('invalid_status');for(const k of ['requirements','missingInfo','nextActions'])if(p[k]&&!list(p[k]))fail('invalid_input')}
 if(kind==='automation'){if(!emailPattern.test(p.mailbox||'')||p.timezone!=='Asia/Bangkok')fail('invalid_input');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time))fail('invalid_time');if(!['true','false'].includes(p.enabled)||!['draft','tabs'].includes(p.summaryMode))fail('invalid_input');if(p.driveFolderUrl&&!/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(p.driveFolderUrl))fail('invalid_drive_url')}
}
export const structuredFields=new Set(['values','rows','requirements','missingInfo','nextActions','attachmentIds']);
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private,no-store'}});
const safeText=(v:any,max=50000)=>typeof v==='string'?v.slice(0,max):'';
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32)}
function nativeData(result:any){if(result?.result?.structuredContent)return result.result.structuredContent;const raw=result?.result?.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n')||'';try{return JSON.parse(raw)}catch{return{}}}
const html=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// Sites dispatch authenticates service access. Signed-in visitors may only read
// their own scheduler data; service access grants no provider consent.
export async function dailyWorker(req:Request,db:any){
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==new URL(req.url).origin)return response({error:'invalid_origin'},403);
 const settings=await db.prepare("SELECT * FROM records WHERE id='merchflow-automation-config' AND kind='automation'").first();
 if(!settings)return response({error:'setup_required'},409);
 const cfg=JSON.parse(settings.payload),owner=settings.owner;let mailSource='chatgpt';
 const visitor=req.headers.get('oai-authenticated-user-id');if(visitor&&visitor!==owner)return response({error:'not_found'},404);
 if(cfg.mailboxId){const mb=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(cfg.mailboxId,owner).first();const p=mb?JSON.parse(mb.payload):null;mailSource=p?.connectionMode==='google_oauth'?'google_oauth':'chatgpt';if(!p||p.enabled!=='true'||!p.verifiedAt||p.provider!=='gmail'||p.email!==cfg.mailbox)return response({error:'mailbox_unverified'},409);}
 if(req.method==='GET'){
  const rows=await db.prepare("SELECT * FROM records WHERE owner=? AND kind IN ('buyer','request','case','digest','intake','asset','workbook','compose','mail','departmentItem','departmentSource','task','taskRun','mailbox') ORDER BY updated_at DESC").bind(owner).all();
  const records=rows.results.map((r:any)=>({...r,payload:JSON.parse(r.payload)}));
  return response({schema:'merchflow.daily.v1',settings:cfg,mailSource,owner,records,reminders:reminderSummary(records.filter((r:any)=>r.kind==='task')),instructions:'/daily-workflow.json'});
 }
 if(req.method!=='POST')return response({error:'method_not_allowed'},405);
 if(cfg.enabled!=='true')return response({error:'automation_disabled'},409);
 let data:any;try{const raw=await req.text();if(raw.length>1800000)throw Error();data=JSON.parse(raw)}catch{return response({error:'invalid_json'},400)}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(data.day||'')||Number.isNaN(Date.parse(data.day))||new Date(data.day).toISOString().slice(0,10)!==data.day||!Array.isArray(data.items)||data.items.length>25||data.mailbox!==cfg.mailbox||!list(data.coverage?.queries,30)||typeof data.coverage?.complete!=='boolean')return response({error:'invalid_batch'},400);
 const stamp=new Date().toISOString(),batch:any[]=[],inserted:string[]=[],skipped:string[]=[];
 const knownBuyers=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='buyer'").bind(owner).all();
 const buyerMap=new Map<string,string>(knownBuyers.results.map((r:any)=>[JSON.parse(r.payload).email.toLowerCase(),r.id]));
 const put=(id:string,kind:string,p:any)=>{const json=JSON.stringify(p);batch.push(db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(id,owner,kind,json,stamp,stamp));batch.push(db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND created_at=?)').bind(crypto.randomUUID(),owner,id,'create','Daily review','{}',json,stamp,id,stamp));};
 for(const item of data.items){
  if(!object(item)||!emailPattern.test(item.buyerEmail||'')||!item.messageId||!item.summary||!item.source?.body||!item.source?.from||!item.source?.subject)return response({error:'missing_evidence'},400);
  if(String(item.messageId).length>128||String(item.threadId||'').length>128)return response({error:'invalid_id'},400);
  const existingRequest=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='request' AND json_extract(payload,'$.messageId')=? AND json_extract(payload,'$.mailboxEmail')=?").bind(owner,item.messageId,cfg.mailbox).first();const id=existingRequest?.id||'request_'+await hash(owner+':'+cfg.mailbox+':'+item.messageId);const old=existingRequest;if(old){skipped.push(id);continue}
  const buyerEmail=item.buyerEmail.toLowerCase().trim();let buyerId=buyerMap.get(buyerEmail);
  if(!buyerId){buyerId='buyer_'+await hash(owner+':'+buyerEmail);put(buyerId,'buyer',{email:buyerEmail,name:safeText(item.customerName||buyerEmail,200),company:safeText(item.company,200),status:'new',notes:'Created from email; identity requires review.'});buyerMap.set(buyerEmail,buyerId)}
  const matchingMail=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='mail' AND json_extract(payload,'$.messageId')=? AND json_extract(payload,'$.mailboxEmail')=?").bind(owner,item.messageId,cfg.mailbox).first();
  const mailId=matchingMail?.id||'mail_'+await hash(owner+':'+cfg.mailbox+':'+item.messageId);
  put(mailId,'mail',{subject:safeText(item.source.subject,300),from:safeText(item.source.from,500),to:safeText(item.source.to,2000),date:safeText(item.receivedAt,10),body:safeText(item.source.body),messageId:item.messageId,threadId:item.threadId||'',caseId:'',source:'gmail',sourceIds:[],mailboxId:cfg.mailboxId||'',mailboxEmail:cfg.mailbox});
  const p:any={};for(const key of operationFields.request)if(item[key]!==undefined)p[key]=item[key];
  Object.assign(p,{mailboxId:cfg.mailboxId||'',mailboxEmail:cfg.mailbox,buyerId,buyerEmail,status:'new',priority:['normal','high','urgent'].includes(item.priority)?item.priority:'normal',sourceIds:[mailId],caseId:''});
  if(p.due&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.due)||Number.isNaN(Date.parse(p.due))||new Date(p.due).toISOString().slice(0,10)!==p.due))return response({error:'invalid_date'},400);
  if(p.receivedAt&&Number.isNaN(Date.parse(p.receivedAt)))return response({error:'invalid_date'},400);
  try{for(const [key,v]of Object.entries(p))if(!structuredFields.has(key)&&key!=='sourceIds'&&(typeof v!=='string'||v.length>50000))throw Error();validateOperation('request',p,()=>{throw Error()})}catch{return response({error:'invalid_request'},400)}
  put(id,'request',p);
  if(cfg.summaryMode==='draft'&&p.draftBody&&p.draftSubject)put('compose_'+await hash(owner+':'+cfg.mailbox+':'+item.messageId),'compose',{mailboxId:cfg.mailboxId||'',senderEmail:cfg.mailbox,subject:p.draftSubject,body:p.draftBody,to:buyerEmail,cc:'',bcc:'',buyerId,requestId:id,caseId:'',attachmentIds:[],sourceIds:[mailId]});
  inserted.push(id);
 }
 let taskResult:any;try{taskResult=await prepareDailyTasks(db,owner,cfg.mailbox,data,stamp)}catch(e:any){return response({error:e.message||'invalid_task_batch'},400)}
 if(taskResult)batch.push(...taskResult.statements);

 const digestId='digest_'+await hash(owner+':'+cfg.mailbox+':'+data.day),previous=await db.prepare('SELECT * FROM records WHERE id=? AND owner=?').bind(digestId,owner).first();
 if(!data.taskOnly&&cfg.summaryMode==='draft'&&data.digestEmail){
  const draft={mailboxId:cfg.mailboxId||'',senderEmail:cfg.mailbox,subject:safeText(data.digestEmail.subject,250),body:safeText(data.digestEmail.body),to:cfg.mailbox,cc:'',bcc:'',buyerId:'',requestId:'',caseId:'',attachmentIds:[],sourceIds:[]};
  try{validateOperation('compose',draft,()=>{throw Error()})}catch{return response({error:'invalid_digest_email'},400)}

  put('compose_digest_'+await hash(owner+':'+cfg.mailbox+':'+data.day),'compose',draft);
 }
 if(data.taskOnly&&(!taskResult||data.items.length))return response({error:'invalid_task_batch'},400);
 if(!data.taskOnly){
 const digest={mailboxId:cfg.mailboxId||'',mailboxEmail:cfg.mailbox,day:data.day,title:safeText(data.title||'Daily customer requests',250),summary:safeText(data.summary),requestIds:[...new Set([...(previous?JSON.parse(previous.payload).requestIds||[]:[]),...inserted,...skipped])],coverage:data.coverage,status:data.coverage.complete===true?'complete':'partial',completedAt:stamp};
 const json=JSON.stringify(digest);batch.push(db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=records.version+1,updated_at=excluded.updated_at').bind(digestId,owner,'digest',json,stamp,stamp));
 batch.push(db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,digestId,previous?'update':'create','Daily review',previous?.payload||'{}',json,stamp));
 }
 // D1 batches are atomic; no watermark advances when the batch fails.
 await db.batch(batch);
 return response({ok:true,inserted,skipped,digestId:data.taskOnly?null:digestId,tasks:taskResult?{inserted:taskResult.inserted,skipped:taskResult.skipped,runId:taskResult.runId}:null});
}

export async function operationEndpoint(req:Request,db:any,bucket:any,uid:string,email:string,path:string,input?:any):Promise<Response|null>{
 if(req.method==='GET'&&path.startsWith('files/')){const id=path.split('/')[1],r=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='asset'").bind(id,uid).first();if(!r)return response({error:'not_found'},404);const p=JSON.parse(r.payload),file=await bucket.get(p.key);if(!file)return response({error:'file_missing'},404);return new Response(file.body,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(p.name)}`,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}})}
 if(req.method!=='POST')return null;
 if(path==='files'){
  if(!bucket)return response({error:'storage_unavailable'},503);
  const book=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind=?").bind(input.quotationId||input.workbookId,uid,input.quotationId?'quotation':'workbook').first();if(!book)return response({error:'parent_missing'},400);if(book.version!==input.version)return response({error:'version_conflict'},409);
  if(typeof input.base64!=='string'||input.base64.length>7000000)return response({error:'too_large'},413);
  let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0))}catch{return response({error:'invalid_file'},400)}
  if(bytes.length<50||bytes[0]!==80||bytes[1]!==75)return response({error:'invalid_file'},400);
  const id='file_'+await hash(book.id+':'+book.version);const old=await db.prepare('SELECT * FROM records WHERE id=? AND owner=?').bind(id,uid).first();if(old)return response({...old,payload:JSON.parse(old.payload)});
  const bp=JSON.parse(book.payload),stamp=new Date().toISOString(),key=uid+'/'+id+'.xlsx',p={name:(book.kind==='quotation'?bp.number+'-'+bp.revision+'-v'+book.version:bp.title).replace(/[\\/:*?"<>|]/g,'-').slice(0,120)+'.xlsx',key,workbookId:book.kind==='workbook'?book.id:'',quotationId:book.kind==='quotation'?book.id:'',workbookVersion:book.version,caseId:bp.caseId||'',buyerId:bp.buyerId||'',zone:book.kind==='quotation'?'quotation':bp.zone,bytes:bytes.length,driveStatus:'not_connected'};
  await bucket.put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  const json=JSON.stringify(p);await db.batch([db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(id,uid,'asset',json,stamp,stamp),db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,id,'create',email,'{}',json,stamp)]);
  return response({id,kind:'asset',version:1,payload:p,created_at:stamp,updated_at:stamp});
 }
 if(path==='gmail-draft'){
  const record=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='compose'").bind(input.id,uid).first();if(!record)return response({error:'not_found'},404);if(record.version!==input.version)return response({error:'version_conflict'},409);
  const actionId='gmaildraft_'+await hash(record.id+':'+record.version),existing=await db.prepare('SELECT * FROM records WHERE id=? AND owner=?').bind(actionId,uid).first();
  if(existing){const saved=JSON.parse(existing.payload);return response(saved,saved.status==='success'?200:409)}
  const p=JSON.parse(record.payload),checked=await checkGmailMailbox(db,uid,p.mailboxId);if(checked.error)return checked.error;const provider=checked.provider!;if(p.senderEmail!==checked.p.email)return response({error:'wrong_mailbox'},409);
  const parts:any[]=[{mime_type:'text/html',charset:'UTF-8',body:{content:'<div style="white-space:pre-wrap;font-family:Arial,sans-serif">'+html(p.body)+'</div>'}}];
  let total=0;for(const id of p.attachmentIds||[]){const asset=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='asset'").bind(id,uid).first();if(!asset)return response({error:'invalid_attachment'},400);const a=JSON.parse(asset.payload);total+=a.bytes;if(total>5000000)return response({error:'too_large'},413);const file=await bucket.get(a.key);if(!file)return response({error:'file_missing'},404);let binary='';for(const byte of new Uint8Array(await file.arrayBuffer()))binary+=String.fromCharCode(byte);parts.push({mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:a.name,content_disposition:'attachment',body:{base64_url_content:btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}})}
  const stamp=new Date().toISOString();const lock=await db.prepare('INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING').bind(actionId,uid,'external_action',JSON.stringify({status:'pending',composeId:record.id,version:record.version}),stamp,stamp).run();if(!lock.meta.changes)return response({error:'operation_pending'},409);
  let result:any;try{result=await provider.invoke(gmailConnector,'create_draft',{to:p.to,...(p.cc?{cc:p.cc}:{}),...(p.bcc?{bcc:p.bcc}:{}),subject:p.subject,payload:parts.length===1?parts[0]:{mime_type:'multipart/mixed',parts}})}catch{await db.prepare('UPDATE records SET payload=? WHERE id=?').bind(JSON.stringify({status:'unknown',error:'check_gmail_before_retry',composeId:record.id}),actionId).run();return response({error:'check_gmail_before_retry'},409)}
  const data=nativeData(result),out={status:result.status==='success'?'success':'requires_review',composeId:record.id,version:record.version,draftId:data.id||'',message:result.status==='success'?'Draft created in Gmail':'Review the connector response before retrying',connector:result.status==='success'?undefined:result};
  await db.batch([db.prepare('UPDATE records SET payload=?,updated_at=? WHERE id=?').bind(JSON.stringify(out),new Date().toISOString(),actionId),db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,record.id,'gmail_draft',email,'{}',JSON.stringify(out),new Date().toISOString())]);
  return response(out,result.status==='success'?200:409);
 }
 return null;
}
