import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {fakeD1} from './fake-cloudflare.mjs';
import {handleStore,product,createStoreCheckout,settleStoreCheckout,fulfillStoreOrder,runStoreOrders} from '../store.mjs';
import {handleStripeWebhook} from '../commission-stripe.mjs';
const sql=(await Promise.all(['0001_commissions.sql','0002_store.sql','0003_store_snapshot.sql'].map(f=>readFile(new URL('../commission-migrations/'+f,import.meta.url),'utf8')))).join('\n');
const address={firstName:'Sample',lastName:'Buyer',addressLine1:'451 Clarkson Ave',addressLine2:'',city:'Brooklyn',state:'NY',postCode:'11203',country:'US',email:'sample@example.com',phone:'2125550100'};
function setup(){
 const db=fakeD1(sql),env={COMMISSIONS_DB:db,SITE_ORIGIN:'https://songaday.studio',STORE_OPEN:'yes',GELATO_API_KEY:'fixture',STRIPE_SECRET_KEY:'rk_'+'live_fixture',STRIPE_WEBHOOK_SECRET:'fixture'};
 const calls=[],created=new Map();let behavior='normal';
 const fetch=async (url,options={})=>{
  calls.push({url:String(url),...options});const u=new URL(url),data=options.body?u.hostname==='api.stripe.com'?new URLSearchParams(options.body):JSON.parse(options.body):null;
  let result;
  if(u.pathname==='/v1/customers')result={id:'cus_fixture'};
  else if(u.pathname==='/v1/checkout/sessions')result={id:'cs_live_fixture',url:'https://checkout.stripe.com/c/pay/cs_live_fixture',expires_at:Number(data.get('expires_at'))};
  else if(u.pathname.startsWith('/v1/payment_intents/'))result={status:'succeeded',currency:'usd',amount_received:3472,latest_charge:{refunded:behavior==='refunded',amount_refunded:behavior==='refunded'?3472:0}};
  else if(u.pathname.endsWith('orders:quote'))result={errors:[],quotes:[{products:[{itemReferenceId:'poster',currency:'USD'}],shipmentMethods:[{shipmentMethodUid:'ground',name:'Ground',price:4.9,currency:'USD',isPrivate:true,minDeliveryDays:6,maxDeliveryDays:8}],carrierSurcharge:{price:.4}}]};
  else if(u.pathname.endsWith('orders:search'))result={orders:[...created.values()].filter(o=>o.orderReferenceId===data.orderReferenceId)};
  else if(u.pathname==='/v4/orders'){
   result={id:'gelato_fixture',orderReferenceId:data.orderReferenceId,orderType:'order',fulfillmentStatus:'created'};created.set(result.id,result);if(behavior==='timeout')throw Error('timeout');
  }else if(u.pathname==='/v4/orders/gelato_fixture')result=created.get('gelato_fixture');
  else throw Error('Unexpected fetch '+url);
  return Response.json(result);
 };
 return {db,env,calls,fetch,created,setBehavior:b=>behavior=b};
}
async function quote(s,extra={}){
 const req=new Request('https://songaday.studio/store/quote',{method:'POST',headers:{Origin:'https://songaday.studio','Content-Type':'application/json'},body:JSON.stringify({figure:15,variant:'12x16-unframed',recipient:address,...extra})});
 const response=await handleStore(req,s.env,new URL(req.url));assert.equal(response.status,200);return response.json();
}
async function ready(s){const q=await quote(s);await createStoreCheckout(s.env,await s.db.prepare('SELECT * FROM store_orders WHERE id=?').bind(q.token).first());return q;}
const paid=token=>({id:'cs_live_fixture',metadata:{store_order_id:token},client_reference_id:token,mode:'payment',currency:'usd',payment_status:'paid',livemode:true,amount_subtotal:2900,amount_total:3472,total_details:{amount_shipping:530,amount_discount:0,amount_tax:42},automatic_tax:{status:'complete'},payment_intent:'pi_fixture'});
async function withSetup(fn){const s=setup(),previous=globalThis.fetch;globalThis.fetch=s.fetch;try{await fn(s);}finally{globalThis.fetch=previous;s.db.sqlite.close();}}
test('server selects all approved prices, rejects unavailable frames and invalid figures',()=>{
 assert.equal(product(15,'12x16-black').priceCents,6900);assert.equal(product(236,'18x24-white').priceCents,9900);assert.equal(product(15,'30x40-unframed').priceCents,5900);
 assert.throws(()=>product(15,'30x40-black'));assert.throws(()=>product(0,'12x16-unframed'));
});
test('quote ignores client prices and artwork, includes surcharge and stores fixed product snapshot',()=>withSetup(async s=>{
 const q=await quote(s,{priceCents:1,pdf:'https://attacker.invalid/art.pdf'});assert.equal(q.priceCents,2900);assert.equal(q.shippingCents,530);
 const row=s.db.rows('store_orders')[0];assert.match(JSON.parse(row.product_json).pdf,/\/12x16\/015.pdf$/);assert.equal(row.price_cents,2900);
 const req=new Request('https://songaday.studio/store/quote',{method:'POST',headers:{Origin:'https://evil.invalid'},body:'{}'});assert.equal((await handleStore(req,s.env,new URL(req.url))).status,403);
}));
test('checkout retries use stable parameters and idempotency keys, with shipping fixed before payment',()=>withSetup(async s=>{
 const q=await quote(s);const row=s.db.rows('store_orders')[0];await Promise.all([createStoreCheckout(s.env,row),createStoreCheckout(s.env,row)]);
 const requests=s.calls.filter(c=>new URL(c.url).pathname==='/v1/checkout/sessions');assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
 const form=new URLSearchParams(requests[0].body);assert.equal(form.get('line_items[0][price_data][unit_amount]'),'2900');assert.equal(form.get('shipping_address_collection[allowed_countries][0]'),null);assert.equal(form.get('automatic_tax[enabled]'),'true');
 const before=s.calls.length;await createStoreCheckout(s.env,s.db.rows('store_orders')[0]);assert.equal(s.calls.length,before);assert.ok(q.token);
}));
test('duplicate signed paid events submit only one correctly configured Gelato order',()=>withSetup(async s=>{
 const q=await ready(s),event={id:'evt_fixture',type:'checkout.session.completed',data:{object:paid(q.token)}};
 const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000),sig=createHmac('sha256','fixture').update(t+'.'+raw).digest('hex');
 const send=()=>handleStripeWebhook(new Request('https://songaday.studio/commission/stripe',{method:'POST',headers:{'Stripe-Signature':`t=${t},v1=${sig}`},body:raw}),s.env);
 const responses=await Promise.all([send(),send(),send()]);assert.ok(responses.every(r=>r.status===200));
 const creates=s.calls.filter(c=>new URL(c.url).pathname==='/v4/orders');assert.equal(creates.length,1);const payload=JSON.parse(creates[0].body);assert.equal(payload.orderType,'order');assert.equal(payload.shipmentMethodUid,'ground');assert.match(payload.items[0].files[0].url,/\/12x16\/015.pdf$/);assert.equal(s.db.rows('store_orders')[0].gelato_id,'gelato_fixture');
}));
test('unpaid, foreign-session and test payments never submit production orders',()=>withSetup(async s=>{
 const q=await ready(s);
 for(const change of [{payment_status:'unpaid'},{id:'cs_live_other'},{livemode:false},{currency:'eur'}])assert.equal(await settleStoreCheckout(s.env,{...paid(q.token),...change}),'ignored');
 s.env.STRIPE_SECRET_KEY='rk_'+'test_fixture';assert.equal(await settleStoreCheckout(s.env,{...paid(q.token),livemode:false}),'ignored');assert.equal(s.created.size,0);
}));
test('amount mismatch and invalid webhook signature never authorize printing',()=>withSetup(async s=>{
 const q=await ready(s);await assert.rejects(()=>settleStoreCheckout(s.env,{...paid(q.token),amount_total:1}));
 const r=await handleStripeWebhook(new Request('https://songaday.studio/commission/stripe',{method:'POST',headers:{'Stripe-Signature':'invalid'},body:JSON.stringify({data:{object:paid(q.token)}})}),s.env);assert.equal(r.status,400);assert.equal(s.created.size,0);
}));
test('ambiguous POST is reconciled by reference without ever posting twice',()=>withSetup(async s=>{
 const q=await ready(s);s.setBehavior('timeout');await settleStoreCheckout(s.env,paid(q.token));assert.equal(s.db.rows('store_orders')[0].status,'ambiguous');await fulfillStoreOrder(s.env,q.token);assert.equal(s.db.rows('store_orders')[0].gelato_id,'gelato_fixture');assert.equal(s.calls.filter(c=>new URL(c.url).pathname==='/v4/orders').length,1);
}));
test('an uncertain submission with no match stays pending instead of resubmitting',()=>withSetup(async s=>{
 const q=await ready(s);await s.db.prepare("UPDATE store_orders SET status='submitting' WHERE id=?").bind(q.token).run();await fulfillStoreOrder(s.env,q.token);await fulfillStoreOrder(s.env,q.token);assert.equal(s.created.size,0);assert.equal(s.db.rows('store_orders')[0].status,'submitting');
}));
test('a refunded payment goes to manual review without printing',()=>withSetup(async s=>{
 const q=await ready(s);s.setBehavior('refunded');await settleStoreCheckout(s.env,paid(q.token));assert.equal(s.db.rows('store_orders')[0].status,'manual_review');assert.equal(s.created.size,0);
}));
test('public status contains no recipient data; store admin fails closed',()=>withSetup(async s=>{
 const q=await ready(s),url=new URL('https://songaday.studio/store/order/'+q.token);const response=await handleStore(new Request(url),s.env,url);const data=await response.json();assert.equal(data.recipient_json,undefined);assert.equal(data.email,undefined);assert.equal(data.checkout_url,undefined);
 const admin=new URL('https://songaday.studio/commission/admin/store');assert.equal((await handleStore(new Request(admin),s.env,admin)).status,401);
 await runStoreOrders(s.env);
}));
