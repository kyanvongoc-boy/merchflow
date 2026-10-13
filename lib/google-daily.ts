import {checkGmailMailbox,gmailConnector} from '@/lib/mailboxes';
import {connectorResponse} from '@/lib/connector-errors.mjs';
const reply=(x:any,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'private,no-store'}});
// Sites service access is required at the host boundary. Scope is the existing schedule owner only.
export async function dailyGmail(req:Request,db:any){
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==new URL(req.url).origin)return reply({error:'invalid_origin'},403);
 const row=await db.prepare("SELECT * FROM records WHERE id='merchflow-automation-config' AND kind='automation'").first();if(!row)return reply({error:'setup_required'},409);
 const visitor=req.headers.get('oai-authenticated-user-id');if(visitor&&visitor!==row.owner)return reply({error:'not_found'},404);
 const cfg=JSON.parse(row.payload);if(cfg.enabled!=='true')return reply({error:'automation_disabled'},409);
 const mailbox=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(cfg.mailboxId||'',row.owner).first();const p=mailbox?JSON.parse(mailbox.payload):null;
 if(!p||p.connectionMode!=='google_oauth'||p.email!==cfg.mailbox)return reply({error:'mailbox_unverified'},409);
 let input:any;try{const text=await req.text();if(text.length>6000)throw Error();input=JSON.parse(text);if(!input||!['profile','search','thread'].includes(input.action))throw Error()}catch{return reply({error:'invalid_input'},400)}
 const checked=await checkGmailMailbox(db,row.owner,cfg.mailboxId);if(checked.error)return checked.error;
 if(input.action==='profile')return connectorResponse(checked.profile);
 const action=input.action==='search'?'search_emails':'read_email_thread';
 const args=input.action==='search'?{query:String(input.query||'').slice(0,400),max_results:50,page_token:String(input.pageToken||'').slice(0,2048)}:{...(input.threadId?{thread_id:String(input.threadId).slice(0,128)}:{message_id:String(input.messageId||'').slice(0,128)}),max_messages:50};
 return connectorResponse(await checked.provider!.invoke(gmailConnector,action,args));
}
