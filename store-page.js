(() => {
 "use strict";
 const $ = (id) => document.getElementById(id);
 const query = new URLSearchParams(location.search);
 let figures = [], config, figure, size = query.get("size") || "30x40", frame = query.get("frame") || "none";
 let quoteToken=null, buying=false, revision=0;
 const money=cents=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
 const labels = {none:"Unframed",black:"Black wood",white:"White wood"};
 function chooseButton(text,small,pressed,disabled,callback) {
  const b=document.createElement("button"); b.type="button"; b.textContent=text;
  if(small){const s=document.createElement("small");s.textContent=small;b.append(s);}
  b.setAttribute("aria-pressed",String(pressed)); b.disabled=disabled; b.addEventListener("click",callback);return b;
 }
 function renderOptions() {
  if(!config.sizes.some(s=>s.id===size))size="30x40";
  if(!config.variants.some(v=>v.size===size&&v.frame===frame))frame="none";
  $("store-sizes").replaceChildren(...config.sizes.map(s=>chooseButton(s.label,s.inches.join(" × ")+"″",size===s.id,false,()=>{size=s.id;renderOptions();})));
  $("store-frames").replaceChildren(...Object.entries(labels).map(([value,label])=>chooseButton(label,"",frame===value,!config.variants.some(v=>v.size===size&&v.frame===value),()=>{frame=value;renderOptions();})));
  document.querySelector(".store-art").dataset.frame=frame;
  $("store-frame-note").textContent=size==="30x40"?"30 × 40″ is available unframed. Choose small or medium for a ready-to-hang wooden frame.":frame==="none"?"Printed edge to edge on semi-glossy paper. Frame it your way.":"Wooden frame with plexiglass, assembled and ready to hang. Frame preview is illustrative.";
  $("store-price").textContent=money(config.variants.find(v=>v.size===size&&v.frame===frame).priceCents);
  clearQuote(); updateUrl();
 }
 function updateUrl(){if(!figure)return;const u=new URL(location.href);u.searchParams.set("figure",figure.id);u.searchParams.set("size",size);u.searchParams.set("frame",frame);history.replaceState(null,"",u);}
 function select(f,scroll=false) {
  clearQuote(); figure=f;$("figure-name").textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;
  $("figure-image").src=f.image;$("figure-image").alt=f.name+" poster";updateUrl();renderGrid();
  if(scroll){$("figure-name").setAttribute("tabindex","-1");$("figure-name").focus({preventScroll:true});document.querySelector(".store-product").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});}
 }
 function renderGrid() {
  const q=$("store-search").value.trim().toLowerCase().replace(/^#/,"");
  const matched=figures.filter(f=>!q||f.name.toLowerCase().includes(q)||String(f.id)===q||String(f.id).padStart(3,"0")===q);
  $("store-count").textContent=matched.length?matched.length+" figure"+(matched.length===1?"":"s"):"No figures found. Try another name or number.";
  $("store-grid").replaceChildren(...matched.map(f=>{const b=document.createElement("button");b.type="button";b.className="store-figure";b.setAttribute("aria-pressed",String(figure?.id===f.id));const img=document.createElement("img");img.src=f.image;img.alt="";img.loading="lazy";img.width=300;img.height=400;const label=document.createElement("span");label.textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;b.append(img,label);b.addEventListener("click",()=>select(f,true));return b;}));
 }
 function clearQuote(){revision++;quoteToken=null;$("store-checkout").hidden=true;$("store-quote-status").textContent="";}
 async function post(path,data){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||"Please try again.");return d;}
 $("store-shipping").addEventListener("input",clearQuote);
 $("store-shipping").addEventListener("submit",async event=>{
  event.preventDefault();if(buying)return;buying=true;clearQuote();$("store-quote").disabled=true;$("store-quote-status").textContent="Checking shipping…";
  const chosen={figure:figure.id,size,frame,revision};
  try{const recipient=Object.fromEntries(new FormData(event.currentTarget));const variant=config.variants.find(v=>v.size===size&&v.frame===frame);const q=await post("/store/quote",{figure:figure.id,variant:variant.id,recipient});
   if(figure.id!==chosen.figure||size!==chosen.size||frame!==chosen.frame||revision!==chosen.revision)return;
   quoteToken=q.token;$("store-quote-status").textContent=`Poster ${money(q.priceCents)} + shipping ${money(q.shippingCents)} = ${money(q.priceCents+q.shippingCents)} before tax. ${q.shippingName}. Tax is calculated at checkout.`;$("store-checkout").hidden=false;
  }catch(e){$("store-quote-status").textContent=e.message;}finally{buying=false;$("store-quote").disabled=false;}
 });
 $("store-checkout").addEventListener("click",async()=>{
  if(!quoteToken||buying)return;buying=true;$("store-checkout").disabled=true;
  try{const d=await post("/store/checkout",{token:quoteToken});const u=new URL(d.url);if(u.origin!=="https://checkout.stripe.com")throw Error("Unable to open checkout.");location.assign(u.href);}catch(e){$("store-quote-status").textContent=e.message;buying=false;$("store-checkout").disabled=false;}
 });
 async function orderStatus(){
  const token=query.get("order");if(!/^[a-f0-9]{32}$/.test(token||""))return;
  const el=$("store-order-status");el.hidden=false;
  try{const r=await fetch("/store/order/"+token);if(!r.ok)throw Error();const d=await r.json();
   el.textContent=d.paid?"Thank you! Your payment is received. "+(['ambiguous','submitting','paid','manual_review'].includes(d.status)?"We’re confirming your print order.":"Print status: "+d.status.replaceAll('_',' ')+"."):"Waiting for payment confirmation. This page updates automatically.";
   for(const t of d.tracking||[]){const a=document.createElement("a");a.textContent=" Track shipment";a.href=t.url;a.rel="noreferrer";el.append(a);}
   if(!["delivered","canceled","expired"].includes(d.status))setTimeout(orderStatus,15000);
  }catch{el.textContent="We couldn’t load your order status. Please refresh. Your Stripe receipt is your payment confirmation.";}
 }
 orderStatus();
 $("store-search").addEventListener("input",renderGrid);
 Promise.all([fetch("/store/catalog.json").then(r=>{if(!r.ok)throw Error();return r.json();}),fetch("/store/variants.json").then(r=>{if(!r.ok)throw Error();return r.json();}),fetch("/store/config").then(r=>r.ok?r.json():{checkoutEnabled:false}).catch(()=>({checkoutEnabled:false}))]).then(([items,options,availability])=>{figures=items;config=options;$("store-shipping").hidden=!availability.checkoutEnabled;$("store-launch").textContent=availability.checkoutEnabled?" · Shipping and tax added at checkout.":" · Purchasing opens soon.";select(figures.find(f=>f.id===Number(query.get("figure")))||figures.find(f=>f.id===15));renderOptions();}).catch(()=>{$("store-count").textContent="The collection couldn’t load. Please refresh to try again.";});
})();
