(() => {
 "use strict";
 /* STORE_ROOM_GEOMETRY */
 const $ = (id) => document.getElementById(id);
 const query = new URLSearchParams(location.search);
 let figures = [], config, figure, size = query.get("size") || "30x40", frame = query.get("frame") || "none";
 let quoteToken=null, buying=false, revision=0, imageView="print";
 let patronState=null, patronDiscountPercent=0, patronChecking=false, patronCheckedAt=0;
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
  renderPrice();
  renderMedia(); clearQuote(); updateUrl();
 }
 function updateUrl(){if(!figure)return;const u=new URL(location.href);u.searchParams.set("figure",figure.id);u.searchParams.set("size",size);u.searchParams.set("frame",frame);history.replaceState(null,"",u);}
 function select(f,scroll=false) {
  clearQuote(); figure=f;$("figure-name").textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;
  $("figure-image").src=f.image;$("figure-image").alt=f.name+" poster";renderMedia();updateUrl();renderGrid();
  if(scroll){$("figure-name").setAttribute("tabindex","-1");$("figure-name").focus({preventScroll:true});document.querySelector(".store-product").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});}
 }
 function renderMedia() {
  if(!figure)return;
  const geometry=roomGeometry(size,frame);
  $("store-print-thumb").src=figure.image;
  for(const art of document.querySelectorAll(".store-room-art")){
   art.dataset.frame=frame;for(const key of ["left","top","width","height"])art.style[key]=geometry[key]+"%";
   const img=art.querySelector("img");img.src=figure.image;img.style.left=geometry.insetX+"%";img.style.top=geometry.insetY+"%";img.style.width=geometry.printWidth+"%";img.style.height=geometry.printHeight+"%";
  }
  $("store-room-view").querySelector(".store-room-print").alt=figure.name+", "+size.replace("x"," × ")+" inches, "+labels[frame]+", in Jonathan’s studio";
  document.querySelector(".store-thumb-print").dataset.frame=frame;
  syncPrintFrame();
 }
 function syncPrintFrame(){
  const art=$("store-print-view"),css=getComputedStyle(art),width=art.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
  const inches=Number(size.split("x")[0]);$("figure-image").style.borderWidth=frame==="none"?"0":width*12/(inches*25.4+24)+"px";
 }
 for(const button of document.querySelectorAll("[data-poster-view]"))button.addEventListener("click",()=>{
  imageView=button.dataset.posterView;$("store-print-view").hidden=imageView!=="print";$("store-room-view").hidden=imageView!=="room";
  for(const b of document.querySelectorAll("[data-poster-view]"))b.setAttribute("aria-pressed",String(b===button));
  $("store-image-caption").textContent=imageView==="room"?"Illustrative preview in Jonathan’s studio. Scale is approximate.":"Framing preview is illustrative.";
  if(imageView==="print")syncPrintFrame();
  document.querySelector(".store-media").scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
 });
 new ResizeObserver(()=>{if(imageView==="print")syncPrintFrame();}).observe($("store-print-view"));
 function renderGrid() {
  const q=$("store-search").value.trim().toLowerCase().replace(/^#/,"");
  const matched=figures.filter(f=>!q||f.name.toLowerCase().includes(q)||String(f.id)===q||String(f.id).padStart(3,"0")===q);
  $("store-count").textContent=matched.length?matched.length+" figure"+(matched.length===1?"":"s"):"No figures found. Try another name or number.";
  $("store-grid").replaceChildren(...matched.map(f=>{const b=document.createElement("button");b.type="button";b.className="store-figure";b.setAttribute("aria-pressed",String(figure?.id===f.id));const img=document.createElement("img");img.src=f.image;img.alt="";img.loading="lazy";img.width=300;img.height=400;const label=document.createElement("span");label.textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;b.append(img,label);b.addEventListener("click",()=>select(f,true));return b;}));
 }
 function clearQuote(){revision++;quoteToken=null;$("store-checkout").hidden=true;$("store-quote-status").textContent="";}
 async function post(path,data){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||"Please try again.");return d;}
 function renderPrice(){
  if(!config)return;
  const cents=config.variants.find(v=>v.size===size&&v.frame===frame).priceCents;
  const email=$("store-shipping").elements.email.value.trim().toLowerCase();
  const eligible=patronState?.eligible&&email===patronState.email;
  $("store-price").textContent=money(eligible?cents-Math.round(cents*patronState.percent/100):cents);
  $("store-patron-savings").hidden=!eligible;
  $("store-patron-savings").textContent=eligible?`${patronState.percent}% patron discount applied. Regular poster price: ${money(cents)}.`:"";
 }
 async function refreshPatron(){
  if(!patronDiscountPercent||patronChecking)return;
  patronChecking=true;patronCheckedAt=Date.now();
  try{
   const r=await fetch("/store/patron/status",{cache:"no-store"}),d=await r.json();
   if(!r.ok)throw Error(d.error||"We couldn’t check your patron discount. Please try again.");
   const previousEmail=patronState?.email;patronState=d;
   $("store-patron-form").hidden=d.verified;
   $("store-patron-logout").hidden=!d.verified;$("store-patron-refresh").hidden=!d.verified;
   if(d.verified){
    const input=$("store-shipping").elements.email;
    if(!input.value||input.value.trim().toLowerCase()===previousEmail)input.value=d.email;
    $("store-patron-status").textContent=d.eligible?`Verified as ${d.email}. Your ${d.percent}% poster discount will apply at checkout.`:`Verified as ${d.email}. We couldn’t find a current monthly Zeffy gift for this email. If you just joined, please check again shortly.`;
   }else $("store-patron-status").textContent="";
  }catch(e){patronState=null;$("store-patron-status").textContent=e.message;}
  finally{patronChecking=false;clearQuote();renderPrice();}
 }
 $("store-patron-form").addEventListener("submit",async event=>{
  event.preventDefault();$("store-patron-request").disabled=true;
  try{const d=await post("/store/patron/request",{email:$("store-patron-email").value,returnTo:location.pathname+location.search});$("store-patron-status").textContent=d.message;}
  catch(e){$("store-patron-status").textContent=e.message;}
  finally{$("store-patron-request").disabled=false;}
 });
 $("store-patron-logout").addEventListener("click",async()=>{
  try{await post("/store/patron/logout",{});patronState=null;clearQuote();await refreshPatron();}
  catch(e){$("store-patron-status").textContent=e.message;}
 });
 $("store-patron-refresh").addEventListener("click",refreshPatron);
 window.addEventListener("focus",()=>{if(Date.now()-patronCheckedAt>10000&&!buying)refreshPatron();});
 $("store-shipping").elements.email.addEventListener("input",renderPrice);
 $("store-shipping").addEventListener("input",clearQuote);
 $("store-shipping").addEventListener("submit",async event=>{
  event.preventDefault();if(buying)return;buying=true;clearQuote();$("store-quote").disabled=true;$("store-quote-status").textContent="Checking shipping…";
  const chosen={figure:figure.id,size,frame,revision};
  try{const recipient=Object.fromEntries(new FormData(event.currentTarget));const variant=config.variants.find(v=>v.size===size&&v.frame===frame);const q=await post("/store/quote",{figure:figure.id,variant:variant.id,recipient});
   if(figure.id!==chosen.figure||size!==chosen.size||frame!==chosen.frame||revision!==chosen.revision)return;
   quoteToken=q.token;$("store-quote-status").textContent=`${q.discountPercent?q.discountPercent+"% patron discount applied. ":""}Poster ${money(q.priceCents)} + shipping ${money(q.shippingCents)} = ${money(q.priceCents+q.shippingCents)} before tax. ${q.shippingName}. Tax is calculated at checkout.`;$("store-checkout").hidden=false;
   $("store-price").textContent=money(q.priceCents);$("store-patron-savings").hidden=!q.discountPercent;$("store-patron-savings").textContent=q.discountPercent?`${q.discountPercent}% patron discount applied. Regular poster price: ${money(q.originalPriceCents)}.`:"";
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
 Promise.all([fetch("/store/catalog.json").then(r=>{if(!r.ok)throw Error();return r.json();}),fetch("/store/variants.json").then(r=>{if(!r.ok)throw Error();return r.json();}),fetch("/store/config").then(r=>r.ok?r.json():{checkoutEnabled:false}).catch(()=>({checkoutEnabled:false}))]).then(([items,options,availability])=>{figures=items;config=options;patronDiscountPercent=availability.patronDiscountPercent||0;$("patron-discount").hidden=!patronDiscountPercent;$("store-patron-intro").textContent=`Monthly Zeffy patrons get ${patronDiscountPercent}% off posters, at any monthly amount. Verify your donation email below. Shipping is charged separately.`;$("store-shipping").hidden=!availability.checkoutEnabled;$("store-launch").textContent=availability.checkoutEnabled?" · Shipping and tax added at checkout.":" · Purchasing opens soon.";renderOptions();select(figures.find(f=>f.id===Number(query.get("figure")))||figures.find(f=>f.id===15));refreshPatron();}).catch(()=>{$("store-count").textContent="The collection couldn’t load. Please refresh to try again.";});
})();
