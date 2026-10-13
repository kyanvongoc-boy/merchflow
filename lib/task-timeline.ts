import { taskChanges,eventType } from '@/public/task-timeline-core.mjs';
export async function readTaskTimeline(req:Request,db:any,uid:string){
 const params=new URL(req.url).searchParams,taskId=params.get('taskId')||'';
 if(taskId&&!/^[A-Za-z0-9_-]{8,80}$/.test(taskId))return Response.json({error:'invalid_id'},{status:400});
 let cursor:any=null;
 if(params.get('cursor')){try{cursor=JSON.parse(params.get('cursor')!);if(!cursor||typeof cursor.at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(cursor.at)||!Number.isFinite(Date.parse(cursor.at))||typeof cursor.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(cursor.id))throw Error()}catch{return Response.json({error:'invalid_cursor'},{status:400})}}
 const tasks=await db.prepare("SELECT * FROM records WHERE owner=? AND kind='task' ORDER BY updated_at DESC,id DESC").bind(uid).all();
 if(taskId&&!tasks.results.some((r:any)=>r.id===taskId))return Response.json({error:'not_found'},{status:404});
 const bindings:any[]=[uid,uid],clauses=["a.owner=?","r.owner=?","r.kind='task'"];
 if(taskId){clauses.push('a.record_id=?');bindings.push(taskId)}
 if(cursor){clauses.push('(a.at<? OR (a.at=? AND a.id<?))');bindings.push(cursor.at,cursor.at,cursor.id)}
 const rows=await db.prepare('SELECT a.* FROM audit a JOIN records r ON r.id=a.record_id WHERE '+clauses.join(' AND ')+' ORDER BY a.at DESC,a.id DESC LIMIT 61').bind(...bindings).all();
 const parse=(v:string)=>{try{return JSON.parse(v||'{}')}catch{return{}}};
 const short=(v:any)=>{const s=Array.isArray(v)?v.join('\n'):String(v??'');return s.length>1500?s.slice(0,1500)+'…':s};
 const events=rows.results.slice(0,60).map((r:any)=>{const before=parse(r.before_json),after=parse(r.after_json);return{id:r.id,taskId:r.record_id,at:r.at,actor:r.actor,title:after.title||before.title||'',type:eventType(before,after,r.action),changes:taskChanges(before,after).map((c:any)=>({...c,before:short(c.before),after:short(c.after)}))}});
 const last=events[events.length-1];return Response.json({tasks:tasks.results.map((r:any)=>({...r,payload:parse(r.payload)})),events,nextCursor:rows.results.length>60&&last?{at:last.at,id:last.id}:null,syncedAt:new Date().toISOString()},{headers:{'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
}
