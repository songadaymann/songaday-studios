// Prices and artwork are selected on the server. The browser never supplies money or URLs.
import catalog from './store/catalog.json' with {type:'json'};
import config from './store/variants.json' with {type:'json'};
import {stripe} from './commission-stripe.mjs';
import {accessIdentity} from './commission-admin.mjs';
import {escapeHtml} from './fumble-page.mjs';
const TOKEN=/^[a-f0-9]{32}$/;
const now=()=>Math.floor(Date.now()/1000);
const id=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const stripeKey=env=>env.STORE_STRIPE_SECRET_KEY||env.STRIPE_SECRET_KEY;
const storeStripe=(env,...args)=>stripe({...env,STRIPE_SECRET_KEY:stripeKey(env)},...args);
export const storeReady=env=>env.STORE_OPEN==='yes'&&!!env.GELATO_API_KEY&&!!stripeKey(env)&&!!env.STRIPE_WEBHOOK_SECRET&&!!env.COMMISSIONS_DB;
export function product(figure,variant){
 const f=catalog.find(f=>f.id===figure),v=config.variants.find(v=>v.id===variant);
 if(!f||!v||!Number.isInteger(v.priceCents)||v.priceCents<=0)throw Error('invalid_product');
 return {...v,figure:f.id,name:f.name,image:f.image,pdf:`${v.artworkPrefix}/${String(f.id).padStart(3,'0')}.pdf`};
}
export function recipient(input){
 const value={};
 for(const [key,max] of Object.entries({firstName:50,lastName:50,addressLine1:100,addressLine2:100,city:60,state:2,postCode:10,email:254,phone:30})){
  const s=String(input?.[key]??'').trim();if(s.length>max||/[\x00-\x1f\x7f]/.test(s))throw Error('invalid_address');value[key]=s;
 }
 value.state=value.state.toUpperCase();value.country='US';
 if(!value.firstName||!value.lastName||!value.addressLine1||!value.city||!/^\d{5}(?:-\d{4})?$/.test(value.postCode)||!US_STATES.has(value.state)||!/^\S+@\S+\.\S+$/.test(value.email)||value.phone.replace(/\D/g,'').length<10||input?.country!=='US')throw Error('invalid_address');
 return value;
}
const US_STATES=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
async function body(request){
 const reader=request.body?.getReader();if(!reader)throw Error('invalid_request');let length=0;const chunks=[];
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>16384){await reader.cancel();throw Error('invalid_request');}chunks.push(r.value);}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function gelato(env,path,payload){
 const r=await fetch('https://order.gelatoapis.com/v4/'+path,{method:payload?'POST':'GET',headers:{'X-API-KEY':env.GELATO_API_KEY,'User-Agent':'SongADayStore/1.0','Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(20000)});
 if(!r.ok){const e=Error('gelato_error');e.status=r.status;throw e;}return r.json();
}
export async function quoteOrder(env,p,address,orderId){
 const d=await gelato(env,'orders:quote',{orderReferenceId:'studio-'+orderId,customerReferenceId:'studio-store',currency:'USD',allowMultipleQuotes:false,recipient:address,products:[{itemReferenceId:'poster',productUid:p.productUid,quantity:1}]});
 if(d.errors?.length||d.quotes?.length!==1)throw Error('unavailable');
 const q=d.quotes[0];const methods=q.shipmentMethods?.filter(s=>s.currency==='USD'&&s.isPrivate!==false&&Number.isFinite(s.price)&&s.price>=0).sort((a,b)=>a.price-b.price);
 const method=methods?.[0];if(!method||!q.products?.some(x=>x.itemReferenceId==='poster'&&x.currency==='USD'))throw Error('unavailable');
 const surcharge=q.carrierSurcharge?.price??0;if(!Number.isFinite(surcharge)||surcharge<0)throw Error('unavailable');
 return {shipping:Math.ceil((method.price+surcharge)*100-1e-7),method:method.shipmentMethodUid,methodName:method.name,minDays:method.minDeliveryDays,maxDays:method.maxDeliveryDays};
}
const load=(env,token)=>env.COMMISSIONS_DB.prepare('SELECT * FROM store_orders WHERE id=?').bind(token).first();
const addressOf=r=>({line1:r.addressLine1,line2:r.addressLine2,city:r.city,state:r.state,postal_code:r.postCode,country:r.country});
export function checkoutParams(env,row,p,customer){
 const r=JSON.parse(row.recipient_json);
 return {mode:'payment',customer,client_reference_id:row.id,payment_method_types:['card'],automatic_tax:{enabled:true},billing_address_collection:'required',
  line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:row.price_cents,tax_behavior:'exclusive',product_data:{tax_code:'txcd_99999999',name:`MUSCLE #${String(p.figure).padStart(3,'0')} ${p.name}`,description:`${p.size.replace('x',' × ')} inches · ${p.frame==='none'?'Unframed':p.frame+' wooden frame, ready to hang'}`,images:[p.image]}}}],
  shipping_options:[{shipping_rate_data:{display_name:'Shipping',type:'fixed_amount',fixed_amount:{amount:row.shipping_cents,currency:'usd'},tax_behavior:'exclusive'}}],
  payment_intent_data:{receipt_email:r.email,shipping:{name:r.firstName+' '+r.lastName,phone:r.phone,address:addressOf(r)},metadata:{store_order_id:row.id}},metadata:{store_order_id:row.id},
  custom_text:{submit:{message:`Ships to ${r.firstName} ${r.lastName}, ${r.addressLine1}, ${r.city}, ${r.state} ${r.postCode}. Return to the store to change the shipping address.`}},
  success_url:`${env.SITE_ORIGIN}/store/muscle/?order=${row.id}`,cancel_url:`${env.SITE_ORIGIN}/store/muscle/?figure=${p.figure}&size=${p.size}&frame=${p.frame}`,
  expires_at:row.expires_at};
}
export async function createStoreCheckout(env,row){
 if(row.status==='checkout'&&row.checkout_url&&row.expires_at>now())return row.checkout_url;
 if(!['quoted','checkout_creating'].includes(row.status)||row.expires_at<now()+1800)throw Error('quote_expired');
 const p=JSON.parse(row.product_json),r=JSON.parse(row.recipient_json);
 await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='checkout_creating',updated_at=? WHERE id=? AND status IN ('quoted','checkout_creating')").bind(now(),row.id).run();
 // Idempotency keys cover simultaneous clicks, retries and a lost Stripe response.
 const customer=await storeStripe(env,'POST','/customers',{name:r.firstName+' '+r.lastName,email:r.email,phone:r.phone,address:addressOf(r),shipping:{name:r.firstName+' '+r.lastName,phone:r.phone,address:addressOf(r)},metadata:{store_order_id:row.id}},'store-customer-'+row.id).catch(error=>{error.code='customers.'+(error.code??'error');throw error;});
 const session=await storeStripe(env,'POST','/checkout/sessions',checkoutParams(env,row,p,customer.id),'store-checkout-'+row.id).catch(error=>{error.code='checkout.'+(error.code??'error');throw error;});
 if(!session.id||!session.url?.startsWith('https://checkout.stripe.com/'))throw Error('checkout_unavailable');
 await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='checkout',session_id=?,checkout_url=?,stripe_customer=?,expires_at=?,updated_at=? WHERE id=? AND status='checkout_creating'").bind(session.id,session.url,customer.id,session.expires_at,now(),row.id).run();
 return session.url;
}
export async function settleStoreCheckout(env,session){
 const token=session?.metadata?.store_order_id;if(!TOKEN.test(token??''))return 'ignored';
 const row=await load(env,token);if(!row)return 'ignored';
 if(session.id!==row.session_id||session.client_reference_id!==row.id||session.mode!=='payment'||session.currency!=='usd'||session.payment_status!=='paid')return 'ignored';
 // A test session can never start a real production order.
 const expectedLive=/^(?:sk|rk)_live_/.test(stripeKey(env)??'');
 if(!expectedLive||session.livemode!==true)return 'ignored';
 const tax=session.total_details?.amount_tax;
 if(session.amount_subtotal!==row.price_cents||session.total_details?.amount_shipping!==row.shipping_cents||session.total_details?.amount_discount!==0||!Number.isInteger(tax)||tax<0||session.amount_total!==row.price_cents+row.shipping_cents+tax||session.automatic_tax?.status!=='complete')throw Error('payment_mismatch');
 const changed=await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='paid',payment_intent=?,paid_total_cents=?,updated_at=? WHERE id=? AND status='checkout'").bind(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id,session.amount_total,now(),token).run();
 if(changed.meta.changes)await fulfillStoreOrder(env,token);
 return 'store_paid';
}
function tracking(order){return (order.shipment?.packages??[]).filter(p=>/^https:\/\//.test(p.trackingUrl??'')).map(p=>({code:String(p.trackingCode??''),url:p.trackingUrl}));}
async function saveGelato(env,row,order){
 if(order.orderReferenceId!=='studio-'+row.id||order.orderType!=='order')throw Error('gelato_mismatch');
 await env.COMMISSIONS_DB.prepare('UPDATE store_orders SET gelato_id=?,status=?,tracking_json=?,error_code=NULL,updated_at=? WHERE id=?').bind(order.id,order.fulfillmentStatus||'confirmed',JSON.stringify(tracking(order)),now(),row.id).run();
}
export async function fulfillStoreOrder(env,token){
 const row=await load(env,token);if(!row||!['paid','submitting','ambiguous'].includes(row.status))return;
 // Reconcile uncertain requests, but never POST them again automatically.
 if(row.status!=='paid'){
  const matches=await gelato(env,'orders:search',{orderReferenceId:'studio-'+row.id,limit:100});
  const orders=matches.orders?.filter(o=>o.orderReferenceId==='studio-'+row.id&&o.orderType==='order')??[];
  if(orders.length===1)await saveGelato(env,row,await gelato(env,'orders/'+orders[0].id));
  else if(orders.length>1)await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='manual_review',error_code='duplicate_reference',updated_at=? WHERE id=?").bind(now(),token).run();
  return;
 }
 const claim=await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='submitting',updated_at=? WHERE id=? AND status='paid'").bind(now(),token).run();if(!claim.meta.changes)return;
 const p=JSON.parse(row.product_json);
 let submitted=false;
 try{
  const pi=await storeStripe(env,'GET',`/payment_intents/${encodeURIComponent(row.payment_intent)}?expand[]=latest_charge`);
  if(pi.status!=='succeeded'||pi.currency!=='usd'||pi.amount_received!==row.paid_total_cents||!pi.latest_charge||typeof pi.latest_charge!=='object'||pi.latest_charge.refunded!==false||pi.latest_charge.amount_refunded!==0){
   await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET status='manual_review',error_code='payment_review',updated_at=? WHERE id=?").bind(now(),token).run();return;
  }
  submitted=true;
  const order=await gelato(env,'orders',{orderType:'order',orderReferenceId:'studio-'+row.id,customerReferenceId:'studio-store',currency:'USD',shipmentMethodUid:row.shipping_method,shippingAddress:JSON.parse(row.recipient_json),items:[{itemReferenceId:'poster',productUid:p.productUid,quantity:1,files:[{type:'default',url:p.pdf}]}],metadata:[{key:'source',value:'songaday.studio/store'}]});
  await saveGelato(env,row,order);
 }catch(error){
  // Even a timeout may have created an order. Only a rejected 429 can safely retry.
  await env.COMMISSIONS_DB.prepare('UPDATE store_orders SET status=?,error_code=?,updated_at=? WHERE id=? AND status=?').bind(!submitted||error.status===429?'paid':'ambiguous',error.status?'provider_'+error.status:'uncertain_submission',now(),token,'submitting').run();
 }
}
export async function runStoreOrders(env){
 if(!env.COMMISSIONS_DB||!env.GELATO_API_KEY)return;
 const {results}=await env.COMMISSIONS_DB.prepare("SELECT id,gelato_id FROM store_orders WHERE status IN ('paid','submitting','ambiguous','created','passed','pending_approval','printed','produced','shipped','in_production','confirmed') ORDER BY updated_at LIMIT 30").all();
 for(const row of results){try{if(row.gelato_id)await saveGelato(env,{...row},await gelato(env,'orders/'+row.gelato_id));else await fulfillStoreOrder(env,row.id);}catch{console.log('store reconcile pending',row.id);}}
 // Expired, unpaid quotes retain no customer address. Paid order records remain private.
 await env.COMMISSIONS_DB.prepare("UPDATE store_orders SET recipient_json='{}',status='expired',checkout_url=NULL,updated_at=? WHERE status='quoted' AND expires_at<?").bind(now(),now()-86400).run();
}
export async function handleStore(request,env,url){
 const path=url.pathname;
 if(path==='/store/config')return reply({checkoutEnabled:storeReady(env)});
 const admin=path==='/commission/admin/store';
 if(admin){
  if(!await accessIdentity(request,env,url))return new Response('Unauthorized',{status:401});
  const {results}=await env.COMMISSIONS_DB.prepare('SELECT id,figure,variant,status,gelato_id,paid_total_cents,error_code,created_at FROM store_orders ORDER BY created_at DESC LIMIT 100').all();
  return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Store orders</title><h1>Store orders</h1><p><a href="/commission/admin">Commissions</a></p><table><tr><th>Order</th><th>Figure</th><th>Variant</th><th>Status</th><th>Gelato</th></tr>'+results.map(r=>`<tr><td>${escapeHtml(r.id.slice(0,8))}</td><td>${r.figure}</td><td>${escapeHtml(r.variant)}</td><td>${escapeHtml(r.status+' '+(r.error_code??''))}</td><td>${r.gelato_id?`<a href="https://dashboard.gelato.com/orders/${encodeURIComponent(r.gelato_id)}">Open order</a>`:''}</td></tr>`).join('')+'</table>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
 }
 const match=/^\/store\/order\/([a-f0-9]{32})$/.exec(path);
 if(match&&request.method==='GET'){
  const row=await load(env,match[1]);if(!row)return reply({error:'Order not found.'},404);
  return reply({figure:row.figure,variant:row.variant,status:row.status,paid:!!row.payment_intent,tracking:JSON.parse(row.tracking_json)});
 }
 if(!['/store/quote','/store/checkout'].includes(path))return null;
 if(request.method!=='POST')return reply({error:'Use POST.'},405);
 if(request.headers.get('Origin')!==url.origin||url.origin!==env.SITE_ORIGIN)return reply({error:'Please reload the store.'},403);
 if(!storeReady(env))return reply({error:'Purchasing opens soon.'},503);
 if(env.STORE_LIMIT&&!((await env.STORE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success))return reply({error:'Please wait a minute and try again.'},429);
 let requestToken=null;
 try{
  const data=await body(request);
  requestToken=data.token;
  if(path==='/store/quote'){
   const p=product(data.figure,data.variant),r=recipient(data.recipient),token=id();
   const q=await quoteOrder(env,p,r,token);
   await env.COMMISSIONS_DB.prepare('INSERT INTO store_orders(id,figure,variant,price_cents,shipping_cents,recipient_json,shipping_method,expires_at,created_at,updated_at,product_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(token,p.figure,p.id,p.priceCents,q.shipping,JSON.stringify(r),q.method,now()+2700,now(),now(),JSON.stringify(p)).run();
   return reply({token,priceCents:p.priceCents,shippingCents:q.shipping,shippingName:q.methodName,minDays:q.minDays,maxDays:q.maxDays});
  }
  if(!TOKEN.test(data.token??''))throw Error('quote_expired');
  const row=await load(env,data.token);if(!row)throw Error('quote_expired');
  return reply({url:await createStoreCheckout(env,row)});
 }catch(error){
  console.log('store request failed',path,error?.status??error?.name??'error',error?.code??'');
  if(path==='/store/checkout'&&TOKEN.test(requestToken??''))await env.COMMISSIONS_DB.prepare('UPDATE store_orders SET error_code=? WHERE id=?').bind(String(error?.code??error?.name??'checkout_error').slice(0,80),requestToken).run();
  const messages={invalid_product:'Please choose a figure and available size/frame.',invalid_address:'Check your US shipping address, email and phone number.',quote_expired:'Your quote expired. Please get a new shipping quote.',unavailable:'That option cannot ship to this address right now.'};
  return reply({error:messages[error.message]??'Unable to prepare checkout right now. Please try again.'},error.message in messages?400:502);
 }
}
