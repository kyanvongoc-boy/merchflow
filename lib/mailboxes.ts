import { env } from 'cloudflare:workers';
import { connectorsForRequest } from '@/lib/connectors';
import { connectorResponse } from '@/lib/connector-errors.mjs';
import { googleProvider } from '@/lib/google-mail';

export const mailboxFields=['email','provider','label','serviceName','enabled'];
export const gmailConnector=String((env as any).GMAIL_CONNECTOR_ID||'');
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private,no-store'}});
export function validateMailbox(p:any,fail:(code:string)=>never){
 if(typeof p.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)||/[<>,;\s]/.test(p.email)||p.email.length>254)fail('invalid_email');
 p.email=p.email.toLowerCase().trim();
 if(!['gmail','outlook','other'].includes(p.provider)||!['true','false'].includes(p.enabled))fail('invalid_input');
 if(typeof p.label!=='string'||!p.label.trim()||p.label.length>100||typeof p.serviceName!=='string'||p.serviceName.length>150)fail('invalid_input');
 if(p.provider==='other'&&!p.serviceName.trim())fail('mail_service_required');
}
export function profileEmail(result:any):string{
 let data=result?.result?.structuredContent;
 if(!data){try{data=JSON.parse((result?.result?.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'))}catch{return ''}}
 return String(data?.emailAddress||data?.email||data?.profile?.email||data?.profile?.emailAddress||'').toLowerCase().trim();
}
export async function checkGmailMailbox(db:any,uid:string,id:any,requireVerified=true){
 const row=typeof id==='string'?await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(id,uid).first():null;
 if(!row)return {error:response({error:'mailbox_required'},400)};
 const p=JSON.parse(row.payload);
 if(p.enabled!=='true')return {error:response({error:'mailbox_paused'},409)};
 if(p.provider!=='gmail')return {error:response({error:'mail_provider_pending'},409)};
 if(requireVerified&&!p.verifiedAt)return {error:response({error:'mailbox_unverified'},409)};
 if(p.connectionMode!=='google_oauth'&&!gmailConnector)return {error:response({error:'connector_unavailable'},409)};
 const provider=p.connectionMode==='google_oauth'?googleProvider(db,uid,row.id):connectorsForRequest(),profile=await provider.invoke(gmailConnector,'get_profile',{});
 if(profile.status!=='success')return {error:connectorResponse(profile)};
 const address=profileEmail(profile);
 if(!address)return {error:response({error:'mailbox_unidentified'},409)};
 if(address!==p.email)return {error:response({error:'wrong_mailbox'},409)};
 return {row,p,provider,profile};
}
export async function mailboxEndpoint(req:Request,db:any,uid:string,actor:string,path:string,input:any){
 if(req.method!=='POST'||!['mailbox-verify','mailbox-current'].includes(path))return null;
 if(path==='mailbox-current'&&!gmailConnector)return response({error:'connector_unavailable'},409);
 if(path==='mailbox-current')return connectorResponse(await connectorsForRequest().invoke(gmailConnector,'get_profile',{}));
 const checked=await checkGmailMailbox(db,uid,input.id,false);if(checked.error)return checked.error;
 const {row,p}=checked;if(Number(input.version)!==row.version)return response({error:'version_conflict'},409);
 const stamp=new Date().toISOString(),payload={...p,verifiedAt:stamp,connection:'verified'},json=JSON.stringify(payload);
 const changes=await db.batch([
  db.prepare('UPDATE records SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?').bind(json,stamp,row.id,uid,row.version),
  db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND version=? AND updated_at=?)').bind(crypto.randomUUID(),uid,row.id,'mailbox_verify',actor,row.payload,json,stamp,row.id,uid,row.version+1,stamp)
 ]);
 if(!changes[0].meta.changes)return response({error:'version_conflict'},409);
 return response({ok:true,email:p.email,verifiedAt:stamp});
}
