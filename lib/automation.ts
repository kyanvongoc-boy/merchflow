// App identity and unattended service access are authenticated by the Sites gateway.
// Standalone hosting must provide an equivalent trusted boundary before these routes.
export const legacyAutomationId='merchflow-automation-config';

export async function personalAutomationId(owner:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
 return 'automation_'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}

export async function automationForOwner(db:any,owner:string){
 const legacy=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='automation'").bind(legacyAutomationId,owner).first();
 if(legacy)return legacy;
 return db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='automation'").bind(await personalAutomationId(owner),owner).first();
}

export async function automationSaveId(db:any,owner:string){
 return (await automationForOwner(db,owner))?.id||await personalAutomationId(owner);
}

export async function resolveAutomation(req:Request,db:any){
 const owner=req.headers.get('oai-authenticated-user-id');
 const selector=new URL(req.url).searchParams.get('automationId');
 if(selector){
  if(!/^(?:merchflow-automation-config|automation_[a-f0-9]{32})$/.test(selector))return null;
  // A signed-in visitor never selects another employee's automation. Service
  // calls may select an explicit config only after the host's service gate.
  return owner?db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='automation'").bind(selector,owner).first():db.prepare("SELECT * FROM records WHERE id=? AND kind='automation'").bind(selector).first();
 }
 if(owner)return automationForOwner(db,owner);
 // Preserve the already provisioned legacy 08:00 service job.
 return db.prepare("SELECT * FROM records WHERE id=? AND kind='automation'").bind(legacyAutomationId).first();
}

export const reservedRecordId=(id:string)=>/^(?:automation_|digest_|taskrun_|task_mail_|mail_|buyer_|request_|compose_|file_|gmaildraft_|google_)/.test(id)||id===legacyAutomationId;

export async function assertGeneratedRecords(db:any,owner:string,records:Array<{id:string,kind:string}>){
 const seen=new Map<string,string>();
 for(const {id,kind} of records){
  if(seen.has(id)&&seen.get(id)!==kind)throw new Error('generated_id_conflict');
  if(seen.has(id))continue;
  seen.set(id,kind);
  const old=await db.prepare('SELECT owner,kind FROM records WHERE id=?').bind(id).first();
  if(old&&(old.owner!==owner||old.kind!==kind))throw new Error('generated_id_conflict');
 }
}

// Build one atomic D1 batch section. Read the actual previous payload inside the
// transaction, merge IDs in SQL, then audit the actual result. Overlapping daily
// runs cannot drop each other's request/task IDs or invent a stale before state.
export function summaryStatements(db:any,owner:string,id:string,kind:'digest'|'taskRun',payload:any,actor:string,stamp:string){
 const auditId=crypto.randomUUID(),field=kind==='digest'?'requestIds':'taskIds';
 const base=kind==='taskRun'?"CASE WHEN COALESCE(julianday(json_extract(excluded.payload,'$.to')),0)>=COALESCE(julianday(json_extract(records.payload,'$.to')),0) THEN excluded.payload ELSE records.payload END":'excluded.payload';
 return [
  db.prepare("INSERT INTO audit(id,owner,record_id,action,actor,before_json,after_json,at) SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND kind=?) THEN 'update' ELSE 'create' END,?,COALESCE((SELECT payload FROM records WHERE id=? AND owner=? AND kind=?),'{}'),'{}',? WHERE NOT EXISTS(SELECT 1 FROM records WHERE id=? AND (owner<>? OR kind<>?))").bind(auditId,owner,id,id,owner,kind,actor,id,owner,kind,stamp,id,owner,kind),
  db.prepare(`INSERT INTO records(id,owner,kind,payload,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=json_set(${base},'$.${field}',json((SELECT json_group_array(value) FROM (SELECT value FROM json_each(records.payload,'$.${field}') UNION SELECT value FROM json_each(excluded.payload,'$.${field}'))))),version=records.version+1,updated_at=excluded.updated_at WHERE records.owner=excluded.owner AND records.kind=excluded.kind`).bind(id,owner,kind,JSON.stringify(payload),stamp,stamp),
  db.prepare('UPDATE audit SET after_json=(SELECT payload FROM records WHERE id=? AND owner=? AND kind=?) WHERE id=? AND owner=? AND changes()=1').bind(id,owner,kind,auditId,owner)
 ];
}
