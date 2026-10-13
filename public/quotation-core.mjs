export const currencies=['USD','VND','AUD','EUR','GBP'];
export const sellerKeys=['name','mark','address','contact','email','phone','website'];
export const customerKeys=['name','company','address','email','contact'];
export const termKeys=['incoterm','payment','leadTime','moq','samples','packing','exclusions','notes'];
export const itemKeys=['style','description','specification','colorSize','unit','quantity','price'];
export const adjustmentKeys=['discount','shipping','other','otherLabel','taxMode','taxRate'];
export const moneyDigits=currency=>currency==='VND'?0:2;
export const decimal=(s,places=4,max=10000000)=>typeof s==='string'&&new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(s)&&Number.isFinite(Number(s))&&Number(s)<=max;
function scaled(s,d){const [a,b='']=String(s||'0').split('.');return BigInt(a||'0')*BigInt(10**d)+BigInt((b+'0'.repeat(d)).slice(0,d)||'0');}
const round=(n,d)=>(n+d/BigInt(2))/d;
export function quotationTotals(p){
 const digits=moneyDigits(p.currency),scale=10**digits,a=p.adjustments||{};
 const lines=(p.items||[]).map(r=>decimal(r.quantity,3)&&decimal(r.price,4)?Number(round(scaled(r.quantity,3)*scaled(r.price,4)*BigInt(scale),BigInt(10000000))):null);
 const subtotal=lines.reduce((n,v)=>n+(v||0),0);
 const rate=v=>decimal(v,2,100)?scaled(v,2):BigInt(0),amount=v=>decimal(v,2)?Number(round(scaled(v,2)*BigInt(scale),BigInt(100))):0;
 const discount=Number(round(BigInt(subtotal)*rate(a.discount),BigInt(10000))),shipping=amount(a.shipping),other=amount(a.other),base=subtotal-discount+shipping+other;
 const tax=a.taxMode==='added'?Number(round(BigInt(base)*rate(a.taxRate),BigInt(10000))):0;
 return{digits,scale,lines,subtotal,discount,shipping,other,base,tax,total:base+tax,complete:lines.length>0&&lines.every(v=>v!==null)};
}
export function money(minor,currency,language='en'){return minor===null?'—':new Intl.NumberFormat(language==='vi'?'vi-VN':'en-US',{minimumFractionDigits:moneyDigits(currency),maximumFractionDigits:moneyDigits(currency)}).format(minor/(10**moneyDigits(currency)))+(currency?' '+currency:'');}
export function quoteReadyIssues(p){const issues=[];for(const k of ['number','revision','issueDate','validUntil','currency'])if(!p[k])issues.push(k);if(!p.seller?.name?.trim())issues.push('seller');if(!p.billTo?.name?.trim()&&!p.billTo?.company?.trim())issues.push('customer');if(!p.items?.length||p.items.some(i=>!i.description?.trim()||!i.unit?.trim()||!decimal(i.quantity,3)||Number(i.quantity)<=0||!decimal(i.price,4)))issues.push('items');if(p.adjustments?.taxMode==='added'&&!decimal(p.adjustments.taxRate,2,100))issues.push('taxRate');return issues;}
