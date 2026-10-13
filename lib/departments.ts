export const departmentFields:Record<string,string[]>={
 departmentSource:['name','department','folderUrl','ownerEmail','scope','notes','status'],
 departmentItem:['title','department','connectionId','sourceUrl','buyerId','caseId','style','po','category','revision','status','ownerEmail','due','values','notes','sourceIds','reviewer','reviewNote','supersedesId']
};
const departments=['purchasing','designer','production','quality','logistics','other'];
export function driveReference(value:string,folder=false):string|null{
 try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  if(folder){const m=u.hostname==='drive.google.com'&&u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/);return m?'folder:'+m[1]:null;}
  if(u.hostname==='drive.google.com'){const m=u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|edit|preview))?\/?$/);if(m)return 'file:'+m[1];if(u.pathname==='/open'&&/^[A-Za-z0-9_-]+$/.test(u.searchParams.get('id')||''))return 'file:'+u.searchParams.get('id');}
  if(u.hostname==='docs.google.com'){const m=u.pathname.match(/^\/(?:spreadsheets|document|presentation|drawings)\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|copy))?\/?$/);if(m)return 'file:'+m[1];}
  return null;
 }catch{return null}
}
export function validateDepartment(kind:string,p:any,fail:(s:string)=>never){
 if(!departmentFields[kind])return;
 if(!departments.includes(p.department))fail('invalid_department');
 if(kind==='departmentSource'){
  if(!p.name?.trim())fail('required_name');
  if(!['active','paused'].includes(p.status))fail('invalid_status');
  if(p.folderUrl&&!driveReference(p.folderUrl,true))fail('invalid_drive_url');
 }else{
  if(!p.title?.trim())fail('required_title');
  if(!p.category?.trim())fail('required_category');
  if(!p.revision?.trim())fail('required_revision');
  if(!['draft','review','approved','obsolete'].includes(p.status))fail('invalid_status');
  if(p.sourceUrl&&!driveReference(p.sourceUrl))fail('invalid_drive_file');
  if(!p.values||typeof p.values!=='object'||Array.isArray(p.values)||Object.keys(p.values).length>30||Object.entries(p.values).some(([k,v])=>k.length>80||typeof v!=='string'||v.length>12000))fail('invalid_input');
  if(p.status==='approved'){
   if(!p.reviewer?.trim()||!p.reviewNote?.trim())fail('review_required');
   if(!p.sourceUrl&&!p.sourceIds?.length)fail('evidence_required');
  }
 }
}
export async function validateDepartmentLinks(db:any,uid:string,kind:string,id:string,p:any,old:any,fail:(s:string)=>never){
 if(!departmentFields[kind])return;
 if(kind==='departmentSource'){
  if(old&&old.department!==p.department){const used=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='departmentItem' AND json_extract(payload,'$.connectionId')=? LIMIT 1").bind(uid,id).first();if(used)fail('department_in_use');}
  return;
 }
 if(p.connectionId){const r=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='departmentSource'").bind(p.connectionId,uid).first();if(!r)fail('parent_missing');const src=JSON.parse(r.payload);if(src.department!==p.department)fail('department_mismatch');if(src.status==='paused'&&old?.connectionId!==p.connectionId)fail('source_paused');}
 if(p.supersedesId){const r=await db.prepare("SELECT payload FROM records WHERE id=? AND owner=? AND kind='departmentItem'").bind(p.supersedesId,uid).first();if(!r||p.supersedesId===id)fail('parent_missing');const prior=JSON.parse(r.payload);if(prior.department!==p.department||prior.caseId!==p.caseId||prior.buyerId!==p.buyerId)fail('revision_scope');if(prior.revision.trim().toLowerCase()===p.revision.trim().toLowerCase())fail('duplicate_revision');}
 if(p.buyerId&&p.caseId){const a=await db.prepare('SELECT payload FROM records WHERE id=? AND owner=?').bind(p.buyerId,uid).first(),b=await db.prepare('SELECT payload FROM records WHERE id=? AND owner=?').bind(p.caseId,uid).first();const email=JSON.parse(b.payload).buyerEmail;if(email&&email.trim().toLowerCase()!==JSON.parse(a.payload).email.trim().toLowerCase())fail('buyer_case_mismatch');}
 if(old?.status==='approved'||(old?.status==='obsolete'&&old?.reviewer)){
  const before={...old,status:'approved'},after={...p,status:'approved'};
  if((old.status==='obsolete'?p.status!=='obsolete':!['approved','obsolete'].includes(p.status))||JSON.stringify(before)!==JSON.stringify(after))fail('approved_locked');
 }
 if(p.sourceUrl){const key=driveReference(p.sourceUrl);const rows=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='departmentItem'").bind(uid).all();
  if(rows.results.some((r:any)=>{const x=JSON.parse(r.payload);return r.id!==id&&x.department===p.department&&(x.caseId||'')===(p.caseId||'')&&(x.buyerId||'')===(p.buyerId||'')&&x.revision.trim().toLowerCase()===p.revision.trim().toLowerCase()&&driveReference(x.sourceUrl)===key}))fail('duplicate_revision');
 }
}
