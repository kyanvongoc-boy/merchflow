import { currencies,sellerKeys,customerKeys,termKeys,itemKeys,adjustmentKeys,decimal,quoteReadyIssues,quotationTotals } from '@/public/quotation-core.mjs';
export const quotationFields:Record<string,string[]>={
 quotation:['title','number','revision','issueDate','validUntil','buyerId','caseId','status','language','theme','currency','seller','billTo','items','adjustments','terms','intro','footer','preparedBy','internalNotes','sourceIds','templateName'],
 quotationTemplate:['name','language','theme','currency','seller','terms','intro','footer']
};
export const quoteStructured=new Set(['seller','billTo','items','adjustments','terms']);
export function validateQuotation(kind:string,p:any,fail:(code:string)=>never){
 if(!quotationFields[kind])return;
 const obj=(value:any,keys:string[],max=4000)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k))&&Object.values(value).every(v=>typeof v==='string'&&v.length<=max);
 const text=(k:string)=>{if(!p[k]?.trim())fail('required_'+k)};
 if(!['vi','en'].includes(p.language)||!['signature','minimal'].includes(p.theme))fail('invalid_template');
 if(p.currency&&!currencies.includes(p.currency))fail('invalid_currency');
 if(!obj(p.seller,sellerKeys,1200)||!obj(p.terms,termKeys))fail('invalid_quote_data');
 if(p.seller.mark&&p.seller.mark.trim().length>4)fail('invalid_quote_data');
 if(p.seller.email&&!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(p.seller.email))fail('invalid_email');
 if(p.seller.website){try{const u=new URL(p.seller.website);if(u.protocol!=='https:'||u.username||u.password)throw Error()}catch{fail('invalid_website')}}
 if((p.intro||'').length>2000||(p.footer||'').length>1200)fail('invalid_quote_data');
 if(kind==='quotationTemplate'){text('name');return;}
 text('title');text('number');text('revision');
 if(p.number.length>80||p.revision.length>40||/[\r\n]/.test(p.number+p.revision))fail('invalid_quote_data');
 if(!['draft','ready','archived'].includes(p.status))fail('invalid_status');
 if(!obj(p.billTo,customerKeys,2000)||!obj(p.adjustments,adjustmentKeys,500))fail('invalid_quote_data');
 if(p.billTo.email&&!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(p.billTo.email))fail('invalid_email');
 for(const k of ['issueDate','validUntil'])if(p[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(p[k])||Number.isNaN(Date.parse(p[k]))||new Date(p[k]).toISOString().slice(0,10)!==p[k]))fail('invalid_date');
 if(p.issueDate&&p.validUntil&&p.validUntil<p.issueDate)fail('quote_date_order');
 if(!Array.isArray(p.items)||p.items.length>100||p.items.some((r:any)=>!obj(r,itemKeys,2000)))fail('invalid_quote_items');
 for(const row of p.items){for(const [k,d,max]of [['quantity',3,10000000],['price',4,1000000]] as const)if(row[k]!==''&&row[k]!==undefined&&!decimal(row[k],d,max))fail('invalid_quote_number');}
 for(const [k,max]of [['discount',100],['taxRate',100],['shipping',10000000],['other',10000000]] as const)if(p.adjustments[k]&&!decimal(p.adjustments[k],2,max))fail('invalid_quote_number');
 if(!['excluded','added'].includes(p.adjustments.taxMode))fail('invalid_quote_data');
 if(p.currency==='VND'&&['shipping','other'].some(k=>p.adjustments[k]&&Number(p.adjustments[k])%1!==0))fail('invalid_quote_number');
 if(p.status==='ready'&&quoteReadyIssues(p).length)fail('quote_incomplete');
 if(!Number.isSafeInteger(quotationTotals(p).total)||quotationTotals(p).total>900000000000000)fail('quote_too_large');
}
export async function validateQuotationLinks(db:any,uid:string,id:string,p:any,fail:(c:string)=>never){
 const rows=await db.prepare("SELECT id,payload FROM records WHERE owner=? AND kind='quotation'").bind(uid).all();
 if(rows.results.some((r:any)=>{const q=JSON.parse(r.payload);return r.id!==id&&q.number.trim().toLowerCase()===p.number.trim().toLowerCase()&&q.revision.trim().toLowerCase()===p.revision.trim().toLowerCase()}))fail('quote_exists');
}
