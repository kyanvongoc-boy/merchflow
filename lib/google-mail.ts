import { env } from 'cloudflare:workers';

const READ='https://www.googleapis.com/auth/gmail.readonly',COMPOSE='https://www.googleapis.com/auth/gmail.compose';
const enc=new TextEncoder();
const json=(x:any,status=200,headers:any={})=>Response.json(x,{status,headers:{'Cache-Control':'private,no-store',...headers}});
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const url64=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const random=()=>url64(crypto.getRandomValues(new Uint8Array(32)));
const hash=async(s:string)=>url64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))));
function config(){const e=env as any;return {id:e.GOOGLE_CLIENT_ID||'',secret:e.GOOGLE_CLIENT_SECRET||'',key:e.GOOGLE_TOKEN_ENCRYPTION_KEY||'',redirect:e.GOOGLE_REDIRECT_URI||''}}
export function googleConfigured(){try{const c=config();return !!(c.id.endsWith('.apps.googleusercontent.com')&&c.secret&&decode(c.key).length===32&&new URL(c.redirect).protocol==='https:'&&new URL(c.redirect).pathname==='/api/google/callback')}catch{return false}}
async function encrypt(value:any,aad:string){const key=await crypto.subtle.importKey('raw',decode(config().key),{name:'AES-GCM'},false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(value)));return url64(iv)+'.'+url64(new Uint8Array(data))}
async function decrypt(value:string,aad:string){const [iv,data]=value.split('.');const key=await crypto.subtle.importKey('raw',decode(config().key),{name:'AES-GCM'},false,['decrypt']);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:enc.encode(aad)},key,decode(data));return JSON.parse(new TextDecoder().decode(plain))}
async function googleFetch(url:string,options:any={}){return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)})}
const success=(data:any)=>({status:'success',result:{content:[],structuredContent:data}});
const failure=(status:string,message:string,extra:any={})=>({status,message,...extra});
const clearCookie='__Host-mf_google=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
function finish(outcome:string,id=''){const q=new URLSearchParams({google_connection:outcome});if(id)q.set('mailbox',id);return new Response(null,{status:303,headers:{Location:'/workspace?'+q+'#settings','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':clearCookie}})}

export async function googleStart(req:Request,db:any,uid:string,input:any){
 if(!googleConfigured())return json({error:'google_setup_required'},409);
 const c=config();if(new URL(c.redirect).origin!==new URL(req.url).origin)return json({error:'google_origin_mismatch'},409);
 const mode=input.mode==='compose'?'compose':'read';let target='';
 if(mode==='compose'){const r=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(String(input.mailboxId||''),uid).first();if(!r)return json({error:'mailbox_required'},400);const p=JSON.parse(r.payload);if(p.connectionMode!=='google_oauth')return json({error:'invalid_input'},400);target=p.email;}
 const state=random(),verifier=random(),nonce=random(),stateHash=await hash(state),stamp=Date.now();
 await db.batch([db.prepare('DELETE FROM google_oauth_states WHERE expires_at<?').bind(stamp),db.prepare('INSERT INTO google_oauth_states(state_hash,owner,browser_hash,verifier,expires_at,target_email,mode) VALUES(?,?,?,?,?,?,?)').bind(stateHash,uid,await hash(nonce),await encrypt(verifier,stateHash),stamp+600000,target,mode)]);
 const params=new URLSearchParams({client_id:c.id,redirect_uri:c.redirect,response_type:'code',scope:mode==='compose'?READ+' '+COMPOSE:READ,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state,code_challenge:await hash(verifier),code_challenge_method:'S256'});if(target)params.set('login_hint',target);
 return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params},200,{'Set-Cookie':'__Host-mf_google='+nonce+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});
}

// This endpoint completes email authorization only. Sites continues to own app identity.
export async function googleCallback(req:Request,db:any,uid:string){
 if(!googleConfigured())return finish('setup_required');
 const u=new URL(req.url),state=u.searchParams.get('state')||'',nonce=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-mf_google='))?.slice(17)||'';
 if(!uid||!state||!nonce||state.length>200||nonce.length>200)return finish('expired');
 const stateHash=await hash(state);
 const pending=await db.prepare('DELETE FROM google_oauth_states WHERE state_hash=? AND owner=? AND browser_hash=? AND expires_at>? RETURNING *').bind(stateHash,uid,await hash(nonce),Date.now()).first();
 if(!pending)return finish('expired');
 if(u.searchParams.has('error'))return finish(u.searchParams.get('error')==='access_denied'?'cancelled':'failed');
 const code=u.searchParams.get('code');if(!code||code.length>4096)return finish('failed');
 try{
  const c=config(),tokenResponse=await googleFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,code,code_verifier:await decrypt(pending.verifier,stateHash),grant_type:'authorization_code'})});
  if(!tokenResponse.ok)return finish('failed');const token:any=await tokenResponse.json();
  const scopes=String(token.scope||'').split(' ');if(!token.access_token||!scopes.includes(READ)||(pending.mode==='compose'&&!scopes.includes(COMPOSE)))return finish('permission_missing');
  const profileResponse=await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});if(!profileResponse.ok)return finish('failed');
  const profile:any=await profileResponse.json(),email=String(profile.emailAddress||'').toLowerCase().trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return finish('failed');
  if(pending.target_email&&pending.target_email!==email)return finish('wrong_account');
  const old=await db.prepare("SELECT * FROM records WHERE owner=? AND kind='mailbox' AND json_extract(payload,'$.email')=?").bind(uid,email).first(),p=old?JSON.parse(old.payload):{};
  const id=old?.id||'google_'+await hash(uid+'\n'+email),aad=uid+':'+id;
  const oldTokens=await db.prepare('SELECT * FROM google_mail_tokens WHERE mailbox_id=? AND owner=?').bind(id,uid).first();
  const refresh=token.refresh_token||(oldTokens?(await decrypt(oldTokens.encrypted_tokens,aad)).refresh_token:'');if(!refresh)return finish('offline_missing');
  const stamp=new Date().toISOString(),payload={email,provider:'gmail',label:p.label||email,serviceName:'',enabled:'true',verifiedAt:stamp,connection:'verified',connectionMode:'google_oauth',draftAccess:scopes.includes(COMPOSE)?'true':'false'},encoded=JSON.stringify(payload);
  const sealed=await encrypt({access_token:token.access_token,refresh_token:refresh,expires_at:Date.now()+Math.max(0,Number(token.expires_in)||3600)*1000,scope:scopes.join(' ')},aad);
  const mutation=old?db.prepare('UPDATE records SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?').bind(encoded,stamp,id,uid,old.version):db.prepare("INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) SELECT ?,?,'mailbox',?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='mailbox' AND json_extract(payload,'$.email')=?) ON CONFLICT(id) DO NOTHING").bind(id,uid,encoded,stamp,stamp,uid,email);
  const changed=await db.batch([mutation,db.prepare('INSERT INTO google_mail_tokens(mailbox_id,owner,email,encrypted_tokens,updated_at) SELECT ?,?,?,?,? WHERE changes()=1 ON CONFLICT(mailbox_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,updated_at=excluded.updated_at WHERE google_mail_tokens.owner=excluded.owner AND google_mail_tokens.email=excluded.email').bind(id,uid,email,sealed,stamp),db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),uid,id,'google_connect',uid,old?.payload||'{}',encoded,stamp)]);
  return changed[0].meta.changes&&changed[1].meta.changes?finish('connected',id):finish('conflict');
 }catch{return finish('failed')}
}

async function accessToken(db:any,uid:string,id:string){
 if(!googleConfigured())throw new Error('google_setup_required');
 const r=await db.prepare('SELECT * FROM google_mail_tokens WHERE mailbox_id=? AND owner=?').bind(id,uid).first();if(!r)throw new Error('google_reauthentication_required');
 const tokens=await decrypt(r.encrypted_tokens,uid+':'+id);if(tokens.expires_at>Date.now()+60000)return {token:tokens.access_token,scope:tokens.scope};
 const c=config(),res=await googleFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,refresh_token:tokens.refresh_token,grant_type:'refresh_token'})});
 const data:any=await res.json();if(!res.ok||!data.access_token)throw new Error(data.error==='invalid_grant'?'google_reauthentication_required':'google_unavailable');
 const updated={...tokens,access_token:data.access_token,expires_at:Date.now()+(Number(data.expires_in)||3600)*1000,scope:data.scope||tokens.scope};
 const sealed=await encrypt(updated,uid+':'+id);const changed=await db.prepare('UPDATE google_mail_tokens SET encrypted_tokens=?,updated_at=? WHERE mailbox_id=? AND owner=? AND encrypted_tokens=?').bind(sealed,new Date().toISOString(),id,uid,r.encrypted_tokens).run();
 if(!changed.meta.changes){const current=await db.prepare('SELECT encrypted_tokens FROM google_mail_tokens WHERE mailbox_id=? AND owner=?').bind(id,uid).first();if(!current)throw new Error('google_reauthentication_required');const latest=await decrypt(current.encrypted_tokens,uid+':'+id);return {token:latest.access_token,scope:latest.scope}}
 return {token:updated.access_token,scope:updated.scope};
}

export function googleProvider(db:any,uid:string,id:string){
 return {async invoke(_connector:string,action:string,args:any){
  try{
   if(!['get_profile','search_emails','read_email_thread','create_draft'].includes(action))return failure('invalid_request','Unsupported Gmail action.');
   const auth=await accessToken(db,uid,id);
   if(action==='create_draft'&&!String(auth.scope).split(' ').includes(COMPOSE))return failure('google_scope_required','Cần cấp quyền tạo bản nháp Gmail.');
   async function call(path:string,body?:any){const r=await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const e:any=new Error(r.status===401?'google_reauthentication_required':r.status===403?'google_permission_denied':r.status===429?'rate_limited':'google_unavailable');e.retryAfterMs=r.status===429?Math.max(1000,Number(r.headers.get('Retry-After'))*1000||30000):undefined;throw e}return await r.json() as any}
   if(action==='get_profile')return success(await call('profile'));
   if(action==='search_emails'){
    const query=new URLSearchParams({q:String(args.query||'').slice(0,400),maxResults:String(Math.min(50,Math.max(1,Number(args.max_results)||20)))});if(args.page_token)query.set('pageToken',String(args.page_token).slice(0,2048));
    const page=await call('messages?'+query),emails:any[]=[];
    for(let i=0;i<(page.messages||[]).length;i+=5){emails.push(...await Promise.all(page.messages.slice(i,i+5).map((m:any)=>call('messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date'))))}
    return success({emails,next_page_token:page.nextPageToken||'',result_size_estimate:page.resultSizeEstimate||0});
   }
   if(action==='read_email_thread'){
    const key=String(args.thread_id||args.message_id||'');if(!/^[a-zA-Z0-9_-]{1,128}$/.test(key))return failure('invalid_request','Invalid Gmail message ID.');
    const data=await call((args.thread_id?'threads/':'messages/')+encodeURIComponent(key)+'?format=full');const all=args.thread_id?(data.messages||[]):[data];const limit=Math.min(50,Math.max(1,Number(args.max_messages)||20));return success({messages:all.slice(-limit),truncated:all.length>limit});
   }
   const profile=await call('profile');return success(await call('drafts',{message:{raw:makeDraftMime(args,profile.emailAddress)}}));
  }catch(e:any){return failure(['google_reauthentication_required','google_scope_required','google_setup_required','google_permission_denied','rate_limited'].includes(e.message)?e.message:'upstream_error',e.message==='rate_limited'?'Google đang giới hạn lượt truy cập. Vui lòng thử lại sau.':'Không thể hoàn tất truy cập Gmail. Kiểm tra kết nối trước khi thử lại.',e.retryAfterMs?{retryAfterMs:e.retryAfterMs}:{})}
 }};
}

function makeDraftMime(args:any,email:string){
 const header=(s:any)=>{const v=String(s||'');if(/[\r\n]/.test(v))throw new Error('invalid_header');return v};
 const encodedWord=(s:string)=>{const words:string[]=[];let chunk='';for(const c of s){if(enc.encode(chunk+c).length>42){words.push('=?UTF-8?B?'+b64(enc.encode(chunk))+'?=');chunk=''}chunk+=c}if(chunk)words.push('=?UTF-8?B?'+b64(enc.encode(chunk))+'?=');return words.join('\r\n ')};
 const lines=[`From: ${header(email)}`,`To: ${header(args.to)}`,`Subject: ${encodedWord(header(args.subject))}`,'MIME-Version: 1.0'];if(args.cc)lines.push('Cc: '+header(args.cc));if(args.bcc)lines.push('Bcc: '+header(args.bcc));
 const part=(p:any):string=>{if(p.parts){const boundary='mf_'+crypto.randomUUID();return 'Content-Type: multipart/mixed; boundary="'+boundary+'"\r\n\r\n'+p.parts.map((x:any)=>'--'+boundary+'\r\n'+part(x)).join('\r\n')+'\r\n--'+boundary+'--\r\n'}const mime=header(p.mime_type||'application/octet-stream');const body=p.body?.base64_url_content?b64(decode(p.body.base64_url_content)):b64(enc.encode(String(p.body?.content||'')));const filename=p.filename?'; filename*=UTF-8\'\''+encodeURIComponent(String(p.filename)) :'';return 'Content-Type: '+mime+(mime.startsWith('text/')?'; charset=UTF-8':'')+'\r\nContent-Transfer-Encoding: base64\r\n'+(filename?'Content-Disposition: attachment'+filename+'\r\n':'')+'\r\n'+(body.match(/.{1,76}/g)||['']).join('\r\n')+'\r\n'};
 return url64(enc.encode(lines.join('\r\n')+'\r\n'+part(args.payload)));
}

export async function googleDisconnect(db:any,uid:string,input:any){
 const r=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='mailbox'").bind(String(input.id||''),uid).first();if(!r)return json({error:'mailbox_required'},400);if(input.version!==r.version)return json({error:'version_conflict'},409);
 const old=JSON.parse(r.payload);if(old.connectionMode!=='google_oauth')return json({error:'invalid_input'},400);
 const secret=await db.prepare('SELECT encrypted_tokens FROM google_mail_tokens WHERE mailbox_id=? AND owner=?').bind(r.id,uid).first();
 const stamp=new Date().toISOString(),p={...old,enabled:'false',verifiedAt:'',connection:'disconnected',draftAccess:'false'},payload=JSON.stringify(p);
 const changed=await db.batch([
  db.prepare('UPDATE records SET payload=?,version=version+1,updated_at=? WHERE id=? AND owner=? AND version=?').bind(payload,stamp,r.id,uid,r.version),
  db.prepare('INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),uid,r.id,'google_disconnect',uid,r.payload,payload,stamp),
  db.prepare('DELETE FROM google_mail_tokens WHERE mailbox_id=? AND owner=? AND changes()=1').bind(r.id,uid)
 ]);
 if(!changed[0].meta.changes)return json({error:'version_conflict'},409);
 let revoked=false;try{if(secret){const tokens=await decrypt(secret.encrypted_tokens,uid+':'+r.id);const res=await googleFetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token})});revoked=res.ok}}catch{}
 return json({ok:true,revoked});
}
